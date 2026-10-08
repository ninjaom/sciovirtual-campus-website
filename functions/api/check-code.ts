// POST /api/check-code { id, code }
// Tells the sign-up page whether this is a new account or a password reset.
import { admin, json, readJson, type PagesFunction } from '../../server/env'
import { matchCode } from '../../server/codes'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const body = await readJson<{ id: string; code: string }>(request)
  try {
    const { result } = await matchCode(admin(env), body.id ?? '', body.code ?? '')
    return json(result, result.ok ? 200 : result.error === 'rate_limited' ? 429 : 400)
  } catch {
    return json({ ok: false, error: 'server' }, 500)
  }
}
