/**
 * Structured logger. Emits JSON to stdout in production (so CloudWatch Logs
 * parses it natively), pretty-printed lines in development.
 *
 * Use a consistent shape so search and dashboards work:
 *   { ts, level, msg, context?, err?, ...fields }
 *
 *   log.info('payment posted', { paymentId, entityId, amount })
 *   log.error('payment failed', err, { paymentId })
 *
 * Sensitive data (passwords, secrets, account numbers) must NEVER be logged.
 * If you must log a user identifier, prefer userId over email.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function envLevel(): number {
  const env = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'))
    .toLowerCase() as Level
  return LEVELS[env] ?? LEVELS.info
}

const MIN_LEVEL = envLevel()
const PRETTY = process.env.NODE_ENV !== 'production'

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < MIN_LEVEL) return
  const entry = { ts: new Date().toISOString(), level, msg, ...fields }
  if (PRETTY) {
    const colorize: Record<Level, string> = {
      debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m',
    }
    const reset = '\x1b[0m'
    const extra = Object.keys(fields).length
      ? ' ' + JSON.stringify(fields)
      : ''
    process.stdout.write(
      `${colorize[level]}${level.toUpperCase().padEnd(5)}${reset} ${entry.ts} ${msg}${extra}\n`
    )
  } else {
    process.stdout.write(JSON.stringify(entry) + '\n')
  }
}

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return {
      err: {
        name: e.name,
        message: e.message,
        stack: e.stack,
        // Include any custom properties.
        ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'stack')),
      },
    }
  }
  return { err: { value: String(e) } }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info:  (msg: string, fields?: Record<string, unknown>) => emit('info',  msg, fields),
  warn:  (msg: string, fields?: Record<string, unknown>) => emit('warn',  msg, fields),
  error: (msg: string, err?: unknown, fields?: Record<string, unknown>) =>
    emit('error', msg, { ...(err !== undefined ? serializeError(err) : {}), ...(fields ?? {}) }),
}

/** Run an async fn, log errors with context, and re-throw. Useful in routes. */
export async function withLog<T>(name: string, fn: () => Promise<T>, fields?: Record<string, unknown>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    log.info(name, { ...fields, ms: Date.now() - start })
    return result
  } catch (e) {
    log.error(name, e, { ...fields, ms: Date.now() - start })
    throw e
  }
}
