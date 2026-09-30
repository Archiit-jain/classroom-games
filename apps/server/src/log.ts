export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

type Fields = Record<string, unknown>;

export interface Logger {
  error(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  debug(msg: string, fields?: Fields): void;
}

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** Structured JSON-lines logger. Never log chat text, drawings or tokens. */
export function createLogger(level: LogLevel): Logger {
  const write = (at: Exclude<LogLevel, 'silent'>, msg: string, fields?: Fields) => {
    if (ORDER[at] > ORDER[level]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level: at, msg, ...fields });
    if (at === 'error' || at === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    error: (msg, fields) => write('error', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
  };
}

export function errorFields(err: unknown): Fields {
  return err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) };
}
