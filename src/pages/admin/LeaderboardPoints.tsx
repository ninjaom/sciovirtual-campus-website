import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { useAutosave } from '../../lib/useAutosave'
import { when } from '../../lib/camp'
import { Button, Card, SavedStatus, SearchInput, Skeleton, Switch, TableWrap, Tabs, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError } from './AdminBits'
import '../instructor/instructor.css'
import './leaderboardAdmin.css'

interface Challenge {
  id: string
  name: string
  kind: 'live' | 'async' | 'revenge'
  individual_max: number | null
  team_max: number | null
  visible: boolean
  sort: number
}
interface Team {
  id: string
  name: string
  number: number | null
  counselors: string | null
  takeover_override: number | null
}
interface Student {
  id: string
  person_code: string
  first_name: string
  last_name: string
  username: string | null
}
type State = 'live' | 'frozen' | 'hidden'
const TAKEOVERS = 'takeovers'

const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('en-US'))
const STATE_NAME: Record<State, string> = { live: 'Live', frozen: 'Frozen', hidden: 'Frozen & Hidden' }
const STATE_NOTE: Record<State, string> = {
  live: 'Students and instructors will see the current standings.',
  frozen: 'Students and instructors will see the standings from when the leaderboard was frozen, until you switch back to Live.',
  hidden: 'Students and instructors will not be able to see the leaderboard.',
}

export function LeaderboardPoints() {
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const s = ev.data?.settings ?? null
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<Challenge | 'new' | 'takeovers' | null>(null)

  const { data, error, reload, setData } = useLoad(async () => {
    if (!eventId) return null
    const [challenges, teams, board, settings] = await Promise.all([
      supabase.from('challenges').select('id, name, kind, individual_max, team_max, visible, sort').eq('event_id', eventId).order('sort').order('name'),
      supabase.from('teams').select('id, name, number, counselors, takeover_override').eq('event_id', eventId).order('number').order('name'),
      supabase.rpc('get_leaderboard'),
      supabase.from('settings').select('leaderboard_state, leaderboard_top_n, course_top_n, takeover_bonus, takeovers_shown').eq('event_id', eventId).single(),
    ])
    const b = must(board) as { updated: string | null; students: number; teams: { name: string; takeovers_auto: number | null }[] } | null
    return {
      challenges: must(challenges) as Challenge[],
      teams: must(teams) as Team[],
      updated: b?.updated ?? null,
      students: b?.students ?? 0,
      auto: new Map((b?.teams ?? []).map((t) => [t.name, t.takeovers_auto])),
      settings: must(settings) as { leaderboard_state: State; leaderboard_top_n: number; course_top_n: number; takeover_bonus: number; takeovers_shown: boolean },
    }
  }, [eventId])

  const [asking, setAsking] = useState<State | null>(null)
  async function setState(st: State) {
    setAsking(null)
    if (!eventId || !data) return
    setData((d) => (d ? { ...d, settings: { ...d.settings, leaderboard_state: st } } : d))
    const res = await supabase.from('settings').update({ leaderboard_state: st }).eq('event_id', eventId)
    if (res.error) {
      toast('Something went wrong. Please try again.', 'error')
      reload()
    }
  }
  async function toggleShown(c: Challenge | typeof TAKEOVERS, on: boolean) {
    if (!eventId) return
    const res =
      c === TAKEOVERS
        ? await supabase.from('settings').update({ takeovers_shown: on }).eq('event_id', eventId)
        : await supabase.from('challenges').update({ visible: on }).eq('id', c.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    setData((d) =>
      d
        ? c === TAKEOVERS
          ? { ...d, settings: { ...d.settings, takeovers_shown: on } }
          : { ...d, challenges: d.challenges.map((x) => (x.id === c.id ? { ...x, visible: on } : x)) }
        : d,
    )
  }

  const st = data?.settings.leaderboard_state ?? s?.leaderboard_state ?? 'live'

  return (
    <>
      <AdminHead eyebrow={data?.updated ? `Last updated ${when(data.updated)}` : undefined} title="Leaderboard & Points" />
      {error && <LoadError message={error} />}

      <Card title="Leaderboard Status">
        <div className="lbstatus">
          <div className="lbstatus__main">
            <Tabs<State>
              label="Leaderboard status"
              value={st}
              onChange={(v) => v !== st && setAsking(v)}
              options={[
                { value: 'live', label: 'Live' },
                { value: 'frozen', label: 'Frozen' },
                { value: 'hidden', label: 'Frozen & Hidden' },
              ]}
            />
            {st === 'live' && <span className="lbstatus__note">REMEMBER: When Live, all students + instructors can view the leaderboard. When changes are being made, freeze it.</span>}
          </div>
          {data && eventId && <CutoffFields eventId={eventId} topN={data.settings.leaderboard_top_n} courseN={data.settings.course_top_n} students={data.students} />}
        </div>
      </Card>

      {asking && (
        <Dialog
          open
          origin={null}
          onClose={() => setAsking(null)}
          title="Are you sure?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(null)}>Cancel</Button>
              <Button onClick={() => void setState(asking)}>Switch to {STATE_NAME[asking]}</Button>
            </>
          }
        >
          <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>{STATE_NOTE[asking]}</p>
        </Dialog>
      )}

      <Card
        title="Event Columns"
        actions={
          <Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setEditing('new') }}>
            + Add Event
          </Button>
        }
      >
        {!data ? (
          <Skeleton height={200} />
        ) : (
          <TableWrap>
            <table className="atable" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="num">Individual max</th>
                  <th className="num">Team Max</th>
                  <th className="num">Shown?</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="strong">Course Takeovers</td>
                  <td className="num muted">—</td>
                  <td className="num">{fmt(data.settings.takeover_bonus)} per Takeover</td>
                  <td className="num">
                    <Switch checked={data.settings.takeovers_shown} label="Show Course Takeovers" onChange={(v) => toggleShown(TAKEOVERS, v)} />
                  </td>
                  <td className="actions" style={{ textAlign: 'right' }}>
                    <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditing('takeovers') }}>Edit</Button>
                  </td>
                </tr>
                {data.challenges.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">{c.name}</td>
                    <td className={'num' + (c.individual_max == null ? ' muted' : '')}>{fmt(c.individual_max)}</td>
                    <td className={'num' + (c.team_max == null ? ' muted' : '')}>{fmt(c.team_max)}</td>
                    <td className="num">
                      <Switch checked={c.visible} label={`Show ${c.name}`} onChange={(v) => toggleShown(c, v)} />
                    </td>
                    <td className="actions" style={{ textAlign: 'right' }}>
                      <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditing(c) }}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {data && eventId && <EnterPoints eventId={eventId} challenges={data.challenges} teams={data.teams} auto={data.auto} onChanged={reload} />}

      {editing === 'takeovers' && data && eventId && (
        <TakeoverDialog eventId={eventId} bonus={data.settings.takeover_bonus} origin={origin} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); toast('All Changes Saved') }} />
      )}
      {editing && editing !== 'takeovers' && eventId && (
        <EventDialog
          eventId={eventId}
          event={editing === 'new' ? null : editing}
          sort={(data?.challenges.length ?? 0) + 1}
          origin={origin}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); reload(); toast(msg) }}
        />
      )}
    </>
  )
}

function CutoffFields({ eventId, topN, courseN, students }: { eventId: string; topN: number; courseN: number; students: number }) {
  const [top, setTop] = useState(String(topN))
  const [crs, setCrs] = useState(String(courseN))
  const save = useAutosave<{ leaderboard_top_n: number; course_top_n: number }>((patch) => supabase.from('settings').update(patch).eq('event_id', eventId))
  const set = (k: 'leaderboard_top_n' | 'course_top_n', v: string, setter: (x: string) => void) => {
    const clean = v.replace(/[^0-9]/g, '')
    setter(clean)
    const n = Number(clean)
    if (clean && n > 0) save.change({ [k]: n })
  }
  return (
    <div className="lbstatus__side">
      <div className="lbcut">
        <TextField id="topn" label="# of Students Shown of Leaderboard" inputMode="numeric" value={top} onChange={(e) => set('leaderboard_top_n', e.target.value, setTop)} fieldStyle={{ width: 120 }} />
        <span className="lbcut__of">of {students}</span>
      </div>
      <div className="lbcut">
        <TextField id="coursen" label="# of Students Shown per Course" inputMode="numeric" value={crs} onChange={(e) => set('course_top_n', e.target.value, setCrs)} fieldStyle={{ width: 120 }} />
      </div>
      <SavedStatus state={save.state} />
    </div>
  )
}

function TakeoverDialog({ eventId, bonus, origin, onClose, onSaved }: { eventId: string; bonus: number; origin: HTMLElement | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(String(bonus))
  const [err, setErr] = useState<string | null>(null)
  async function save(e?: FormEvent) {
    e?.preventDefault()
    const n = Number(v)
    if (!v.trim() || !Number.isInteger(n) || n < 0) return setErr('Enter a whole number, 0 or more')
    const res = await supabase.from('settings').update({ takeover_bonus: n }).eq('event_id', eventId)
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }
  return (
    <Dialog open origin={origin} onClose={onClose} title="Edit Course Takeovers" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save()}>Save</Button></>}>
      <form onSubmit={save} className="dlgform">
        <TextField label="Points per Takeover" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} error={err ?? undefined} hint="The top scorer in each course earns their team this many points" autoFocus />
      </form>
    </Dialog>
  )
}

function EventDialog({
  eventId,
  event,
  sort,
  origin,
  onClose,
  onSaved,
}: {
  eventId: string
  event: Challenge | null
  sort: number
  origin: HTMLElement | null
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [name, setName] = useState(event?.name ?? '')
  const [ind, setInd] = useState(event?.individual_max == null ? '' : String(event.individual_max))
  const [team, setTeam] = useState(event?.team_max == null ? '' : String(event.team_max))
  const [shown, setShown] = useState(event?.visible ?? true)
  const [kind, setKind] = useState<Challenge['kind']>(event?.kind ?? 'live')
  const [errs, setErrs] = useState<{ name?: string; ind?: string; team?: string; form?: string }>({})
  const [confirm, setConfirm] = useState(false)

  const asMax = (v: string) => (v.trim() === '' ? null : Number(v))
  async function save(e?: FormEvent) {
    e?.preventDefault()
    const next: typeof errs = {}
    if (!name.trim()) next.name = 'Enter a name'
    for (const [k, v] of [['ind', ind], ['team', team]] as const) {
      const n = asMax(v)
      if (n !== null && (!Number.isFinite(n) || n < 0)) next[k] = 'Enter a number, 0 or more'
    }
    setErrs(next)
    if (Object.keys(next).length) return
    const row = { name: name.trim(), kind, individual_max: asMax(ind), team_max: asMax(team), visible: shown }
    const res = event
      ? await supabase.from('challenges').update(row).eq('id', event.id)
      : await supabase.from('challenges').insert({ ...row, event_id: eventId, sort })
    if (res.error) return setErrs({ form: res.error.code === '23514' || res.error.code === '22003' ? 'Some points already entered are above the new maximum' : 'Something went wrong. Please try again.' })
    onSaved(event ? 'All Changes Saved' : 'Added')
  }
  async function remove() {
    if (!event) return
    const res = await supabase.from('challenges').delete().eq('id', event.id)
    if (res.error) return setErrs({ form: 'Something went wrong. Please try again.' })
    onSaved('Deleted')
  }

  if (confirm && event)
    return (
      <Dialog
        open
        origin={origin}
        onClose={() => setConfirm(false)}
        title={`Delete ${event.name}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete</Button>
          </>
        }
      >
        <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>This can't be undone.</p>
      </Dialog>
    )

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={event ? `Edit ${event.name}` : 'Add Event'}
      footer={
        <>
          {event && (
            <Button variant="outline" className="btn--danger-outline" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save()}>{event ? 'Save' : '+ Add Event'}</Button>
        </>
      }
    >
      <form onSubmit={save} className="dlgform" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextField label="Event" value={name} onChange={(e) => setName(e.target.value)} error={errs.name} autoFocus />
        <div className="field">
          <span className="field__label">Type</span>
          <Tabs<Challenge['kind']>
            label="Type"
            value={kind}
            onChange={setKind}
            fill
            options={[
              { value: 'live', label: 'Live' },
              { value: 'async', label: 'Asynchronous' },
              ...(event?.kind === 'revenge' ? [{ value: 'revenge' as const, label: 'Revenge' }] : []),
            ]}
          />
        </div>
        <div className="fieldrow">
          <TextField label="Individual max" inputMode="numeric" value={ind} onChange={(e) => setInd(e.target.value)} error={errs.ind} fieldStyle={{ flex: '1 1 140px' }} />
          <TextField label="Team Max" inputMode="numeric" value={team} onChange={(e) => setTeam(e.target.value)} error={errs.team} fieldStyle={{ flex: '1 1 140px' }} />
        </div>
        <div className="switchrow">
          <span className="field__label">Shown?</span>
          <Switch checked={shown} onChange={setShown} label="Shown?" />
        </div>
        {errs.form && <p role="alert" className="field__error">{errs.form}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/* ---------------- Enter Points ---------------- */

const isBad = (v: string, max: number | null) => {
  if (v.trim() === '') return false
  const n = Number(v)
  return !Number.isFinite(n) || n < 0 || (max != null && n > max)
}

function EnterPoints({
  eventId,
  challenges,
  teams,
  auto,
  onChanged,
}: {
  eventId: string
  challenges: Challenge[]
  teams: Team[]
  auto: Map<string, number | null>
  onChanged: () => void
}) {
  const [pick, setPick] = useState<string>(challenges[0]?.id ?? TAKEOVERS)
  const [scope, setScope] = useState<'teams' | 'students'>('teams')
  const [q, setQ] = useState('')
  const isTake = pick === TAKEOVERS
  const ch = challenges.find((c) => c.id === pick) ?? null
  const max = isTake ? null : scope === 'teams' ? ch?.team_max ?? null : ch?.individual_max ?? null
  useEffect(() => {
    if (isTake) setScope('teams')
  }, [isTake])

  const students = useLoad(async () => {
    const [people, members] = await Promise.all([
      supabase.from('people').select('id, person_code, first_name, last_name, username').eq('role', 'student').order('person_code'),
      supabase.from('team_members').select('person_id, team_id').eq('event_id', eventId),
    ])
    return { list: must(people) as Student[], team: new Map((must(members) as { person_id: string; team_id: string }[]).map((m) => [m.person_id, m.team_id])) }
  }, [eventId])

  // Points already entered for the picked event: key -> {id, points}
  const entered = useLoad(async () => {
    if (isTake) return new Map<string, { id: string; points: number }>()
    const rows = must(await supabase.from('points').select('id, person_id, team_id, points').eq('challenge_id', pick)) as {
      id: string
      person_id: string | null
      team_id: string | null
      points: number
    }[]
    return new Map(rows.map((r) => [(r.person_id ?? r.team_id)!, { id: r.id, points: Number(r.points) }]))
  }, [pick])

  const [text, setText] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (isTake) setText(new Map(teams.map((t) => [t.id, t.takeover_override == null ? '' : String(t.takeover_override)])))
    else if (entered.data) setText(new Map([...entered.data].map(([k, v]) => [k, String(v.points)])))
  }, [entered.data, isTake, teams])

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(false)
  const [bad, setBad] = useState(false)

  const save = useCallback(
    async (key: string, kind: 'team' | 'student', value: string) => {
      const n = value.trim() === '' ? null : Number(value)
      setPending((p) => p + 1)
      let res: { error: unknown }
      if (isTake) {
        res = await supabase.from('teams').update({ takeover_override: n }).eq('id', key)
      } else {
        const have = entered.data?.get(key)
        if (n === null) res = have ? await supabase.from('points').delete().eq('id', have.id) : { error: null }
        else if (have) res = await supabase.from('points').update({ points: n }).eq('id', have.id)
        else {
          const ins = await supabase
            .from('points')
            .insert({ challenge_id: pick, points: n, ...(kind === 'team' ? { team_id: key } : { person_id: key }) })
            .select('id')
            .single()
          res = ins
          if (!ins.error && ins.data) entered.data?.set(key, { id: ins.data.id, points: n })
        }
        if (!res.error && have) {
          if (n === null) entered.data?.delete(key)
          else have.points = n
        }
      }
      setPending((p) => p - 1)
      setFailed(!!res.error)
      if (!res.error && isTake) onChanged()
    },
    [isTake, pick, entered.data, onChanged],
  )

  function change(key: string, kind: 'team' | 'student', value: string) {
    setText((t) => new Map(t).set(key, value))
    const b = isBad(value, max)
    setBad(b)
    const old = timers.current.get(key)
    if (old) clearTimeout(old)
    if (b) return
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        void save(key, kind, value)
      }, 450),
    )
  }

  const needle = q.trim().toLowerCase()
  const teamName = new Map(teams.map((t) => [t.id, t.name]))
  const rows = useMemo(
    () =>
      scope === 'teams'
        ? teams.map((t) => ({ key: t.id, kind: 'team' as const }))
        : (students.data?.list ?? [])
            .filter((s) => !needle || [s.person_code, s.first_name, s.last_name, s.username ?? ''].join(' ').toLowerCase().includes(needle))
            .map((s) => ({ key: s.id, kind: 'student' as const })),
    [scope, teams, students.data, needle],
  )

  const grid = useRef<HTMLTableSectionElement>(null)
  const focusRow = (i: number) => {
    const el = grid.current?.querySelector<HTMLInputElement>(`input[data-r="${i}"]`)
    if (el) {
      el.focus()
      el.select()
    }
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusRow(i + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusRow(i - 1)
    }
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>, i: number) {
    const raw = e.clipboardData.getData('text/plain')
    if (!/\n/.test(raw.trim())) return
    e.preventDefault()
    raw
      .replace(/\r/g, '')
      .replace(/\n$/, '')
      .split('\n')
      .forEach((line, j) => {
        const r = rows[i + j]
        if (r) change(r.key, r.kind, line.split('\t')[0].trim().replace(/,/g, ''))
      })
  }

  const status = bad
    ? { text: 'Not Saved: Above the Maximum', cls: 'is-bad' }
    : failed
      ? { text: 'Couldn’t save. Try again.', cls: 'is-bad' }
      : pending > 0 || timers.current.size > 0
        ? { text: 'Saving…', cls: 'is-saving' }
        : { text: 'All Changes Saved', cls: '' }

  const input = (key: string, kind: 'team' | 'student', i: number, label: string, placeholder?: string) => {
    const v = text.get(key) ?? ''
    const b = isBad(v, max)
    return (
      <input
        type="text"
        inputMode="numeric"
        className={'ptcell' + (b ? ' is-bad' : '')}
        aria-label={label}
        aria-invalid={b || undefined}
        data-r={i}
        value={v}
        placeholder={placeholder}
        onChange={(e) => change(key, kind, e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => onKey(e, i)}
        onPaste={(e) => onPaste(e, i)}
      />
    )
  }

  return (
    <Card
      title="Enter Points"
      actions={
        <span className={'gridstatus ' + status.cls} role="status">
          <span className="gridstatus__dot" />
          {status.text}
        </span>
      }
    >
      <div className="ptbar">
        <div className="field">
          <label htmlFor="ev" className="field__label">Event</label>
          <select id="ev" className="input ptselect" value={pick} onChange={(e) => setPick(e.target.value)}>
            {challenges.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value={TAKEOVERS}>Course Takeovers</option>
          </select>
        </div>
        {!isTake && (
          <Tabs<'teams' | 'students'> label="Who gets points" value={scope} onChange={setScope} options={[{ value: 'teams', label: 'Teams' }, { value: 'students', label: 'Students' }]} />
        )}
        {scope === 'students' && !isTake && (
          <SearchInput aria-label="Search students" placeholder="Search by ID, name or username" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300, maxWidth: '100%' }} />
        )}
      </div>
      <span className="anote" style={{ fontSize: 13 }}>
        {isTake
          ? 'Course takeovers are calculated automatically. Type a number to set a team’s amount by hand, or clear it to go back to the calculated amount.'
          : 'Note: paste a column from Sheets to fill many rows at once; every change will be logged'}
      </span>

      {(!entered.data || (scope === 'students' && !students.data)) ? (
        <Skeleton height={280} />
      ) : (
        <TableWrap maxHeight={640} sticky>
          {scope === 'teams' ? (
            <table className="itable pttable" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Counselor(s)</th>
                  {isTake && <th className="c">Calculated</th>}
                  <th className="c" style={{ width: 160 }}>
                    Points {max != null && <span className="ptmax">/ {fmt(max)}</span>}
                  </th>
                </tr>
              </thead>
              <tbody ref={grid}>
                {teams.map((t, i) => (
                  <tr key={t.id}>
                    <td className="strong">
                      {t.name} {t.number != null && <span className="ptpill">Team {t.number}</span>}
                    </td>
                    <td className="muted">{t.counselors}</td>
                    {isTake && <td className="c muted">{fmt(auto.get(t.name) ?? 0)}</td>}
                    <td className="ptcellwrap">{input(t.id, 'team', i, `Points for ${t.name}`, isTake ? String(auto.get(t.name) ?? 0) : undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="itable pttable" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Username</th>
                  <th>Team</th>
                  <th className="c" style={{ width: 160 }}>
                    Points {max != null && <span className="ptmax">/ {fmt(max)}</span>}
                  </th>
                </tr>
              </thead>
              <tbody ref={grid}>
                {rows.map((r, i) => {
                  const s = students.data!.list.find((x) => x.id === r.key)!
                  return (
                    <tr key={s.id}>
                      <td className="muted">{s.person_code}</td>
                      <td className="strong">{s.first_name}</td>
                      <td className="strong">{s.last_name}</td>
                      <td>{s.username ?? '—'}</td>
                      <td className="muted">{teamName.get(students.data!.team.get(s.id) ?? '') ?? '—'}</td>
                      <td className="ptcellwrap">{input(s.id, 'student', i, `Points for ${s.first_name} ${s.last_name}`)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </TableWrap>
      )}
    </Card>
  )
}
