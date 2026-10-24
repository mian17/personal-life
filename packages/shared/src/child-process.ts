import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The `PATH` every spawned command gets. Never the caller's `PATH`: that is
 * resolved at spawn time from directories anyone can write to (Sonar S4036), so
 * the harness pins the executable's own directory plus the standard toolchain
 * locations instead.
 *
 * ponytail: a fixed allowlist covers every toolchain these harnesses drive
 * (node, npm, docker). Add a directory when a dev machine installs one elsewhere.
 */
export const CHILD_PATH = [
  dirname(process.execPath),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  '/bin',
].join(':');

/** The caller's environment with `PATH` replaced by {@link CHILD_PATH}. */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: CHILD_PATH, ...extra };
}

const BIN_CACHE = new Map<string, string>();

/**
 * Absolute path to a command. `spawn`/`execFile` by bare name would search
 * `PATH`, so a writable directory anywhere in it could substitute the binary
 * (Sonar S4036). Resolving against {@link CHILD_PATH} first keeps the search
 * deterministic and the resolved path is what gets executed.
 */
export function bin(name: string): string {
  const cached = BIN_CACHE.get(name);
  if (cached !== undefined) return cached;
  const found = CHILD_PATH.split(':')
    .map((directory) => join(directory, name))
    .find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`cannot find ${name} in ${CHILD_PATH}`);
  BIN_CACHE.set(name, found);
  return found;
}
