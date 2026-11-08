/**
 * The Node-only surface of `@life/shared`, reached as `@life/shared/node`.
 *
 * `resolveDbPath` imports `node:path`, and the barrel is imported by browser
 * code (`apps/app` via `packages/ui`), so bundlers had to carry a Node builtin
 * into the client graph for an export only servers call. Keeping the Node-only
 * exports behind this subpath keeps the barrel browser-safe; the barrel itself
 * must never re-export anything from here.
 *
 * `packages/shared/src/index.ts` is unchanged in kind — only this subpath may
 * import `node:*` builtins.
 */
export { resolveDbPath } from './db-path';
