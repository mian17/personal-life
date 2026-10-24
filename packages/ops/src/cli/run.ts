#!/usr/bin/env node
/**
 * The `life-ops` bin entry (SPEC.md §3 CLI): the CLI adapter itself. It loads the
 * service module pointed to by `LIFE_OPS_SERVICE`, parses the user's arguments,
 * validates them locally through the shared core executor, sends them to the
 * service API over the shared HTTP executor, and renders one canonical output
 * shape. It defines no validation, wire, transport, auth, or error logic — an
 * adapter that restates any of them is a bug (SPEC.md §3, DRY rule).
 *
 * Output parity with the MCP adapter is a string comparison on `renderOpsResult`
 * and `renderFailure`, so both adapters render through `./render`.
 */
import type { ResourceRegistry } from '../core/types';
import { createExecutor, resolveDeadlineMs } from '../transport/executor';
import { currentAccessToken } from '../auth/token-provider';
import { clearTokens } from '../auth/token-store';
import { login } from '../auth/login';
import { renderFailure, renderOpsResult } from './render';
import { commandName, parseCallCommand } from './parse';

/** One registered service: the registry its adapters render and the API it speaks to. */
export interface ServiceModule {
  registry: ResourceRegistry;
  /** Overrides `LIFE_OPS_API_BASE` when the module knows its own base. */
  apiBase?: string;
}

export interface MainOptions {
  argv: string[];
  /** The loaded service; the runner stays free of module resolution. */
  service: ServiceModule;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Runs the IdP dance; injectable so the auth suite drives a stub IdP. */
  signIn: () => Promise<void>;
}

const SUCCESS_EXIT = 0;
const FAILURE_EXIT = 1;

/** The whole program: dispatch once, render once, answer with an exit code. */
export async function main(options: MainOptions): Promise<number> {
  try {
    return await dispatch(options);
  } catch (error) {
    options.stderr(renderFailure(error));
    return FAILURE_EXIT;
  }
}

function dispatch(options: MainOptions): Promise<number> {
  const name = commandName(options.argv);
  if (name === 'login') return logIn(options);
  if (name === 'logout') return logOut(options);
  return runCall(options);
}

async function logIn(options: MainOptions): Promise<number> {
  await options.signIn();
  options.stdout('logged in');
  return SUCCESS_EXIT;
}

async function logOut(options: MainOptions): Promise<number> {
  await clearTokens();
  options.stdout('logged out');
  return SUCCESS_EXIT;
}

async function runCall(options: MainOptions): Promise<number> {
  const command = parseCallCommand(options.argv, options.service.registry);
  const executor = createExecutor({
    registry: options.service.registry,
    baseUrl: apiBase(options),
    readToken: currentAccessToken,
    deadlineMs: resolveDeadlineMs(options.env),
  });
  options.stdout(renderOpsResult(await executor.run(command.operation.kind, command.input)));
  return SUCCESS_EXIT;
}

function apiBase(options: MainOptions): string {
  const configured = options.service.apiBase ?? options.env.LIFE_OPS_API_BASE?.trim();
  if (!configured) throw new Error('LIFE_OPS_API_BASE is not set; point it at the service API base');
  return configured;
}

/** Loads the service module named by `LIFE_OPS_SERVICE`; exportable for test-only loading in-process. */
export async function loadService(env: NodeJS.ProcessEnv): Promise<ServiceModule> {
  const modulePath = env.LIFE_OPS_SERVICE?.trim();
  if (!modulePath) throw new Error('LIFE_OPS_SERVICE is not set; point it at a registry module');
  const exported = (await import(modulePath)) as {
    service?: ServiceModule;
    registry?: ResourceRegistry;
    apiBase?: string;
  };
  if (exported.service !== undefined) return exported.service;
  if (exported.registry !== undefined) return { registry: exported.registry, apiBase: exported.apiBase };
  throw new Error(`LIFE_OPS_SERVICE module ${modulePath} exports no service registry`);
}

/** The `bin` runner: read the environment, load the service, dispatch, exit. */
async function runBin(): Promise<void> {
  try {
    process.exitCode = await main({
      argv: process.argv.slice(2),
      service: await loadService(process.env),
      env: process.env,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
      signIn: async () => {
        await login();
      },
    });
  } catch (error) {
    process.stderr.write(`${renderFailure(error)}\n`);
    process.exitCode = FAILURE_EXIT;
  }
}

if (require.main === module) {
  void runBin();
}
