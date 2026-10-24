import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHarnessEnv } from './e2e/env-file';

const touched = ['E2E_CONCURRENCY', 'E2E_SLOT_MAX_AGE_MS', 'NOTE_MASTER_KEY', 'TEST_REDIS_URL'];

function envFile(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-env-'));
  writeFileSync(join(dir, '.env.development'), `${lines.join('\n')}\n`);
  return dir;
}

function clear(): void {
  for (const name of touched) delete process.env[name];
}

describe('loadHarnessEnv', () => {
  beforeEach(clear);
  afterEach(clear);

  it('takes harness knobs from the file', () => {
    loadHarnessEnv(envFile(['E2E_CONCURRENCY=2', 'TEST_REDIS_URL=redis://127.0.0.1:1']));

    expect(process.env.E2E_CONCURRENCY).toBe('2');
    expect(process.env.TEST_REDIS_URL).toBe('redis://127.0.0.1:1');
  });

  it('leaves secrets in the file', () => {
    loadHarnessEnv(envFile(['E2E_CONCURRENCY=2', 'NOTE_MASTER_KEY=c2VjcmV0']));

    expect(process.env.NOTE_MASTER_KEY).toBeUndefined();
  });

  it('lets the shell win', () => {
    process.env.E2E_SLOT_MAX_AGE_MS = '1234';
    loadHarnessEnv(envFile(['E2E_SLOT_MAX_AGE_MS=9999']));

    expect(process.env.E2E_SLOT_MAX_AGE_MS).toBe('1234');
  });

  it('does nothing when the file is absent', () => {
    expect(() => loadHarnessEnv(mkdtempSync(join(tmpdir(), 'harness-env-')))).not.toThrow();
    expect(process.env.E2E_CONCURRENCY).toBeUndefined();
  });
});
