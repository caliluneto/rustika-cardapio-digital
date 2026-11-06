/**
 * Leitura de senha sem eco, somente em terminal interativo (TTY). Sem TTY a leitura é recusada: a senha nunca vem de
 * argumentos, variáveis de ambiente, arquivos ou pipes.
 */
export async function readHiddenLine(prompt: string, input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stderr): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('A senha só pode ser digitada em um terminal interativo (TTY).');
  }
  output.write(prompt);
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (error?: Error): void => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Entrada cancelada.'));
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        if (char >= ' ') value += char;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}
