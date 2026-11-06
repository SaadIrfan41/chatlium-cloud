import { envSchema, type Config } from './schema.ts';

export interface ConfigProblem {
  readonly variable: string;
  readonly problem: string;
}

/**
 * Thrown when the environment is incomplete or invalid. The message lists every
 * problem at once, by variable name only. It never contains a variable's value.
 */
export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    const lines = problems.map((p) => `  - ${p.variable}: ${p.problem}`);
    super(`Invalid configuration (${problems.length} problem(s)):\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Parses and validates the environment. Call once at process start.
 * Empty strings are treated as unset, so `FOO=` in a .env file counts as missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );

  const result = envSchema.safeParse(input, { reportInput: false });
  if (result.success) {
    return Object.freeze(result.data);
  }

  const problems = result.error.issues.map((issue) => {
    const variable = issue.path.map(String).join('.') || '(environment)';
    const missing = issue.code === 'invalid_type' && !(variable in input);
    return { variable, problem: missing ? 'is required' : issue.message };
  });
  throw new ConfigError(problems);
}
