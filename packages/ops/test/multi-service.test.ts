/**
 * Multi-service integration suite (SPEC-ops-all-services §8.6–§8.8): one selector,
 * one CLI, one MCP server, one token. `LIFE_OPS_SERVICE=todo,meal,notes` loads the
 * ten resources those three modules declare; every call lands on the stub base its
 * owning module names and on no other; the MCP tool list is the union of the three
 * modules' tools under unique `<resource>_<kind>` names; base resolution prefers the
 * per-service variable, keeps the shared `LIFE_OPS_API_BASE` for a lone service, and
 * names the missing per-service variable when several load; and one `login` token,
 * requested for `LIFE_OPS_RESOURCE=https://life-ops`, is accepted by all three stubs
 * on the unchanged `dev` client.
 *
 * Both the services and the IdP are loopback stubs (`test/support/`), so no test here
 * reaches a real host, a real IdP, Redis, or Postgres.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { login } from '../src/auth/login';
import { storeTokens, type StoredTokens } from '../src/auth/token-store';
import { loadService, main as runCli } from '../src/cli/run';
import type { ServiceModule } from '../src/cli/run';
import { createMcpServer, type McpServer } from '../src/mcp/server';
import { sampleApiToken, startStubApi } from './support/stub-api';
import type { SampleRow, StubApi } from './support/stub-api';
import { startStubIdp, type StubIdp } from './support/stub-idp';

const OWNER_SUBJECT = 'owner-a';
const SELECTOR = 'todo,meal,notes';
const LIFE_OPS_RESOURCE = 'https://life-ops';
/**
 * The audience every service's verifier accepts (`packages/service-kit/src/auth/
 * jwt-verifier.ts:49`), so one token serves all three — SPEC §8.8, the second half.
 * Asserted on the grant the stub IdP recorded, which is where the IdP's
 * `OIDC_AUDIENCE_MAP` reading of `LIFE_OPS_RESOURCE` becomes the token's `aud`.
 */
const LIFE_API_AUDIENCE = 'life-api';

/**
 * The IdP mapping SPEC §8.8 depends on: `LIFE_OPS_RESOURCE=https://life-ops` →
 * audience `life-api`. `scripts/setup-dev-env.sh` ships this pair; the case sets it
 * so the grant the stub records cannot pass on the unmapped-hostname fallback
 * (which would read `life-ops`).
 */
const OIDC_AUDIENCE_MAP = `${LIFE_OPS_RESOURCE}=${LIFE_API_AUDIENCE}`;

const DEV_CLIENT_ID = 'dev';
const UNREACHABLE_API = 'http://127.0.0.1:1';
const STUB_REFRESH_TOKEN = 'stub.refresh.token';
const ONE_HOUR_MS = 3_600_000;
const SUCCESS_EXIT = 0;
const FAILURE_EXIT = 1;

/**
 * The op kinds each resource of the selector's three modules serves, in load order
 * then registry order (SPEC §1.2 todo, §1.3 meal, SPEC-ops-notes-service §1.1).
 */
const EXPECTED_OPS: Readonly<Record<string, readonly string[]>> = {
  todos: ['create', 'list', 'get', 'update', 'delete', 'restore'],
  'todos-tags': ['list'],
  'todos-trash': ['list'],
  'todos-completions': ['list'],
  lists: ['create', 'list', 'update'],
  entries: ['create', 'list', 'get', 'update', 'delete'],
  foods: ['create', 'list', 'get', 'update', 'delete'],
  'saved-meals': ['create', 'list', 'get', 'delete'],
  target: ['list'],
  notes: ['create', 'get', 'list', 'update', 'delete', 'restore'],
};

const RESOURCE_NAMES = Object.keys(EXPECTED_OPS);

/** One row per stub, so a call that lands on the wrong base cannot succeed by accident. */
const TODO_COLLECTION: SeededCollection = {
  basePath: '/api/todos',
  seed: () => [
    { id: 'todo-a', ownerSub: OWNER_SUBJECT, version: 0, title: 'Ship the release', done: false },
  ],
};

const MEAL_COLLECTION: SeededCollection = {
  basePath: '/api/entries',
  seed: () => [
    {
      id: 'entry-a',
      ownerSub: OWNER_SUBJECT,
      version: 0,
      date: '2026-03-01',
      mealGroup: 'breakfast',
      quantity: 1,
    },
  ],
};

const NOTES_COLLECTION: SeededCollection = {
  basePath: '/api/notes',
  seed: () => [{ id: 'note-a', ownerSub: OWNER_SUBJECT, version: 0, body: 'Remember the boxes' }],
};

/** Where every call of each service must land, and nowhere else. */
const OWNING_PATHS = {
  todo: ['/api/todos/todo-a'],
  meal: ['/api/entries/entry-a'],
  notes: ['/api/notes/note-a'],
};

let credentialsFile = '';
let savedCredentialsPath: string | undefined;

beforeAll(async () => {
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-multi-service-')), 'credentials.json');
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  process.env.LIFE_OPS_CREDENTIALS_PATH = credentialsFile;
  await storeTokens({
    accessToken: sampleApiToken,
    refreshToken: STUB_REFRESH_TOKEN,
    expiresAt: Date.now() + ONE_HOUR_MS,
  });
});

afterAll(() => {
  if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
  rmSync(dirname(credentialsFile), { recursive: true, force: true });
});

describe('one CLI over todo, meal and notes', () => {
  it('loads the ten resources the three modules declare, in selector order', async () => {
    const service = await loadService({ LIFE_OPS_SERVICE: SELECTOR });

    expect(resourceNamesOf(service)).toEqual(RESOURCE_NAMES);
  });

  it('lands every call on the base its owning module names and nowhere else', async () => {
    const stubs = await startServiceStubs();
    try {
      const outcomes = await driveEveryService(multiServiceEnv(stubs));

      expect(outcomes.map((outcome) => outcome.exit)).toEqual([
        SUCCESS_EXIT,
        SUCCESS_EXIT,
        SUCCESS_EXIT,
      ]);
      expect(requestPathsOf(stubs)).toEqual(OWNING_PATHS);
    } finally {
      await stopServiceStubs(stubs);
    }
  });
});

describe('one MCP server over the same selector', () => {
  it('lists the union of the three modules tools under unique names', async () => {
    const server = await mcpServerOver({ LIFE_OPS_SERVICE: SELECTOR });

    const names = toolNamesOf(await server.handle(toolsRequest()));

    expect(names).toEqual(expectedToolNames());
    expect(new Set(names).size).toBe(names.length);
  });

  it('calls each tool on the base its owning module names', async () => {
    const stubs = await startServiceStubs();
    try {
      const server = await mcpServerOver(multiServiceEnv(stubs));
      const replies = await Promise.all([
        server.handle(toolCallRequest('todos_get', { id: 'todo-a' })),
        server.handle(toolCallRequest('entries_get', { id: 'entry-a' })),
        server.handle(toolCallRequest('notes_get', { id: 'note-a' })),
      ]);

      expect(replies.map(failedOf)).toEqual([false, false, false]);
      expect(requestPathsOf(stubs)).toEqual(OWNING_PATHS);
    } finally {
      await stopServiceStubs(stubs);
    }
  });
});

describe('base precedence', () => {
  it('prefers the per-service variable over the shared one', async () => {
    const stubs = await startServiceStubs();
    try {
      const env = {
        ...multiServiceEnv(stubs),
        LIFE_OPS_SERVICE: 'todo',
        LIFE_OPS_API_BASE: stubs.meal.baseUrl,
      };

      const outcome = await driveCli(['todos', 'get', '--id', 'todo-a'], env);

      expect(outcome.exit).toBe(SUCCESS_EXIT);
      expect(requestPathsOf(stubs)).toEqual({ todo: OWNING_PATHS.todo, meal: [], notes: [] });
    } finally {
      await stopServiceStubs(stubs);
    }
  });

  it('resolves a lone service from the shared base as it always has', async () => {
    const stubs = await startServiceStubs();
    try {
      const env = { LIFE_OPS_SERVICE: 'todo', LIFE_OPS_API_BASE: stubs.todo.baseUrl };

      const outcome = await driveCli(['todos', 'get', '--id', 'todo-a'], env);

      expect(outcome.exit).toBe(SUCCESS_EXIT);
      expect(pathsOf(stubs.todo)).toEqual(OWNING_PATHS.todo);
    } finally {
      await stopServiceStubs(stubs);
    }
  });

  it('fails naming the per-service variable two services are missing', async () => {
    const env = {
      LIFE_OPS_SERVICE: 'todo,meal',
      LIFE_OPS_API_BASE_TODO: UNREACHABLE_API,
    };

    const outcome = await driveCli(['entries', 'get', '--id', 'entry-a'], env);

    expect(outcome.exit).toBe(FAILURE_EXIT);
    expect(outcome.text).toBe(
      'LIFE_OPS_API_BASE_MEAL is not set; point it at the meal service API base',
    );
  });
});

describe('one login token for every service', () => {
  let idp: StubIdp;
  let savedResource: string | undefined;
  let savedAudienceMap: string | undefined;

  beforeAll(async () => {
    savedResource = process.env.LIFE_OPS_RESOURCE;
    savedAudienceMap = process.env.OIDC_AUDIENCE_MAP;
    process.env.LIFE_OPS_RESOURCE = LIFE_OPS_RESOURCE;
    process.env.OIDC_AUDIENCE_MAP = OIDC_AUDIENCE_MAP;
    idp = await startStubIdp();
  });

  afterAll(async () => {
    restoreEnvironmentVariable('LIFE_OPS_RESOURCE', savedResource);
    restoreEnvironmentVariable('OIDC_AUDIENCE_MAP', savedAudienceMap);
    await idp.stop();
  });

  it('authenticates a call to every loaded service with that one token', async () => {
    const tokens = await loginOncePerRun();
    const stubs = await startServiceStubs();
    try {
      const outcomes = await driveEveryService(multiServiceEnv(stubs));

      expect(outcomes.map((outcome) => outcome.exit)).toEqual([
        SUCCESS_EXIT,
        SUCCESS_EXIT,
        SUCCESS_EXIT,
      ]);
      expect(authorizationsOf(stubs)).toEqual({
        todo: `Bearer ${tokens.accessToken}`,
        meal: `Bearer ${tokens.accessToken}`,
        notes: `Bearer ${tokens.accessToken}`,
      });
    } finally {
      await stopServiceStubs(stubs);
    }
  });

  it('asks one unchanged client for the one life-ops resource', async () => {
    await loginOncePerRun();

    expect(idp.grants()).toEqual([
      { clientId: DEV_CLIENT_ID, resource: LIFE_OPS_RESOURCE, audience: LIFE_API_AUDIENCE },
    ]);
  });

  /**
   * The run's single `login`. `login` takes the fixed `CALLBACK_PORT` 8080
   * (`src/auth/login.ts:56`), and the auth and token-provider suites need it too,
   * so a third fixed-port login is reserved for the describe's lifetime and one
   * more worker holding 8080 fails a neighbour. One login, awaited by both cases,
   * is the run's one authenticated session.
   */
  let loginOnce: Promise<StoredTokens> | undefined;
  function loginOncePerRun(): Promise<StoredTokens> {
    loginOnce ??= login({ issuer: idp.issuer, openBrowser: idp.openBrowser });
    return loginOnce;
  }
});

/** Puts an environment variable back the way this suite found it. */
function restoreEnvironmentVariable(name: string, savedValue: string | undefined): void {
  if (savedValue === undefined) delete process.env[name];
  else process.env[name] = savedValue;
}

type ServiceName = 'todo' | 'meal' | 'notes';

/** The three service stub bases one seeded row per module sits on. */
interface ServiceStubs {
  todo: StubApi;
  meal: StubApi;
  notes: StubApi;
}

/** One collection a stub serves: its base path and the rows every case starts from. */
interface SeededCollection {
  basePath: string;
  seed: () => SampleRow[];
}

interface CliOutcome {
  exit: number;
  text: string;
}

function startServiceStubs(): Promise<ServiceStubs> {
  return startInOrder([TODO_COLLECTION, MEAL_COLLECTION, NOTES_COLLECTION]).then(
    ([todo, meal, notes]) => ({ todo, meal, notes }),
  );
}

/** Started one after another so the arrival order of a failure stays readable. */
async function startInOrder(collections: SeededCollection[]): Promise<StubApi[]> {
  const stubs: StubApi[] = [];
  for (const collection of collections) stubs.push(await startSeededStub(collection));
  return stubs;
}

/** `DELETE` keeps the row, so a module that trashes never diverges from its stub. */
function startSeededStub(collection: SeededCollection): Promise<StubApi> {
  return startStubApi({
    ownerSubject: OWNER_SUBJECT,
    rows: collection.seed(),
    collectionPath: collection.basePath,
    deletePolicy: 'trash',
  });
}

async function stopServiceStubs(stubs: ServiceStubs): Promise<void> {
  for (const stub of [stubs.todo, stubs.meal, stubs.notes]) await stub.stop();
}

/** The environment one multi-service run reads: the selector plus one base per service. */
function multiServiceEnv(stubs: ServiceStubs): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LIFE_OPS_SERVICE: SELECTOR,
    LIFE_OPS_API_BASE_TODO: stubs.todo.baseUrl,
    LIFE_OPS_API_BASE_MEAL: stubs.meal.baseUrl,
    LIFE_OPS_API_BASE_NOTES: stubs.notes.baseUrl,
  };
}

async function driveCli(argv: string[], env: NodeJS.ProcessEnv): Promise<CliOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exit = await runCli({
    argv,
    service: () => loadService(env),
    env,
    stdout: (line) => {
      stdout.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
    },
    signIn: async () => {},
  });
  return { exit, text: (exit === SUCCESS_EXIT ? stdout : stderr).join('\n') };
}

/** One `get` per module, each addressing the row that module's own stub seeded. */
function driveEveryService(env: NodeJS.ProcessEnv): Promise<CliOutcome[]> {
  return Promise.all([
    driveCli(['todos', 'get', '--id', 'todo-a'], env),
    driveCli(['entries', 'get', '--id', 'entry-a'], env),
    driveCli(['notes', 'get', '--id', 'note-a'], env),
  ]);
}

/** What each stub received, in arrival order; an empty list is the assertion that nothing reached it. */
function requestPathsOf(stubs: ServiceStubs): Record<ServiceName, string[]> {
  return {
    todo: pathsOf(stubs.todo),
    meal: pathsOf(stubs.meal),
    notes: pathsOf(stubs.notes),
  };
}

function pathsOf(stub: StubApi): string[] {
  return stub.requestLog.map((recorded) => recorded.path);
}

function authorizationsOf(stubs: ServiceStubs): Record<ServiceName, string | undefined> {
  return {
    todo: authorizationOf(stubs.todo),
    meal: authorizationOf(stubs.meal),
    notes: authorizationOf(stubs.notes),
  };
}

function authorizationOf(stub: StubApi): string | undefined {
  return stub.requestLog[0]?.headers['authorization'];
}

async function mcpServerOver(env: NodeJS.ProcessEnv): Promise<McpServer> {
  const service = await loadService(env);
  return createMcpServer({
    registry: service.resources ?? service.registry,
    modules: service.modules,
    env,
    stdout: () => {},
    stderr: () => {},
  });
}

function toolsRequest(): Record<string, unknown> {
  return { jsonrpc: '2.0', id: 1, method: 'tools/list' };
}

function toolCallRequest(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } };
}

function toolNamesOf(reply: unknown): string[] {
  const result = reply as { result: { tools: { name: string }[] } };
  return result.result.tools.map((tool) => tool.name);
}

function failedOf(reply: unknown): boolean {
  const result = reply as { result?: { isError?: boolean } };
  return result.result?.isError === true;
}

function resourceNamesOf(service: ServiceModule): string[] {
  return (service.resources ?? [service.registry]).map((resource) => resource.name);
}

function expectedToolNames(): string[] {
  return Object.entries(EXPECTED_OPS).flatMap(([resource, kinds]) =>
    kinds.map((kind) => `${resource}_${kind}`),
  );
}
