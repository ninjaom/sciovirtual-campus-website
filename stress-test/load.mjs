#!/usr/bin/env node
// Campus stress test: a simulated busy camp day against the TEST project.
// See stress-test/README.md. Needs Node 18 or newer; nothing to install.
//
//   node stress-test/load.mjs setup      sign up the script's 27 accounts (once)
//   node stress-test/load.mjs run        the 10-minute busy-day run
//   node stress-test/load.mjs restore    put back any scores/points a run changed
//
// It only ever talks to the project in config.json, refuses the real
// project, and puts back every score and point it changes.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const FILES = {
  config: path.join(DIR, 'config.json'),
  accountsTxt: path.join(DIR, 'accounts.txt'),
  accounts: path.join(DIR, '.accounts.json'), // passwords the script made up; never committed
  changes: path.join(DIR, '.changes.json'), // original values of anything changed, for restore
}
const REAL_PROJECT = 'zulunkjwxqognpgvtjre'
const TEST_EVENT = 'ScioCamp 2027 (test)'

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}
function stop(msg) {
  console.error('\n✗ ' + msg + '\n')
  process.exit(1)
}

const config = readJson(FILES.config, null)
if (!config) stop('config.json is missing. Copy config.example.json to config.json and fill it in (see README.md).')
for (const k of ['supabaseUrl', 'publishableKey']) if (!config[k] || String(config[k]).includes('PASTE')) stop(`config.json: fill in "${k}".`)
if (String(config.supabaseUrl).includes(REAL_PROJECT)) stop('config.json points at the REAL project. This script only runs on the test project.')
const API = String(config.supabaseUrl).replace(/\/+$/, '')
const SITE = String(config.siteUrl || 'https://sciovirtual-campus-website.pages.dev').replace(/\/+$/, '')
const KEY = config.publishableKey

const args = process.argv.slice(2)
const mode = args[0]
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? Number(args[i + 1]) : dflt
}

// ---------------------------------------------------------------------
// Measuring every request
// ---------------------------------------------------------------------
const stats = new Map() // label -> { n, errors, ms[], bytes }
const errorSamples = []
let inFlight = 0
let totalBytes = 0
const now = () => performance.now()

function record(label, ms, bytes, ok, detail) {
  let s = stats.get(label)
  if (!s) stats.set(label, (s = { n: 0, errors: 0, ms: [], bytes: 0 }))
  s.n++
  s.ms.push(ms)
  s.bytes += bytes
  totalBytes += bytes
  if (!ok) {
    s.errors++
    if (errorSamples.length < 15) errorSamples.push(`${label}: ${detail}`)
  }
}
const pct = (arr, p) => {
  if (!arr.length) return 0
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
}

/** One request to the database API as an account, measured. */
async function api(acc, method, pathAndQuery, { body, label, single, prefer, head } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${acc.token}`, Accept: single ? 'application/vnd.pgrst.object+json' : 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const t0 = now()
  inFlight++
  try {
    const res = await fetch(API + '/rest/v1/' + pathAndQuery, {
      method: head ? 'HEAD' : method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const text = head ? '' : await res.text()
    const ms = now() - t0
    const name = label || method + ' ' + pathAndQuery.split('?')[0]
    record(name, ms, Buffer.byteLength(text), res.ok, `${res.status} ${text.slice(0, 160)}`)
    if (!res.ok) return null
    return text ? JSON.parse(text) : null
  } catch (e) {
    record(label || method + ' ' + pathAndQuery.split('?')[0], now() - t0, 0, false, e.name === 'TimeoutError' ? 'timed out after 30 s' : e.message)
    return null
  } finally {
    inFlight--
  }
}
const rpc = (acc, fn, label) => api(acc, 'POST', 'rpc/' + fn, { body: {}, label: label || 'rpc ' + fn })
const ids = (list) => `(${[...new Set(list)].join(',')})`

// ---------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------
const internalEmail = (id) => `${id.trim().toLowerCase()}@accounts.campus.sciovirtual.org`

function parseAccountsTxt() {
  if (!fs.existsSync(FILES.accountsTxt)) return []
  const out = []
  for (const line of fs.readFileSync(FILES.accountsTxt, 'utf8').split(/\r?\n/)) {
    const id = line.match(/\b(ADM27[A-Z]{2}\d{2}|C[A-Z]{2}27[A-Z]{2}\d{2}|27[A-Z]{2}\d{4})\b/i)
    const code = line.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/i)
    if (id && code) out.push({ id: id[1].toUpperCase(), code: code[1].toUpperCase() })
  }
  return out
}

async function signIn(id, password) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: internalEmail(id), password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) return null
  return { token: data.access_token, userId: data.user?.id }
}

async function setup() {
  const saved = readJson(FILES.accounts, {})
  const list = parseAccountsTxt()
  if (!list.length && !Object.keys(saved).length) stop('accounts.txt is empty. Paste the result of supabase/seed/stress_test_accounts.sql into it (see README.md).')
  let made = 0
  for (const { id, code } of list) {
    if (saved[id]) continue
    const password = crypto.randomBytes(18).toString('base64url')
    const student = /^27/.test(id)
    const res = await fetch(`${SITE}/api/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, code, password, username: student ? 'loadtest_' + id.toLowerCase() : '', recoveryEmail: 'loadtest@example.com' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) {
      console.log(`  ${id}: couldn't sign up (${data.error ?? res.status})`)
      continue
    }
    saved[id] = { password }
    writeJson(FILES.accounts, saved)
    made++
    console.log(`  ${id}: signed up`)
  }
  console.log(`\nSigned up ${made} new account(s). Checking that every account can sign in…`)
  let good = 0
  for (const [id, { password }] of Object.entries(saved)) {
    const s = await signIn(id, password)
    if (s) good++
    else console.log(`  ${id}: sign-in failed`)
  }
  console.log(`${good} of ${Object.keys(saved).length} accounts can sign in.`)
  if (good) console.log('\n✓ Setup done. Next: node stress-test/load.mjs run')
}

// ---------------------------------------------------------------------
// The pages (each makes the same requests the real page makes)
// ---------------------------------------------------------------------
async function shell(acc) {
  // Every page: who am I, and my courses
  const me = await api(acc, 'GET', `people?select=id,person_code,first_name,last_name,role,username,avatar_path&auth_user_id=eq.${acc.userId}`, { label: 'every page: my profile' })
  const person = me?.[0]
  if (!person) return null
  acc.personId = person.id
  if (acc.role === 'student') {
    const r = await api(acc, 'GET', `enrollments?select=course:courses(id,short_code,name)&person_id=eq.${person.id}`, { label: 'every page: my courses' })
    acc.courses = (r ?? []).map((x) => x.course).filter(Boolean)
  } else if (acc.role === 'instructor') {
    const r = await api(acc, 'GET', `course_staff?select=course:courses(id,short_code,name)&person_id=eq.${person.id}`, { label: 'every page: my courses' })
    acc.courses = (r ?? []).map((x) => x.course).filter(Boolean)
  } else {
    acc.courses = (await api(acc, 'GET', 'courses?select=id,short_code,name&archived=eq.false&order=name.asc', { label: 'every page: course menu' })) ?? []
  }
  return person
}
async function eventAndSettings(acc) {
  const ev = await api(acc, 'GET', 'events?select=id,name,year,is_current&is_current=eq.true', { label: 'event' })
  acc.eventId = ev?.[0]?.id
  if (acc.eventId) await api(acc, 'GET', `settings?select=*&event_id=eq.${acc.eventId}`, { label: 'settings', single: true })
  return ev?.[0]
}

const PAGES = {
  async studentHome(acc) {
    if (!(await shell(acc))) return
    await eventAndSettings(acc)
    const ev = acc.eventId
    const since = new Date(Date.now() - 48 * 3600e3).toISOString()
    const [updates, ann] = await Promise.all([
      api(acc, 'GET', `camp_updates?select=id,author_id,title,body,attachments,pinned,created_at&event_id=eq.${ev}&order=pinned.desc,created_at.desc`, { label: 'home: camp updates' }),
      api(acc, 'GET', `announcements?select=id,author_id,body,created_at,course:courses(short_code,name)&order=created_at.desc&created_at=gte.${since}&limit=100`, { label: 'home: course announcements' }),
      api(acc, 'GET', `quick_links?select=id,label,page,url&event_id=eq.${ev}&audience=in.(students,both)&order=sort.asc`, { label: 'home: quick links' }),
      acc.courses.length
        ? api(acc, 'GET', `courses?select=id,short_code,name,time_slot,zoom_join_url,sessions(number)&id=in.${ids(acc.courses.map((c) => c.id))}&order=name.asc`, { label: "home: today's schedule" })
        : null,
      rpc(acc, 'get_my_standing', 'home: Your Standing'),
    ])
    const authors = [...(updates ?? []), ...(ann ?? [])].map((x) => x.author_id).filter(Boolean)
    if (authors.length) await api(acc, 'GET', `people_directory?select=id,first_name,last_name,role,avatar_path&id=in.${ids(authors)}`, { label: 'home: author names' })
  },

  async leaderboard(acc) {
    if (!(await shell(acc))) return
    await rpc(acc, 'get_leaderboard', 'leaderboard')
  },

  async studentCourse(acc) {
    if (!(await shell(acc)) || !acc.courses.length) return
    await eventAndSettings(acc)
    const pick = acc.courses[Math.floor(Math.random() * acc.courses.length)]
    const c = (await api(acc, 'GET', `courses?select=id,short_code,name,time_slot,days,zoom_join_url,event_id,course_staff(person_id)&event_id=eq.${acc.eventId}&short_code=ilike.${pick.short_code}`, { label: 'course page: course' }))?.[0]
    if (!c) return
    const [, staffNames, , sessions] = await Promise.all([
      api(acc, 'GET', `grade_items?select=id,name,kind,max_points,points_per_session,sort&course_id=eq.${c.id}&order=sort.asc`, { label: 'course page: course grade items' }),
      c.course_staff?.length ? api(acc, 'GET', `people_directory?select=id,first_name,last_name,role,avatar_path&id=in.${ids(c.course_staff.map((s) => s.person_id))}`, { label: 'course page: instructor names' }) : null,
      api(acc, 'GET', `grades?select=grade_item_id,points&course_id=eq.${c.id}&person_id=eq.${acc.personId}`, { label: 'course page: my grades' }),
      api(acc, 'GET', `sessions?select=id&course_id=eq.${c.id}`, { label: 'course page: sessions' }),
      api(acc, 'GET', `grade_items?select=id,name,kind,max_points,points_per_session,sort&event_id=eq.${acc.eventId}&course_id=is.null&order=sort.asc`, { label: 'course page: grade items' }),
    ])
    void staffNames
    const [, posts] = await Promise.all([
      sessions?.length ? api(acc, 'GET', `attendance?select=id&person_id=eq.${acc.personId}&session_id=in.${ids(sessions.map((s) => s.id))}`, { label: 'course page: my attendance' }) : null,
      api(acc, 'GET', `announcements?select=id,author_id,body,attachments,created_at,announcement_comments(id,author_id,body,created_at)&course_id=eq.${c.id}&order=created_at.desc`, { label: 'course page: announcements' }),
    ])
    const authors = (posts ?? []).flatMap((p) => [p.author_id, ...(p.announcement_comments ?? []).map((x) => x.author_id)]).filter(Boolean)
    if (authors.length) await api(acc, 'GET', `people_directory?select=id,first_name,last_name,role,avatar_path&id=in.${ids(authors)}`, { label: 'course page: names' })
  },

  async merchandise(acc) {
    if (!(await shell(acc))) return
    await eventAndSettings(acc)
    await Promise.all([
      api(acc, 'GET', `merch_items?select=id,name,credit_cost,image_path&event_id=eq.${acc.eventId}&visible=eq.true&order=sort.asc,credit_cost.asc`, { label: 'merchandise: items' }),
      rpc(acc, 'get_my_standing', 'merchandise: my points'),
    ])
  },

  /** Instructor Scores page; returns what's needed to enter scores. */
  async scores(acc) {
    if (!(await shell(acc)) || !acc.courses.length) return null
    await eventAndSettings(acc)
    const pick = acc.courses[0]
    const c = (await api(acc, 'GET', `courses?select=id,short_code,name,time_slot,zoom_join_url,event_id&event_id=eq.${acc.eventId}&short_code=ilike.${pick.short_code}`, { label: 'scores page: course' }))?.[0]
    if (!c) return null
    const [sessions, , roster, , shared] = await Promise.all([
      api(acc, 'GET', `sessions?select=id,number,attendance_codes(code)&course_id=eq.${c.id}&order=number.asc`, { label: 'scores page: sessions' }),
      api(acc, 'GET', `grade_items?select=id,name,kind,max_points,points_per_session,sort&course_id=eq.${c.id}&order=sort.asc`, { label: 'scores page: course grade items' }),
      api(acc, 'GET', `enrollments?select=person:people(id,person_code,first_name,last_name,grade,school,city,state,student_email,parent_email)&course_id=eq.${c.id}`, { label: 'scores page: roster' }),
      api(acc, 'GET', `grade_edits?select=id&course_id=eq.${c.id}`, { label: 'scores page: edit count', head: true }),
      api(acc, 'GET', `grade_items?select=id,name,kind,max_points,points_per_session,sort&event_id=eq.${acc.eventId}&course_id=is.null&order=sort.asc`, { label: 'scores page: grade items' }),
    ])
    const [, grades] = await Promise.all([
      api(acc, 'GET', `grade_edits?select=id,person_id,grade_item_id,old_points,new_points,edited_by,edited_at&course_id=eq.${c.id}&order=edited_at.desc&limit=100`, { label: 'scores page: edit log' }),
      api(acc, 'GET', `grades?select=person_id,grade_item_id,points&course_id=eq.${c.id}&offset=0&limit=1000`, { label: 'scores page: grades' }),
      sessions?.length ? api(acc, 'GET', `attendance?select=person_id,session_id&session_id=in.${ids(sessions.map((s) => s.id))}&offset=0&limit=1000`, { label: 'scores page: attendance' }) : null,
    ])
    const manual = (shared ?? []).filter((i) => i.kind === 'manual')
    return { courseId: c.id, students: (roster ?? []).map((r) => r.person?.id).filter(Boolean), items: manual, grades: grades ?? [] }
  },

  /** Admin Leaderboard & Points page; returns what's needed to enter points. */
  async adminPoints(acc) {
    if (!(await shell(acc))) return null
    await eventAndSettings(acc)
    const ev = acc.eventId
    const [, challenges] = await Promise.all([
      api(acc, 'GET', `teams?select=id,name,number,counselors,takeover_override&event_id=eq.${ev}&order=number.asc,name.asc`, { label: 'admin points: teams' }),
      api(acc, 'GET', `challenges?select=id,name,kind,individual_max,team_max,visible,sort&event_id=eq.${ev}&order=sort.asc,name.asc`, { label: 'admin points: events' }),
      api(acc, 'GET', `settings?select=leaderboard_state,leaderboard_top_n,course_top_n,takeover_bonus,takeovers_shown&event_id=eq.${ev}`, { label: 'admin points: status', single: true }),
      rpc(acc, 'get_leaderboard', 'admin points: leaderboard'),
    ])
    const ch = (challenges ?? []).find((c) => c.individual_max != null) ?? (challenges ?? [])[0]
    if (!ch) return null
    const [points] = await Promise.all([
      api(acc, 'GET', `points?select=id,person_id,team_id,points&challenge_id=eq.${ch.id}`, { label: 'admin points: points' }),
      api(acc, 'GET', 'people?select=id,person_code,first_name,last_name,username&role=eq.student&order=person_code.asc', { label: 'admin points: student list' }),
      api(acc, 'GET', `team_members?select=person_id,team_id&event_id=eq.${ev}`, { label: 'admin points: team members' }),
    ])
    return { challenge: ch, points: (points ?? []).filter((p) => p.person_id) }
  },
}

// ---------------------------------------------------------------------
// Changes the script makes, kept so they can be put back
// ---------------------------------------------------------------------
const changes = readJson(FILES.changes, { grades: {}, points: {} })
const saveChanges = () => writeJson(FILES.changes, changes)

async function enterScore(acc, ctx) {
  // Nudge an existing score by 1 (within its maximum); the original is kept for restore.
  const g = ctx.grades[Math.floor(Math.random() * ctx.grades.length)]
  if (!g) return
  const item = ctx.items.find((i) => i.id === g.grade_item_id)
  if (!item) return
  const key = `${ctx.courseId}|${g.person_id}|${g.grade_item_id}`
  if (!(key in changes.grades)) {
    changes.grades[key] = Number(g.points)
    saveChanges()
  }
  const max = Number(item.max_points)
  const next = Number(g.points) < max ? Number(g.points) + 1 : Number(g.points) - 1
  const ok = await api(acc, 'POST', 'grades', {
    body: { course_id: ctx.courseId, person_id: g.person_id, grade_item_id: g.grade_item_id, points: next },
    prefer: 'resolution=merge-duplicates,return=minimal',
    label: 'WRITE: instructor saves a score',
  })
  void ok
  g.points = next
}

async function enterPoints(acc, ctx) {
  const p = ctx.points[Math.floor(Math.random() * ctx.points.length)]
  if (!p) return
  if (!(p.id in changes.points)) {
    changes.points[p.id] = Number(p.points)
    saveChanges()
  }
  const max = Number(ctx.challenge.individual_max ?? Infinity)
  const next = Number(p.points) < max ? Number(p.points) + 1 : Number(p.points) - 1
  await api(acc, 'PATCH', `points?id=eq.${p.id}`, { body: { points: next }, prefer: 'return=minimal', label: 'WRITE: admin enters points' })
  p.points = next
}

async function restore(accounts) {
  const admin = accounts.find((a) => a.role === 'admin')
  const g = Object.entries(changes.grades)
  const p = Object.entries(changes.points)
  if (!g.length && !p.length) return console.log('Nothing to put back.')
  if (!admin) stop('Restoring needs an admin account. Run setup first.')
  console.log(`Putting back ${g.length} score(s) and ${p.length} point entr${p.length === 1 ? 'y' : 'ies'}…`)
  let bad = 0
  for (const [key, points] of g) {
    const [course_id, person_id, grade_item_id] = key.split('|')
    const ok = await fetch(`${API}/rest/v1/grades`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ course_id, person_id, grade_item_id, points }),
    })
    if (ok.ok) delete changes.grades[key]
    else bad++
  }
  for (const [id, points] of p) {
    const ok = await fetch(`${API}/rest/v1/points?id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: KEY, Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ points }),
    })
    if (ok.ok) delete changes.points[id]
    else bad++
  }
  saveChanges()
  console.log(bad ? `✗ ${bad} couldn't be put back; run "node stress-test/load.mjs restore" again.` : '✓ Everything is back the way it was.')
}

// ---------------------------------------------------------------------
// Simulated people
// ---------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const between = (a, b) => a + Math.random() * (b - a)
let running = true
const pageViews = { student: 0, instructor: 0, admin: 0 }

function pickStudentPage() {
  const r = Math.random()
  if (r < 0.4) return 'studentHome'
  if (r < 0.7) return 'leaderboard'
  if (r < 0.95) return 'studentCourse'
  return 'merchandise'
}

async function student(acc, burstAt) {
  await sleep(between(0, 30000)) // people arrive over the first 30 seconds
  while (running) {
    await PAGES[pickStudentPage()](acc)
    pageViews.student++
    // Wait 20-60 s before the next page, or until the next "class ends" moment
    const next = Date.now() + between(20000, 60000)
    const burst = burstAt.find((t) => t > Date.now() && t < next)
    if (burst) {
      await sleep(burst - Date.now() + between(0, 15000)) // everyone checks the leaderboard within 15 s
      if (!running) break
      await PAGES.leaderboard(acc)
      pageViews.student++
      continue
    }
    await sleep(next - Date.now())
  }
}

async function instructor(acc) {
  await sleep(between(0, 30000))
  while (running) {
    const ctx = await PAGES.scores(acc)
    pageViews.instructor++
    // Enter a few scores, a few seconds apart (each one autosaves)
    if (ctx?.grades.length) for (let i = Math.floor(between(3, 10)); i > 0 && running; i--) {
      await enterScore(acc, ctx)
      await sleep(between(2000, 5000))
    }
    await sleep(between(30000, 90000))
  }
}

async function admin(acc) {
  await sleep(between(0, 30000))
  while (running) {
    const ctx = await PAGES.adminPoints(acc)
    pageViews.admin++
    if (ctx?.points.length) for (let i = Math.floor(between(5, 15)); i > 0 && running; i--) {
      await enterPoints(acc, ctx)
      await sleep(between(1000, 3000))
    }
    await PAGES.leaderboard(acc)
    pageViews.admin++
    await sleep(between(30000, 60000))
  }
}

async function signInAll() {
  const saved = readJson(FILES.accounts, {})
  if (!Object.keys(saved).length) stop('No accounts yet. Run "node stress-test/load.mjs setup" first.')
  const out = []
  for (const [id, { password }] of Object.entries(saved)) {
    const s = await signIn(id, password)
    if (!s) {
      console.log(`  ${id}: sign-in failed (skipped)`)
      continue
    }
    out.push({ id, role: id.startsWith('ADM') ? 'admin' : /^27/.test(id) ? 'student' : 'instructor', ...s })
  }
  return out
}

async function run() {
  const minutes = flag('minutes', config.minutes ?? 10)
  const nStudents = flag('students', config.students ?? 500)
  const nInstructors = flag('instructors', config.instructors ?? 31)
  const nAdmins = flag('admins', config.admins ?? 5)

  console.log('Signing in the script accounts…')
  const accounts = await signInAll()
  const byRole = (r) => accounts.filter((a) => a.role === r)
  if (!byRole('student').length) stop('No student accounts could sign in.')

  // Safety: make sure this is the fake test camp
  const ev = await api(accounts[0], 'GET', 'events?select=name&is_current=eq.true', { label: 'safety check' })
  if (ev?.[0]?.name !== TEST_EVENT) stop(`The current event is "${ev?.[0]?.name ?? 'unknown'}", not "${TEST_EVENT}". Stopping.`)
  stats.clear()
  totalBytes = 0

  // Leftovers from a run that didn't finish
  if (Object.keys(changes.grades).length || Object.keys(changes.points).length) await restore(accounts)

  const start = Date.now()
  const end = start + minutes * 60000
  const burstAt = [0.3, 0.7].map((f) => start + f * (end - start)) // "class ends": everyone checks the leaderboard
  console.log(`\nRunning for ${minutes} minutes: ${nStudents} students, ${nInstructors} instructors, ${nAdmins} admins`)
  console.log(`(using ${byRole('student').length} student, ${byRole('instructor').length} instructor and ${byRole('admin').length} admin accounts)`)
  console.log(`Leaderboard rushes at ${burstAt.map((t) => new Date(t).toLocaleTimeString()).join(' and ')}. Press Ctrl+C to stop early (changes are still put back).\n`)

  // Each simulated person keeps their own copy of the account (their own page state)
  const clone = (a) => ({ ...a })
  const people = []
  for (let i = 0; i < nStudents; i++) people.push(student(clone(byRole('student')[i % byRole('student').length]), burstAt))
  for (let i = 0; i < nInstructors && byRole('instructor').length; i++) people.push(instructor(clone(byRole('instructor')[i % byRole('instructor').length])))
  for (let i = 0; i < nAdmins && byRole('admin').length; i++) people.push(admin(clone(byRole('admin')[i % byRole('admin').length])))

  let last = { n: 0, err: 0, t: Date.now() }
  const ticker = setInterval(() => {
    const all = [...stats.values()]
    const n = all.reduce((a, s) => a + s.n, 0)
    const err = all.reduce((a, s) => a + s.errors, 0)
    const recent = all.flatMap((s) => s.ms.slice(-200))
    const secs = (Date.now() - last.t) / 1000
    const left = Math.max(0, Math.round((end - Date.now()) / 1000))
    console.log(
      `${new Date().toLocaleTimeString()}  ${String(Math.round((n - last.n) / secs)).padStart(4)} requests/s  ` +
        `slowest recent ${(pct(recent, 95) / 1000).toFixed(2)} s (95%)  waiting ${String(inFlight).padStart(3)}  ` +
        `errors ${err - last.err}  ·  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`,
    )
    last = { n, err, t: Date.now() }
  }, 15000)

  const finish = new Promise((r) => setTimeout(r, end - Date.now()))
  let interrupted = false
  process.on('SIGINT', () => {
    if (interrupted) process.exit(1)
    interrupted = true
    console.log('\nStopping early…')
    running = false
  })
  await Promise.race([finish, new Promise((r) => { const t = setInterval(() => { if (!running) { clearInterval(t); r() } }, 500) })])
  running = false
  const stoppedAt = Date.now()
  clearInterval(ticker)
  console.log(interrupted ? '' : '\nTime is up.', 'Waiting for the last requests to finish…')
  // Simulated people stop at their next step; only requests already sent are waited for.
  for (let waited = 0; inFlight > 0 && waited < 35000; waited += 250) await sleep(250)
  void people
  report(minutes, (stoppedAt - start) / 60000, { nStudents, nInstructors, nAdmins })
  await restore(accounts)
  process.exit(0)
}

function report(planned, actualMinutes, who) {
  const rows = [...stats.entries()].sort((a, b) => b[1].n - a[1].n)
  const all = rows.flatMap(([, s]) => s.ms)
  const n = all.length
  const errors = rows.reduce((a, [, s]) => a + s.errors, 0)
  const lines = []
  const p = (s) => lines.push(s)
  p('')
  p('==================== STRESS TEST SUMMARY (paste this to Claude) ====================')
  p(`Ran ${actualMinutes.toFixed(1)} of ${planned} minutes · ${who.nStudents} students, ${who.nInstructors} instructors, ${who.nAdmins} admins`)
  p(`Page views: ${pageViews.student} student, ${pageViews.instructor} instructor, ${pageViews.admin} admin`)
  p(`Requests: ${n} (${(n / (actualMinutes * 60)).toFixed(1)} per second) · errors: ${errors} (${n ? ((100 * errors) / n).toFixed(2) : 0}%)`)
  p(`Response time: median ${(pct(all, 50) / 1000).toFixed(2)} s · 95% under ${(pct(all, 95) / 1000).toFixed(2)} s · slowest ${(pct(all, 100) / 1000).toFixed(2)} s`)
  p(`Data downloaded (before compression): ${(totalBytes / 1048576).toFixed(1)} MB`)
  p('')
  p('Request                                        count  errors  median   95%    slowest')
  for (const [label, s] of rows)
    p(
      `${label.slice(0, 45).padEnd(45)} ${String(s.n).padStart(6)} ${String(s.errors).padStart(7)} ` +
        `${(pct(s.ms, 50) / 1000).toFixed(2).padStart(7)} ${(pct(s.ms, 95) / 1000).toFixed(2).padStart(6)} ${(pct(s.ms, 100) / 1000).toFixed(2).padStart(9)}`,
    )
  if (errorSamples.length) {
    p('')
    p('First errors:')
    for (const e of errorSamples) p('  ' + e)
  }
  p('=====================================================================================')
  const text = lines.join('\n')
  console.log(text)
  const file = path.join(DIR, `results-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`)
  fs.writeFileSync(file, text + '\n')
  console.log(`\nSaved to ${path.relative(process.cwd(), file)}`)
}

// ---------------------------------------------------------------------
if (mode === 'setup') await setup()
else if (mode === 'run') await run()
else if (mode === 'restore') {
  const accounts = await signInAll()
  await restore(accounts)
} else {
  console.log('Usage:\n  node stress-test/load.mjs setup\n  node stress-test/load.mjs run [--minutes 10]\n  node stress-test/load.mjs restore')
}
