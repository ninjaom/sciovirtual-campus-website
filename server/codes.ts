import { admin, logAttempt, rateLimited } from './env'
import { normalizeCode, normalizeId, type CheckCodeResult } from './shared'

type Db = ReturnType<typeof admin>

export interface CodeMatch {
  personId: string
  codeId: string
  authUserId: string | null
  role: 'student' | 'instructor' | 'admin'
  personCode: string
}

/** Checks an ID + setup code pair, with rate limiting. */
export async function matchCode(db: Db, rawId: string, rawCode: string): Promise<{ match?: CodeMatch; result: CheckCodeResult }> {
  const id = normalizeId(rawId ?? '')
  const code = normalizeCode(rawCode ?? '')
  if (!id || !code) return { result: { ok: false, error: 'invalid_code' } }
  if (await rateLimited(db, id)) return { result: { ok: false, error: 'rate_limited' } }

  const { data: person } = await db.from('people').select('id, auth_user_id, role, person_code').eq('person_code', id).maybeSingle()
  const { data: codeRow } = person
    ? await db.from('setup_codes').select('id, code').eq('person_id', person.id).is('used_at', null).maybeSingle()
    : { data: null }

  if (!person || !codeRow || codeRow.code !== code) {
    await logAttempt(db, id, false)
    return { result: { ok: false, error: 'invalid_code' } }
  }
  return {
    match: { personId: person.id, codeId: codeRow.id, authUserId: person.auth_user_id, role: person.role, personCode: person.person_code },
    result: { ok: true, kind: person.auth_user_id ? 'reset' : 'new', role: person.role },
  }
}
