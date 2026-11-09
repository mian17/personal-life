/**
 * The `life-ops` CLI adapter (SPEC.md §3 CLI): a `call` loads
 * the service modules `LIFE_OPS_SERVICE` names — one, or several comma-separated
 * (SPEC-ops-all-services §1.1.2 E3) — parses the user's arguments,
 * validates them locally through the shared core executor, sends them to the
 * service API over the shared HTTP executor, and renders one canonical output
 * shape. It defines no validation, wire, transport, auth, or error logic — an
 * adapter that restates any of them is a bug (SPEC.md §3, DRY rule).
 *
 * Output parity with the MCP adapter is a string comparison on `renderOpsResult`
 * and `renderFailure`, so both adapters render through `./render`.
 */
import type { BulkEnvelope } from '../core/bulk.js';
import { isBulkKind, resolveBulkLimit } from '../core/bulk.js';
import type { OpSpec, ResourceRegistry } from '../core/types.js';
import { toolName } from '../core/schema.js';
import { createExecutor, resolveDeadlineMs } from '../transport/executor.js';
import { currentAccessToken } from '../auth/token-provider.js';
import { clearTokens } from '../auth/token-store.js';
import { renderFailure, renderOpsResult } from './render.js';
import { commandName, parseCallCommand } from './parse.js';

/** One registered service: the registries its adapters render and the API it speaks to. */
export interface ServiceModule {
  /** The module's first resource; a single-resource module registers only this one. */
  registry: ResourceRegistry;
  /** Every resource the module registers, `registry` included, in declaration order. */
  resources?: ResourceRegistry[];
  /** Overrides `LIFE_OPS_API_BASE` when the module knows its own base. */
  apiBase?: string;
  /** Every service `LIFE_OPS_SERVICE` named, in selector order; the loader sets it, a module never does. */
  modules?: LoadedModule[];
}

/** One loaded service module: the entry that selected it, the name its base variable keys on, its resources. */
export interface LoadedModule {
  /** The `LIFE_OPS_SERVICE` entry as written, trimmed. */
  entry: string;
  /** The bare service name when the entry is one; `LIFE_OPS_API_BASE_<NAME>` is keyed on it. */
  name?: string;
  /** The module's own base; no in-package module declares one. */
  apiBase?: string;
  /** Every resource the module registers, in declaration order. */
  resources: ResourceRegistry[];
}

export interface MainOptions {
  argv: string[];
  /**
   * Resolves the service; the runner stays free of module resolution. Only a `call`
   * calls it, so `login`/`logout` work with no `LIFE_OPS_SERVICE` set.
   */
  service: () => Promise<ServiceModule>;
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
  const service = await options.service();
  const registry = registryFor(resourcesOf(service), options.argv);
  const command = parseCallCommand(options.argv, registry);
  const executor = createExecutor({
    registry,
    baseUrl: apiBaseFor({ service, registry, env: options.env }),
    readToken: currentAccessToken,
    deadlineMs: resolveDeadlineMs(options.env),
    bulkLimit: resolveBulkLimit(options.env),
  });
  const result = await executor.run(command.operation.kind, command.input);
  options.stdout(renderOpsResult(result));
  return exitCodeFor(command.operation.kind, result.body);
}

/**
 * A batch where no item succeeded is the one failing call; a partial failure still
 * exits 0. Only a bulk kind reports item counts, so only a bulk call reads them —
 * the MCP adapter gates its own failure signal the same way (§2.7).
 */
function exitCodeFor(kind: OpSpec['kind'], body: unknown): number {
  return failedEveryItem(kind, body) ? FAILURE_EXIT : SUCCESS_EXIT;
}

function failedEveryItem(kind: OpSpec['kind'], body: unknown): boolean {
  return isBulkKind(kind) && (body as Partial<BulkEnvelope> | undefined)?.succeeded === 0;
}

/** The resources a loaded module registers, in declaration order. */
function resourcesOf(service: ServiceModule): ResourceRegistry[] {
  return service.resources ?? [service.registry];
}

/**
 * The resource the argv names; the first one when it names none, so `parseCallCommand`
 * reports the unknown resource in its one canonical shape.
 */
function registryFor(resources: ResourceRegistry[], argv: string[]): ResourceRegistry {
  const [resourceName] = argv;
  return resources.find((resource) => resource.name === resourceName) ?? resources[0];
}

/** One call's base lookup: the loaded services, the resource it dials, and the environment. */
export interface BaseLookup {
  service: ServiceModule;
  registry: ResourceRegistry;
  env: NodeJS.ProcessEnv;
}

/**
 * The base this call dials, by the precedence SPEC-ops-all-services §1.1.2 E3 fixes.
 * Resolved per call, never captured, so one process may dial several services.
 * Exported for the loader suite, which drives the precedence without a socket.
 */
export function apiBaseFor(lookup: BaseLookup): string {
  const owner = owningModule(lookup);
  const configured = configuredBase(owner.apiBase) ?? serviceBase(owner, lookup.env);
  if (configured !== undefined) return configured;
  return sharedBase(lookup, owner);
}

/** The module registering the resource this call dials; the first module when none registers it. */
function owningModule(lookup: BaseLookup): LoadedModule {
  const modules = modulesOf(lookup.service);
  return modules.find((module) => module.resources.includes(lookup.registry)) ?? modules[0];
}

/** The loaded modules; a plain `ServiceModule` answers as one unnamed module owning all its resources. */
function modulesOf(service: ServiceModule): LoadedModule[] {
  if (service.modules !== undefined) return service.modules;
  return [{ entry: '', resources: resourcesOf(service), apiBase: service.apiBase }];
}

/** `LIFE_OPS_API_BASE_<NAME>`, the variable that carries one service's base when several load. */
function serviceBase(module: LoadedModule, env: NodeJS.ProcessEnv): string | undefined {
  if (module.name === undefined) return undefined;
  return configuredBase(env[perServiceBaseName(module.name)]);
}

function perServiceBaseName(serviceName: string): string {
  return `LIFE_OPS_API_BASE_${serviceName.toUpperCase()}`;
}

/** A base variable read as set or unset: surrounding whitespace is noise, an empty value sets nothing. */
function configuredBase(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The shared `LIFE_OPS_API_BASE`: a lone service may still use it, several may never share one base. */
function sharedBase(lookup: BaseLookup, owner: LoadedModule): string {
  const configured = isSoleService(lookup.service)
    ? configuredBase(lookup.env.LIFE_OPS_API_BASE)
    : undefined;
  if (configured !== undefined) return configured;
  throw new Error(missingBaseMessage(lookup.service, owner));
}

function isSoleService(service: ServiceModule): boolean {
  return modulesOf(service).length === 1;
}

/** Names the variable an operator must set, which is the shared one only when one service loads. */
function missingBaseMessage(service: ServiceModule, owner: LoadedModule): string {
  if (isSoleService(service))
    return 'LIFE_OPS_API_BASE is not set; point it at the service API base';
  if (owner.name === undefined) {
    return `LIFE_OPS_SERVICE entry ${owner.entry} is not a bare service name; it needs its own apiBase when several services load`;
  }
  return `${perServiceBaseName(owner.name)} is not set; point it at the ${owner.name} service API base`;
}

/**
 * Loads every service `LIFE_OPS_SERVICE` names, in selector order (SPEC-ops-all-services
 * §1.1.2 E3); exportable for test-only loading in-process.
 */
export async function loadService(env: NodeJS.ProcessEnv): Promise<ServiceModule> {
  const requested = env.LIFE_OPS_SERVICE?.trim();
  if (!requested) throw new Error('LIFE_OPS_SERVICE is not set; point it at a registry module');
  const entries = serviceEntries(requested);
  const resolved = await Promise.all(entries.map(resolveEntry));
  if (resolved.length === 1) return loneService(resolved[0]);
  return unionService(resolved);
}

/** The entries a comma-separated selector names, each trimmed; an empty one fails rather than vanishing. */
function serviceEntries(requested: string): string[] {
  const entries = requested.split(',').map((entry) => entry.trim());
  const firstEmpty = entries.indexOf('');
  if (firstEmpty !== -1) {
    throw new Error(
      `LIFE_OPS_SERVICE entry ${firstEmpty + 1} is empty; name a service or module for every entry`,
    );
  }
  return entries;
}

/** One entry as its module and the owner a base lookup needs, resolved by the rules a lone entry always used. */
interface ResolvedEntry {
  module: ServiceModule;
  owner: LoadedModule;
}

async function resolveEntry(entry: string): Promise<ResolvedEntry> {
  const module = await importServiceModule(moduleSpecifier(entry));
  return {
    module,
    owner: {
      entry,
      name: bareServiceName(entry),
      apiBase: module.apiBase,
      resources: resourcesOf(module),
    },
  };
}

/** A lone entry answers exactly as a single-valued selector always did, plus the owner its call needs. */
function loneService(resolved: ResolvedEntry): ServiceModule {
  return { ...resolved.module, modules: [resolved.owner] };
}

/** The one union both adapters render: every module's resources, in selector order. */
function unionService(resolved: ResolvedEntry[]): ServiceModule {
  const modules = resolved.map((entry) => entry.owner);
  const resources = modules.flatMap((module) => module.resources);
  assertUniqueToolNames(resources);
  return { registry: resources[0], resources, modules };
}

/**
 * The in-package service modules a bare name may select (SPEC-ops-notes-service §9.2,
 * SPEC-ops-all-services §1.1.2 E3). A bare name outside this list fails by name instead
 * of reaching a directory scan or an import of the literal string.
 *
 * ponytail: hand-listed, so a service edits one line here. Add a `src/services`
 * directory read when the list outgrows a screen.
 */
const IN_PACKAGE_SERVICE_NAMES = ['notes', 'todo', 'meal', 'tags', 'focus', 'feedback'] as const;

/** A bare name is an in-package service; anything path-like stays a module specifier. */
function moduleSpecifier(requested: string): string {
  if (!isBareServiceName(requested)) return requested;
  return inPackageServiceSpecifier(requested);
}

function isBareServiceName(requested: string): boolean {
  return !/[/\\]/.test(requested);
}

/** The bare service name an entry carries; a path-like entry names no service variable. */
function bareServiceName(entry: string): string | undefined {
  return isBareServiceName(entry) ? entry : undefined;
}

/**
 * The module specifier a bare name resolves to. The `.js` is required, not cosmetic: this
 * package emits ES modules, and an extensionless specifier only resolves under jest's
 * CommonJS resolver — the dist binary fails on it (ESM requires the extension).
 */
function inPackageServiceSpecifier(serviceName: string): string {
  if (!isInPackageService(serviceName)) throw new Error(unknownServiceMessage(serviceName));
  return `../services/${serviceName}.js`;
}

function isInPackageService(serviceName: string): boolean {
  return (IN_PACKAGE_SERVICE_NAMES as readonly string[]).includes(serviceName);
}

function unknownServiceMessage(serviceName: string): string {
  const known = IN_PACKAGE_SERVICE_NAMES.join(', ');
  return `LIFE_OPS_SERVICE names unknown service ${serviceName}; known services: ${known}`;
}

/** What a service module file declares: exactly one registry form, plus an optional base. */
interface ServiceModuleDeclaration {
  registry?: ResourceRegistry;
  resources?: ResourceRegistry[];
  apiBase?: string;
}

/** The declarations a module file may export: a whole service, a bare registry, or resources. */
interface ModuleExport extends ServiceModuleDeclaration {
  service?: ServiceModuleDeclaration;
}

/** Reads whichever registry shape the module exports, then loads it into one union. */
async function importServiceModule(specifier: string): Promise<ServiceModule> {
  const exported = (await import(specifier)) as ModuleExport;
  const declared = declaredService(exported);
  if (declared === undefined) {
    throw new Error(`LIFE_OPS_SERVICE module ${specifier} exports no service registry`);
  }
  return loadedService(declared);
}

function declaredService(exported: ModuleExport): ServiceModuleDeclaration | undefined {
  if (exported.service !== undefined) return exported.service;
  if (exported.registry !== undefined || exported.resources !== undefined) return exported;
  return undefined;
}

/** The loaded module: its first resource as `registry`, plus every resource the union renders. */
function loadedService(declared: ServiceModuleDeclaration): ServiceModule {
  const resources = declaredResources(declared);
  assertUniqueToolNames(resources);
  return { registry: resources[0], resources: declared.resources, apiBase: declared.apiBase };
}

/** One of the two registry forms, never both and never neither. */
function declaredResources(declared: ServiceModuleDeclaration): ResourceRegistry[] {
  if (declared.registry !== undefined && declared.resources !== undefined) {
    throw new Error(
      'service module exports both registry and resources; export exactly one of the two',
    );
  }
  if (declared.registry !== undefined) return [declared.registry];
  if (declared.resources !== undefined && declared.resources.length > 0) return declared.resources;
  throw new Error(
    'service module exports no registry: declare `registry` or a non-empty `resources`',
  );
}

/** Two resources may not expose the same `<resource>_<op>` tool name (SPEC-ops-all-services §1.1.2). */
function assertUniqueToolNames(resources: ResourceRegistry[]): void {
  const collision = firstToolNameCollision(resources);
  if (collision !== undefined) throw new Error(collisionMessage(collision));
}

interface ToolNameCollision {
  name: string;
  firstResource: ResourceRegistry;
  secondResource: ResourceRegistry;
}

function firstToolNameCollision(resources: ResourceRegistry[]): ToolNameCollision | undefined {
  const owners = new Map<string, ResourceRegistry>();
  for (const resource of resources) {
    for (const operation of resource.ops) {
      const name = toolName(resource, operation);
      const firstResource = owners.get(name);
      if (firstResource !== undefined) {
        return { name, firstResource, secondResource: resource };
      }
      owners.set(name, resource);
    }
  }
  return undefined;
}

/** Names both resources by base path too, because a collision is what identical names produce. */
function collisionMessage(collision: ToolNameCollision): string {
  const { name, firstResource, secondResource } = collision;
  return `resources ${describeResource(firstResource)} and ${describeResource(secondResource)} both register tool name ${name}`;
}

function describeResource(resource: ResourceRegistry): string {
  return `${resource.name} (${resource.basePath})`;
}
