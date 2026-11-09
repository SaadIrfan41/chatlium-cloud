import 'server-only';
import { loadConfig, type Config } from '@chatlium/config';
import { createLogger, type Logger } from '@chatlium/observability';

let cached: Config | undefined;

/** Validated configuration. Loaded once; a broken environment fails on first use with a clear list. */
export function config(): Config {
  cached ??= loadConfig();
  return cached;
}

let logger: Logger | undefined;

export function log(): Logger {
  logger ??= createLogger({ service: 'web', level: config().LOG_LEVEL });
  return logger;
}
