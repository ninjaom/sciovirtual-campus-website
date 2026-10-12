// POST /api/fetch-sheet { url }  (admins only)
// Feedback Imports: downloads a Google Form responses sheet as CSV, so the
// browser can read it (browsers can't fetch Google Sheets directly). The
// sheet must be shared as "Anyone with the link can view".
import { json, readJson, type PagesFunction } from '../../server/env'
import { requireAdmin } from '../../server/requireAdmin'

const MAX_BYTES = 5 * 1024 * 1024

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const denied = await requireAdmin(request, env)
    if (denied) return denied
    const { url } = await readJson<{ url: string }>(request)
    const m = String(url ?? '').match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
    if (!m) return json({ ok: false, error: 'not_a_sheet' }, 400)
    const gid = String(url).match(/[#&?]gid=(\d+)/)?.[1]
    const target = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`
    const res = await fetch(target, { redirect: 'follow' })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.includes('text/csv')) return json({ ok: false, error: 'not_shared' }, 400)
    const text = await res.text()
    if (text.length > MAX_BYTES) return json({ ok: false, error: 'too_big' }, 400)
    return json({ ok: true, csv: text })
  } catch {
    return json({ ok: false, error: 'server' }, 500)
  }
}
