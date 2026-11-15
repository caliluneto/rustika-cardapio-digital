/**
 * Polling sem sobreposição para o painel de pedidos.
 * - Uma consulta por vez: o próximo ciclo só é agendado DEPOIS que a anterior termina (setTimeout encadeado).
 * - `refresh()` durante uma consulta em andamento não dispara outra: apenas marca uma nova rodada para depois.
 * - `stop()` cancela o timer e aborta a consulta em andamento; resultados tardios são descartados.
 * - Sem WebSocket/Socket.IO.
 */
export interface PollerTimers {
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface OrdersPollerOptions<T> {
  load(signal: AbortSignal): Promise<T>;
  onData(data: T): void;
  onError(error: unknown): void;
  /** Retorna true para encerrar o polling (ex.: sessão expirada). */
  shouldStop?(error: unknown): boolean;
  intervalMs: number;
  timers?: PollerTimers;
}

const defaultTimers: PollerTimers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createOrdersPoller<T>(options: OrdersPollerOptions<T>) {
  const timers = options.timers ?? defaultTimers;
  let running = false;
  let inFlight: AbortController | null = null;
  let timer: unknown = null;
  let rerun = false;
  let generation = 0; // invalida ciclos antigos se o poller for parado e reiniciado

  const clearTimer = () => { if (timer !== null) { timers.clearTimer(timer); timer = null; } };

  async function cycle(): Promise<void> {
    if (!running) return;
    if (inFlight) { rerun = true; return; }
    clearTimer();
    const gen = generation;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const data = await options.load(controller.signal);
      if (running && inFlight === controller) options.onData(data);
    } catch (error) {
      if (running && inFlight === controller && !controller.signal.aborted) {
        options.onError(error);
        if (options.shouldStop?.(error)) { stop(); return; }
      }
    } finally {
      if (inFlight === controller) inFlight = null;
    }
    if (!running || gen !== generation) return;
    if (rerun) { rerun = false; void cycle(); return; }
    timer = timers.setTimer(() => { timer = null; void cycle(); }, options.intervalMs);
  }

  function start(): void {
    if (running) return;
    running = true;
    void cycle();
  }

  function stop(): void {
    running = false;
    generation++;
    rerun = false;
    clearTimer();
    inFlight?.abort();
    inFlight = null;
  }

  /** Consulta imediata (ex.: após uma atualização de status ou um 409). Nunca sobrepõe uma consulta em andamento. */
  function refresh(): void {
    if (!running) return;
    if (inFlight) { rerun = true; return; }
    void cycle();
  }

  return { start, stop, refresh, isRunning: () => running, isLoading: () => inFlight !== null };
}

export type OrdersPoller<T> = ReturnType<typeof createOrdersPoller<T>>;
