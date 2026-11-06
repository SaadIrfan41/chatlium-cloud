import {
  pino,
  stdTimeFunctions,
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
} from 'pino';
import { redact, redactRecord } from './redact.ts';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerOptions {
  /** Name of the process, for example `web` or `chat-worker`. Written as `service`. */
  readonly service: string;
  readonly level?: LogLevel;
  /** Where log lines go. Defaults to stdout. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
}

export type { Logger };

/**
 * Creates the JSON logger every Chatlium process uses.
 *
 * Each line carries `time` (ISO 8601), `level` (as a label) and `service`. Every object passed
 * to the logger, child bindings and errors included, goes through key-based redaction.
 */
export function createLogger(options: LoggerOptions): Logger {
  const root = pino(
    {
      level: options.level ?? 'info',
      base: { service: options.service },
      messageKey: 'msg',
      timestamp: stdTimeFunctions.isoTime,
      // Replaces pino's err serializer: it keeps message and stack, and redacts fields on the error.
      serializers: { err: redact },
      formatters: {
        level: (label) => ({ level: label }),
        bindings: redactRecord,
        log: redactRecord,
      },
    },
    options.destination,
  );
  return redactChildBindings(root);
}

/**
 * Pino's `formatters.bindings` applies only to the root logger's base bindings, not to
 * `logger.child(bindings)`. Wrap `child` so child bindings are redacted too, at every level.
 */
function redactChildBindings<Levels extends string>(logger: Logger<Levels>): Logger<Levels> {
  const createChild = logger.child.bind(logger);
  const child = <ChildLevels extends string = never>(
    bindings: Bindings,
    childOptions?: ChildLoggerOptions<ChildLevels>,
  ): Logger<Levels | ChildLevels> => {
    const safeBindings = redactRecord(bindings);
    return redactChildBindings(
      childOptions === undefined
        ? createChild<ChildLevels>(safeBindings)
        : createChild<ChildLevels>(safeBindings, childOptions),
    );
  };
  return Object.assign(logger, { child });
}

export interface RequestContext {
  readonly workspaceId?: string;
  readonly requestId?: string;
}

/**
 * Returns a child logger that adds `workspace_id` and `request_id` to every line.
 * Only the fields that are set are added.
 */
export function withContext(logger: Logger, context: RequestContext): Logger {
  return logger.child({
    ...(context.workspaceId === undefined ? {} : { workspace_id: context.workspaceId }),
    ...(context.requestId === undefined ? {} : { request_id: context.requestId }),
  });
}
