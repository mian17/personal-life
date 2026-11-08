/**
 * Guards one rule: every explicit `docker rm` on a dev/e2e container passes `-v`.
 *
 * This is a cheap tripwire for a real 25 GB leak, not decoration. `docker run --rm`
 * only auto-removes volumes on a container's natural exit, so an explicit `rm -f`
 * without `-v` strands the anonymous volume of any image that declares `VOLUME` —
 * `postgres:17-alpine` does, one initdb data dir per start. The owner's host held
 * 657 such orphans / 25.15 GB before these four call sites were fixed.
 *
 * Run: npm run test:dev-infra
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SHELL = 'scripts/dev-infra.sh';
const E2E_STACK = 'apps/app/test/e2e/stack.ts';

/**
 * Drops whole comment lines, so prose that merely mentions `docker rm -f`
 * (the comments these removals are documented in) is not read as an invocation.
 */
function executableLines(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|#|\*|\/\*)/.test(line));
}

/** True for a token that sets the volume flag: `-v`, `-fv`, `-vf`, `--volumes`. */
const setsVolumeFlag = (token) => /^-[a-zA-Z]*v[a-zA-Z]*$/.test(token) || token === '--volumes';

test('dev-infra.sh: every `docker rm` passes -v', () => {
  const lines = executableLines(SHELL).filter((line) => /\bdocker\s+rm\b/.test(line));
  assert.equal(lines.length, 3, `expected the three known removals, found ${lines.length}`);

  for (const line of lines) {
    const flags = /\bdocker\s+rm\b(.*)$/.exec(line)[1].split(/\s+/);
    assert.ok(flags.some(setsVolumeFlag), `docker rm without -v strands an anonymous volume:\n  ${line.trim()}`);
  }
});

test('stack.ts: every container removal passes -v', () => {
  const calls = executableLines(E2E_STACK).flatMap((line) => [...line.matchAll(/runDocker\(\[([^\]]*)\]/g)]);
  const removals = calls.filter(([, args]) => /^\s*['"]rm['"]/.test(args));
  assert.equal(removals.length, 1, `expected the one known removal in forceRemoveContainer, found ${removals.length}`);

  for (const [, args] of removals) {
    const flags = args.split(',').map((arg) => arg.trim().replace(/^['"]|['"]$/g, ''));
    assert.ok(flags.some(setsVolumeFlag), `runDocker(['rm', ...]) without '-v' leaks the container's volume:\n  ${args}`);
  }
});
