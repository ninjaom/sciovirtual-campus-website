import { admin, json, type Env } from './env'

/**
 * For admin-only server functions: checks the caller's Campus sign-in
 * (the "Authorization: Bearer <token>" the site sends) and that they're an
 * admin. Returns an error response to send back, or null when allowed.
 */
export async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ ok: false, error: 'signed_out' }, 401)
  const db = admin(env)
  const { data: user, error } = await db.auth.getUser(token)
  if (error || !user?.user) return json({ ok: false, error: 'signed_out' }, 401)
  const { data: person } = await db.from('people').select('role').eq('auth_user_id', user.user.id).maybeSingle()
  if (person?.role !== 'admin') return json({ ok: false, error: 'admins_only' }, 403)
  return null
}
