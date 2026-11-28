import { ConsoleLogger, type ConsoleLoggerOptions, type LogLevel } from '@nestjs/common';

/**
 * The levels every service runs at, in the order `@nestjs/common` expects them.
 *
 * `debug` and `verbose` are deliberately absent: at the default level both are
 * off, so the surviving console is the one an operator reads — warnings, errors,
 * and the lifecycle lines that say the process came up.
 */
export const SERVICE_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log'];

/**
 * Nest's boot-time route mappers. Both print one `log` line per controller and
 * per route — a hundred lines of `Mapped {/notes, GET} route` before the first
 * request is served. Their `warn` and `error` are real (a route that fails to
 * register, a host pattern the adapter cannot filter), so only `log` is dropped.
 */
const BOOT_ROUTE_CONTEXTS: ReadonlySet<string> = new Set(['RouterExplorer', 'RoutesResolver']);

/**
 * The logger the eight Nest services pass to `NestFactory.create`.
 *
 * It is `ConsoleLogger` unchanged — same format, same colours — minus the one
 * group of lines nobody reads twice. Suppression keys on context AND level, never
 * on the message text: matching a substring is how a real warning gets swallowed
 * once the wording of a log line changes.
 */
export class ServiceLogger extends ConsoleLogger {
  constructor(options: ConsoleLoggerOptions = {}) {
    super({ logLevels: SERVICE_LOG_LEVELS, ...options });
  }

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, any>,
  ): void {
    if (logLevel === 'log' && BOOT_ROUTE_CONTEXTS.has(context)) return;
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, params);
  }
}
