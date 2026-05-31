import { log } from './logger'

/**
 * Error-reporting hook. Designed for Sentry but works as a no-op without it.
 *
 * To enable Sentry:
 *  1. `npm install @sentry/nextjs`
 *  2. Set SENTRY_DSN in your environment
 *  3. Replace the body of `reportError` below with `Sentry.captureException(...)`
 *
 * Until then, errors are logged via the structured logger. This means the
 * surface is ready for Sentry but the project doesn't carry the dep weight
 * until you opt in.
 */

interface ReportContext {
  userId?: string
  entityId?: string
  route?: string
  [key: string]: unknown
}

let sentryClient: { captureException?: (e: unknown, ctx?: unknown) => void } | null = null

if (process.env.SENTRY_DSN) {
  // Lazy require: doesn't fail at build time if the package isn't installed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentryClient = require('@sentry/nextjs')
    log.info('Sentry initialized via @sentry/nextjs')
  } catch {
    log.warn('SENTRY_DSN set but @sentry/nextjs not installed; falling back to logger')
  }
}

export function reportError(err: unknown, ctx?: ReportContext): void {
  log.error(ctx?.route ? `error: ${ctx.route}` : 'error', err, ctx)
  if (sentryClient?.captureException) {
    try { sentryClient.captureException(err, { tags: ctx }) } catch { /* swallow */ }
  }
}

export function isSentryEnabled(): boolean {
  return sentryClient !== null
}
