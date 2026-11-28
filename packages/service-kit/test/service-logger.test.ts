import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthGuard, createServiceApplication } from '../src/index.js';
import { SERVICE_LOG_LEVELS, ServiceLogger } from '../src/logging/service-logger.js';

/** Collects everything the logger prints, so a test reads output instead of internals. */
function capturePrinted(): { read: () => string } {
  const written: string[] = [];
  const record = (chunk: unknown): boolean => {
    written.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(record);
  const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(record);
  return {
    read: () => {
      stdout.mockRestore();
      stderr.mockRestore();
      return written.join('');
    },
  };
}

/** One line as Nest prints it: message plus the context in its own column. */
function print(logger: ServiceLogger, level: 'log' | 'warn' | 'error', context: string): string {
  const { read } = capturePrinted();
  logger[level](`${context} speaking`, context);
  return read();
}

describe('ServiceLogger (the shared service-kernel console level)', () => {
  const logger = new ServiceLogger();

  it('runs at error, warn and log only', () => {
    expect(SERVICE_LOG_LEVELS).toEqual(['error', 'warn', 'log']);
  });

  it('drops the boot-time route mapping of both route loggers', () => {
    expect(print(logger, 'log', 'RouterExplorer')).toBe('');
    expect(print(logger, 'log', 'RoutesResolver')).toBe('');
  });

  it('still forwards a warning or an error from those contexts', () => {
    expect(print(logger, 'warn', 'RouterExplorer')).toContain('RouterExplorer speaking');
    expect(print(logger, 'error', 'RouterExplorer')).toContain('RouterExplorer speaking');
    expect(print(logger, 'warn', 'RoutesResolver')).toContain('RoutesResolver speaking');
    expect(print(logger, 'error', 'RoutesResolver')).toContain('RoutesResolver speaking');
  });

  it('forwards a log line from any other context', () => {
    expect(print(logger, 'log', 'NestFactory')).toContain('NestFactory speaking');
    expect(print(logger, 'log', 'NotesService')).toContain('NotesService speaking');
  });

  it('prints a line Nest passes without a context or a level', () => {
    const { read } = capturePrinted();
    // Nest calls printMessages with the context and level omitted at some call
    // sites, so both defaults have to print instead of throwing or swallowing.
    (logger as unknown as { printMessages: (messages: unknown[]) => void }).printMessages([
      'line without a context',
    ]);
    expect(read()).toContain('line without a context');
  });
});

describe('createServiceApplication (the shared service kernel boot)', () => {
  const verifierEnv = { jwksUrlEnv: 'TEST_IDP_JWKS_URL', audienceEnv: 'TEST_SERVICE_AUDIENCE' };
  // One module class for the whole suite: NestFactory is spied, so its identity is
  // the only thing the assertions read.
  class TestModule {}

  /** A stand-in for the Nest app, so the test sees the wiring calls and nothing else. */
  function stubApp() {
    return { useGlobalGuards: jest.fn(), useGlobalPipes: jest.fn() } as unknown as INestApplication;
  }

  afterEach(() => jest.restoreAllMocks());

  it('applies the JWT guard and the whitelisting pipe every service shares', async () => {
    const app = stubApp();
    const create = jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);

    await createServiceApplication(TestModule, { verifierEnv });

    expect(create).toHaveBeenCalledWith(TestModule, { logger: expect.any(ServiceLogger) });
    const [guard] = (app.useGlobalGuards as jest.Mock).mock.calls[0] as [AuthGuard];
    expect(guard).toBeInstanceOf(AuthGuard);
    const [pipe] = (app.useGlobalPipes as jest.Mock).mock.calls[0] as [ValidationPipe];
    expect(pipe).toBeInstanceOf(ValidationPipe);
    // Unknown fields are stripped when allowed and rejected outright when not, so a
    // handler never reads a field its DTO did not declare.
    expect(pipe.validatorOptions).toMatchObject({ whitelist: true, forbidNonWhitelisted: true });
    expect(pipe.isTransformEnabled).toBe(true);
  });

  it('boots with the shared logger and pipe when a service passes no options', async () => {
    const app = stubApp();
    const create = jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);

    await createServiceApplication(TestModule);

    expect(create).toHaveBeenCalledWith(TestModule, { logger: expect.any(ServiceLogger) });
    expect(app.useGlobalGuards).not.toHaveBeenCalled();
    expect(app.useGlobalPipes).toHaveBeenCalledWith(expect.any(ValidationPipe));
  });

  it('creates the SQLite directory before the module opens the file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'service-kit-'));
    const sqlitePath = join(root, 'data', 'test.db');
    let directoryExistedAtCreate = false;
    jest.spyOn(NestFactory, 'create').mockImplementation(async () => {
      directoryExistedAtCreate = existsSync(join(root, 'data'));
      return stubApp();
    });

    // The IdP's shape: a SQLite path and no verifier env, so no token guard at all.
    const app = await createServiceApplication(TestModule, { sqlitePath });

    expect(directoryExistedAtCreate).toBe(true);
    expect(app.useGlobalGuards).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });
});
