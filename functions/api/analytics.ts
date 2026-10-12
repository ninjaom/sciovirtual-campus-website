// POST /api/analytics { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }  (admins only)
// Page views and visits per day and per page, from Cloudflare Web Analytics.
// Needs three settings in Cloudflare Pages (never in the repo):
//   CF_API_TOKEN   a read-only token with "Account Analytics: Read"
//   CF_ACCOUNT_ID  the Cloudflare account ID
//   CF_SITE_TAG    the Web Analytics site tag for the Campus site
// Without them the page shows "not connected yet".
import { json, readJson, type Env, type PagesFunction } from '../../server/env'
import { requireAdmin } from '../../server/requireAdmin'

interface AnalyticsEnv extends Env {
  CF_API_TOKEN?: string
  CF_ACCOUNT_ID?: string
  CF_SITE_TAG?: string
}

const QUERY = `query ($account: String!, $site: String!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      byDay: rumPageloadEventsAdaptiveGroups(limit: 100, filter: { siteTag: $site, datetime_geq: $start, datetime_leq: $end }, orderBy: [date_ASC]) {
        count
        sum { visits }
        dimensions { date }
      }
      byPath: rumPageloadEventsAdaptiveGroups(limit: 200, filter: { siteTag: $site, datetime_geq: $start, datetime_leq: $end }, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { requestPath }
      }
    }
  }
}`

const DAY = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)

export const onRequestPost: PagesFunction<AnalyticsEnv> = async ({ request, env }) => {
  try {
    const denied = await requireAdmin(request, env)
    if (denied) return denied
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_SITE_TAG) return json({ ok: true, connected: false })

    const body = await readJson<{ start: string; end: string }>(request)
    const end = new Date((body.end ?? iso(new Date())) + 'T00:00:00Z')
    // Cloudflare keeps about 6 months; queries are split into 30-day windows.
    const earliest = new Date(Date.now() - 180 * DAY)
    let start = new Date((body.start ?? iso(new Date(Date.now() - 13 * DAY))) + 'T00:00:00Z')
    if (start < earliest) start = earliest
    if (!(start <= end)) return json({ ok: false, error: 'bad_range' }, 400)

    const days = new Map<string, { views: number; visits: number }>()
    const paths = new Map<string, { views: number; visits: number }>()
    for (let from = start; from <= end; from = new Date(from.getTime() + 30 * DAY)) {
      const to = new Date(Math.min(end.getTime(), from.getTime() + 29 * DAY))
      const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { account: env.CF_ACCOUNT_ID, site: env.CF_SITE_TAG, start: iso(from) + 'T00:00:00Z', end: iso(to) + 'T23:59:59Z' } }),
      })
      const out = (await res.json()) as {
        data?: { viewer: { accounts: { byDay: Row<'date'>[]; byPath: Row<'requestPath'>[] }[] } }
        errors?: { message: string }[] | null
      }
      if (!res.ok || out.errors?.length || !out.data) return json({ ok: false, error: 'cloudflare' }, 502)
      const acc = out.data.viewer.accounts[0]
      for (const r of acc?.byDay ?? []) add(days, r.dimensions.date, r)
      for (const r of acc?.byPath ?? []) add(paths, r.dimensions.requestPath, r)
    }
    return json({
      ok: true,
      connected: true,
      days: [...days].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      paths: [...paths].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.views - a.views),
    })
  } catch {
    return json({ ok: false, error: 'server' }, 500)
  }
}

type Row<K extends string> = { count: number; sum: { visits: number }; dimensions: Record<K, string> }
function add(map: Map<string, { views: number; visits: number }>, key: string, r: { count: number; sum: { visits: number } }) {
  const v = map.get(key) ?? { views: 0, visits: 0 }
  v.views += r.count
  v.visits += r.sum?.visits ?? 0
  map.set(key, v)
}
