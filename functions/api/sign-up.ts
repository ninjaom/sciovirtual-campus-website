// POST /api/sign-up { id, code, password, username?, recoveryEmail? }
// First sign-up creates the account; a code issued by an admin reset
// just sets a new password.
import { admin, json, logAttempt, readJson, type PagesFunction } from '../../server/env'
import { matchCode } from '../../server/codes'
import { EMAIL_RE, internalEmail, MIN_PASSWORD, USERNAME_RE } from '../../server/shared'

interface Body {
  id: string
  code: string
  password: string
  username: string
  recoveryEmail: string
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const body = await readJson<Body>(request)
  const fail = (error: string, status = 400) => json({ ok: false, error }, status)
  try {
    const db = admin(env)
    const { match, result } = await matchCode(db, body.id ?? '', body.code ?? '')
    if (!match) return json(result, result.error === 'rate_limited' ? 429 : 400)

    const password = body.password ?? ''
    if (password.length < MIN_PASSWORD) return fail('password_short')

    // Password reset with an admin-issued code
    if (match.authUserId) {
      const { error } = await db.auth.admin.updateUserById(match.authUserId, { password })
      if (error) return fail('server', 500)
      await db.from('setup_codes').update({ used_at: new Date().toISOString() }).eq('id', match.codeId)
      await logAttempt(db, match.personCode, true)
      return json({ ok: true, kind: 'reset' })
    }

    // New account
    const recoveryEmail = (body.recoveryEmail ?? '').trim()
    if (!EMAIL_RE.test(recoveryEmail)) return fail('email_format')
    let username: string | null = null
    if (match.role === 'student') {
      username = (body.username ?? '').trim()
      if (!USERNAME_RE.test(username)) return fail('username_format')
      const { data: taken } = await db.from('people').select('id').eq('username', username).maybeSingle()
      if (taken) return fail('username_taken')
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email: internalEmail(match.personCode),
      password,
      email_confirm: true,
      app_metadata: { person_id: match.personId },
    })
    if (createErr || !created.user) return fail('server', 500)

    const { error: linkErr } = await db
      .from('people')
      .update({ auth_user_id: created.user.id, username, recovery_email: recoveryEmail, signed_up_at: new Date().toISOString() })
      .eq('id', match.personId)
    if (linkErr) {
      // Undo so the code can be tried again (e.g. username taken at the same moment).
      await db.auth.admin.deleteUser(created.user.id)
      return fail(linkErr.code === '23505' ? 'username_taken' : 'server', linkErr.code === '23505' ? 400 : 500)
    }
    await db.from('setup_codes').update({ used_at: new Date().toISOString() }).eq('id', match.codeId)
    await logAttempt(db, match.personCode, true)
    return json({ ok: true, kind: 'new' })
  } catch {
    return fail('server', 500)
  }
}
