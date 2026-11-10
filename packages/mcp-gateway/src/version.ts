/**
 * The `serverInfo.version` a library caller gets when it names none: a library caller is not
 * the published package, so it does not get to claim the package's version. The stdio entry
 * (`entry.ts`) reads `package.json` and passes the real one, and the suites pin that handshake.
 */
export const DEVELOPMENT_VERSION = '0.0.0-dev';
