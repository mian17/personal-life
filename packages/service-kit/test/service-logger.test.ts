import { jest } from '@jest/globals';
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
});
