import { createClient } from '@supabase/supabase-js'

/** Settings and secrets set in Cloudflare Pages, never in the repo. */
export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string // the project's secret key (sb_secret_...)
  SITE_URL?: string // e.g. https://sciovirtual-campus.pages.dev
  RESEND_API_KEY?: string // email service for password-reset links
  MAIL_FROM?: string // e.g. "ScioVirtual Campus <campus@sciovirtual.org>"
}

export type PagesFunction<E = Env> = (ctx: { request: Request; env: E }) => Promise<Response>

export function admin(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server is missing Supabase settings')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>
  } catch {
    return {}
  }
}

const WINDOW_MIN = 15
const MAX_FAILS = 5

/** True if this ID has had too many failed attempts recently. */
export async function rateLimited(db: ReturnType<typeof admin>, key: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString()
  const { count } = await db
    .from('signup_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('person_code', key)
    .eq('ok', false)
    .gte('at', since)
  return (count ?? 0) >= MAX_FAILS
}

export async function logAttempt(db: ReturnType<typeof admin>, key: string, ok: boolean) {
  await db.from('signup_attempts').insert({ person_code: key, ok })
}
