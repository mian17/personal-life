/**
 * `src/config.ts` against the task's acceptance criteria (SPEC-mcp-gateway §1, §9.7): entries come
 * back in declaration order with the client's fields intact, every malformed config fails as a
 * `-32002` `ConfigError` naming its cause, and the hash tracks content rather than formatting.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, CONFIG_ERROR_CODE, loadGatewayConfig } from '../src/config';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-config-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function configSavedAs(contents: string): string {
  const path = join(directory, 'gateway.json');
  writeFileSync(path, contents);
  return path;
}

function loadFor(path: string): unknown {
  return loadGatewayConfig({ MCP_GATEWAY_CONFIG: path });
}

function configErrorFrom(load: () => unknown): ConfigError {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, none was thrown');
}

const TWO_UPSTREAM_CONFIG = `{
  "mcpServers": {
    "notes": { "command": "node", "args": ["notes.js", "--stdio"], "env": { "TOKEN": "a" } },
    "todos": { "command": "npx", "args": ["todos"], "env": {}, "cwd": "/srv/todos" }
  }
}`;

describe('loadGatewayConfig on a valid file', () => {
  it('returns entries in declaration order with every client field intact', () => {
    const config = loadGatewayConfig({ MCP_GATEWAY_CONFIG: configSavedAs(TWO_UPSTREAM_CONFIG) });

    expect(config.entries).toEqual([
      {
        configKey: 'notes',
        command: 'node',
        args: ['notes.js', '--stdio'],
        env: { TOKEN: 'a' },
      },
      {
        configKey: 'todos',
        command: 'npx',
        args: ['todos'],
        env: {},
        cwd: '/srv/todos',
      },
    ]);
  });

  it('defaults a missing args and env to an empty list and map', () => {
    const path = configSavedAs('{ "mcpServers": { "notes": { "command": "node" } } }');

    const config = loadGatewayConfig({ MCP_GATEWAY_CONFIG: path });

    expect(config.entries[0]).toEqual({ configKey: 'notes', command: 'node', args: [], env: {} });
  });
});

describe('loadGatewayConfig on a broken config', () => {
  it.each([
    ['a missing MCP_GATEWAY_CONFIG', () => loadGatewayConfig({}), /MCP_GATEWAY_CONFIG is not set/],
    [
      'a missing file',
      () => loadGatewayConfig({ MCP_GATEWAY_CONFIG: join(directory, 'absent.json') }),
      /cannot read MCP_GATEWAY_CONFIG file .*absent\.json/,
    ],
    [
      'invalid JSON',
      () => loadFor(configSavedAs('{ "mcpServers": ')),
      /is not valid JSON/,
    ],
    [
      'a non-object mcpServers',
      () => loadFor(configSavedAs('{ "mcpServers": [] }')),
      /has no "mcpServers" object/,
    ],
    [
      'an entry without a command',
      () => loadFor(configSavedAs('{ "mcpServers": { "notes": { "args": [] } } }')),
      /config entry "notes" has no command/,
    ],
  ])('raises -32002 naming %s', (_cause, load, message) => {
    const error = configErrorFrom(load);

    expect(error.code).toBe(CONFIG_ERROR_CODE);
    expect(error.message).toMatch(message);
  });

  it('raises -32002 naming a key outside the legal name shape', () => {
    const path = configSavedAs('{ "mcpServers": { "my app": { "command": "node" } } }');

    const error = configErrorFrom(() => loadFor(path));

    expect(error.code).toBe(CONFIG_ERROR_CODE);
    expect(error.message).toContain('"my app"');
  });
});

describe('the config hash', () => {
  it('is identical across whitespace and indentation differences', () => {
    const compact = '{ "mcpServers": { "notes": { "command": "node", "args": ["notes.js"] } } }';
    const spread = TWO_UPSTREAM_CONFIG;
    const sameContent = `{
      "mcpServers": {
        "notes": { "command": "node", "args": ["notes.js", "--stdio"], "env": { "TOKEN": "a" } },
        "todos": { "command": "npx", "args": ["todos"], "env": {}, "cwd": "/srv/todos" }
      }
    }`;

    const compactHash = loadGatewayConfig({ MCP_GATEWAY_CONFIG: configSavedAs(compact) }).hash;
    const spreadHash = loadGatewayConfig({ MCP_GATEWAY_CONFIG: configSavedAs(spread) }).hash;
    const sameContentHash = loadGatewayConfig({ MCP_GATEWAY_CONFIG: configSavedAs(sameContent) }).hash;

    expect(spreadHash).toBe(sameContentHash);
    expect(compactHash).not.toBe(spreadHash);
  });

  it('changes when a key, a command, or an argument changes', () => {
    const baseline = loadGatewayConfig({ MCP_GATEWAY_CONFIG: configSavedAs(TWO_UPSTREAM_CONFIG) }).hash;
    const renamedKey = TWO_UPSTREAM_CONFIG.replace('"notes"', '"journal"');
    const renamedCommand = TWO_UPSTREAM_CONFIG.replace('"command": "npx"', '"command": "pnpm"');
    const extraArgument = TWO_UPSTREAM_CONFIG.replace('"todos"]', '"todos", "--fast"]');

    const hashes = [renamedKey, renamedCommand, extraArgument].map(
      (contents) => loadGatewayConfig({ MCP_GATEWAY_CONFIG: configSavedAs(contents) }).hash,
    );

    expect(new Set([baseline, ...hashes]).size).toBe(4);
  });
});
