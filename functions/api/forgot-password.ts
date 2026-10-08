// POST /api/forgot-password { id }
// Emails a reset link to the account's recovery email. Always answers the
// same way, so nobody can use it to find out which IDs exist.
import { admin, json, logAttempt, rateLimited, readJson, type Env, type PagesFunction } from '../../server/env'
import { internalEmail, normalizeId } from '../../server/shared'

async function sendResetEmail(env: Env, to: string, link: string) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.warn('Reset email not sent: no email service configured')
    return
  }
  const text =
    'Hi!\n\nSomeone asked to reset the password for a ScioVirtual Campus account that uses this email. ' +
    'To choose a new password, open this link (it expires in 1 hour):\n\n' +
    link +
    "\n\nIf you didn't ask for this, you can ignore this email.\n\nScioVirtual"
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject: 'Reset your ScioVirtual Campus password', text }),
  })
  // Shows in Cloudflare's function logs (no addresses or links logged).
  if (res.ok) console.log('forgot-password: email sent')
  else console.error('forgot-password: email service error', res.status, await res.text())
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const body = await readJson<{ id: string }>(request)
  const id = normalizeId(body.id ?? '')
  const done = json({ ok: true })
  if (!id) return done
  try {
    const db = admin(env)
    const key = 'reset:' + id
    if (await rateLimited(db, key)) {
      console.warn('forgot-password: too many requests for this ID')
      return done
    }
    await logAttempt(db, key, false) // counts toward the limit either way

    const { data: person } = await db.from('people').select('auth_user_id, recovery_email').eq('person_code', id).maybeSingle()
    if (!person?.auth_user_id || !person.recovery_email) {
      console.warn('forgot-password: no account or no recovery email for this ID')
      return done
    }

    const site = env.SITE_URL ?? new URL(request.url).origin
    const { data, error } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: internalEmail(id),
      options: { redirectTo: `${site}/reset-password` },
    })
    if (error || !data.properties?.action_link) {
      console.error('forgot-password: could not create reset link', error?.message)
      return done
    }
    await sendResetEmail(env, person.recovery_email, data.properties.action_link)
  } catch (e) {
    // Same answer to the browser either way.
    console.error('forgot-password: failed', e instanceof Error ? e.message : e)
  }
  return done
}
