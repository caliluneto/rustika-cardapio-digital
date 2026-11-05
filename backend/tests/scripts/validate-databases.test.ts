import { describe, expect, it } from 'vitest';
import { classifyConnectionError } from '../../scripts/validate-databases';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function withMeta(message: string, meta: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { meta });
}

describe('classifyConnectionError', () => {
  it('reconhece negação de CONNECT em português', () => {
    const error = new Error(
      'FATAL: permissão negada para banco de dados "cardapio_digital_test" DETAIL: Usuário não tem privilégio CONNECT.',
    );

    expect(classifyConnectionError(error).kind).toBe(
      'connect-privilege-denied',
    );
  });

  it('reconhece negação de CONNECT em português com acentos corrompidos', () => {
    const error = new Error(
      'FATAL: permiss\uFFFDo negada para banco de dados "cardapio_digital_test" DETAIL: Usu\uFFFDrio n\uFFFDo tem privil\uFFFDgio CONNECT.',
    );

    expect(classifyConnectionError(error).kind).toBe(
      'connect-privilege-denied',
    );
  });

  it('reconhece negação de CONNECT em inglês', () => {
    const error = new Error(
      'FATAL: permission denied for database "cardapio_digital_test" DETAIL: User does not have CONNECT privilege.',
    );

    expect(classifyConnectionError(error).kind).toBe(
      'connect-privilege-denied',
    );
  });

  it('prioriza SQLSTATE 42501 do código do erro', () => {
    const classification = classifyConnectionError(withCode('falha', '42501'));

    expect(classification).toMatchObject({
      kind: 'connect-privilege-denied',
      sqlState: '42501',
      reason: 'sqlstate-42501',
    });
  });

  it('extrai SQLSTATE 42501 do meta do erro', () => {
    const classification = classifyConnectionError(
      withMeta('falha', { code: '42501' }),
    );

    expect(classification).toMatchObject({
      kind: 'connect-privilege-denied',
      sqlState: '42501',
      reason: 'sqlstate-42501',
    });
  });

  it('extrai SQLSTATE 42501 da mensagem do Prisma', () => {
    const error = new Error(
      'Raw query failed. Code: `42501`. Message: `permission denied`',
    );

    expect(classifyConnectionError(error)).toMatchObject({
      kind: 'connect-privilege-denied',
      sqlState: '42501',
      reason: 'sqlstate-42501',
    });
  });

  it('reconhece Prisma P1010 como negação de CONNECT', () => {
    const error = withCode(
      'User was denied access on the database `cardapio_digital_test`',
      'P1010',
    );

    expect(classifyConnectionError(error)).toMatchObject({
      kind: 'connect-privilege-denied',
      prismaCode: 'P1010',
    });
  });

  it('não classifica falha de autenticação em inglês como negação de CONNECT', () => {
    const error = new Error(
      'Authentication failed against database server, the provided database credentials for `cardapio_dev_app` are not valid.',
    );
    const classification = classifyConnectionError(error);

    expect(classification.kind).toBe('authentication-failed');
    expect(classification.kind).not.toBe('connect-privilege-denied');
  });

  it('reconhece falha de autenticação em português', () => {
    const error = new Error(
      'falha na autenticação de senha para o usuário cardapio_dev_app',
    );

    expect(classifyConnectionError(error).kind).toBe('authentication-failed');
  });

  it('prioriza SQLSTATE 28P01 como falha de autenticação', () => {
    const classification = classifyConnectionError(withCode('falha', '28P01'));

    expect(classification).toMatchObject({
      kind: 'authentication-failed',
      sqlState: '28P01',
      reason: 'sqlstate-28xxx',
    });
  });

  it('reconhece Prisma P1000 como falha de autenticação', () => {
    const error = withCode('Authentication failed', 'P1000');

    expect(classifyConnectionError(error)).toMatchObject({
      kind: 'authentication-failed',
      prismaCode: 'P1000',
    });
  });

  it('reconhece erro de rede por mensagem do Prisma', () => {
    const error = new Error(
      "Can't reach database server at `127.0.0.1:5433` Please make sure your database server is running.",
    );

    expect(classifyConnectionError(error).kind).toBe('network-error');
  });

  it('reconhece erro de rede por código do sistema', () => {
    const error = withCode('connect ECONNREFUSED 127.0.0.1:5433', 'ECONNREFUSED');

    expect(classifyConnectionError(error).kind).toBe('network-error');
  });

  it('reconhece Prisma P1001 como erro de rede', () => {
    const error = withCode('Can not reach database server', 'P1001');

    expect(classifyConnectionError(error)).toMatchObject({
      kind: 'network-error',
      prismaCode: 'P1001',
    });
  });

  it('reconhece erro de rede localizado em português', () => {
    const error = new Error('não foi possível conectar ao servidor de banco');

    expect(classifyConnectionError(error).kind).toBe('network-error');
  });

  it('mantém erros desconhecidos como desconhecidos', () => {
    const error = new Error('algo inesperado aconteceu');

    expect(classifyConnectionError(error)).toMatchObject({
      kind: 'unknown',
      reason: 'nao-reconhecido',
    });
  });
});
