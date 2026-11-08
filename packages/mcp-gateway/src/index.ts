/**
 * `@life/mcp-gateway` entry (SPEC-mcp-gateway §4): the one stdio server a client registers, and
 * the options it is built from. The layers it composes stay internal, so a caller cannot come to
 * depend on how an upstream is reached or where the cache lives.
 */
export { createMcpServer, main } from './server';
export type { McpServer, McpServerOptions } from './server';
