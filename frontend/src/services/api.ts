const DEFAULT_API_URL = 'http://localhost:4000/api';

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');

export interface HealthData {
  status: string;
  service: string;
  timestamp: string;
  uptime: number;
}

export interface HealthResponse {
  success: boolean;
  data: HealthData;
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`A API respondeu com HTTP ${response.status}.`);
  }

  const body = (await response.json()) as Partial<HealthResponse>;

  if (body.success !== true || body.data?.status !== 'ok') {
    throw new Error('A API respondeu em um formato inesperado.');
  }

  return body as HealthResponse;
}
