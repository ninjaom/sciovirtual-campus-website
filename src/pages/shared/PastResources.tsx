import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { linkKind, SUBJECTS, type Subject } from '../../lib/learn'
import { Banner, Skeleton } from '../../components/ui'
import { Chips } from './Learn'
import './learn.css'

interface Res {
  id: string
  year: number
  course_name: string
  subject: Subject | null
  url: string
  archived: boolean
}

function Folder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B4CC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/** Past Resources (PastResources mockup board): slideshow folders by year. */
export function PastResources() {
  const [params] = useSearchParams()
  const [year, setYear] = useState(params.get('year') ?? 'all')
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [q, setQ] = useState(params.get('q') ?? '')
  const { data, error } = useLoad(async () => {
    return must(await supabase.from('past_resources').select('id, year, course_name, subject, url, archived').eq('published', true).order('year', { ascending: false }).order('sort').order('course_name')) as Res[]
  }, [])

  const years = [...new Set((data ?? []).map((r) => r.year))].sort((a, b) => b - a)
  const term = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const rows = (data ?? []).filter(
      (r) => (year === 'all' || String(r.year) === year) && (subject === 'all' || r.subject === subject) && (!term || r.course_name.toLowerCase().includes(term)),
    )
    const m = new Map<number, Res[]>()
    for (const r of rows) {
      if (!m.has(r.year)) m.set(r.year, [])
      m.get(r.year)!.push(r)
    }
    return [...m]
  }, [data, year, subject, term])

  return (
    <>
      <Banner title="Past Resources" sub="Resources from past ScioCamp classes" className="banner--learn">
        <label className="lsearch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A5F6B" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label="Search" placeholder="Search by course or event" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </Banner>
      <main className="page learn">
        {error && <p role="alert">Something went wrong loading Past Resources. ({error})</p>}
        <div className="lfilters">
          <Chips label="Year" value={year} onChange={setYear} options={[{ value: 'all', label: 'All Years' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
          <Chips<'all' | Subject>
            label="Subject"
            value={subject}
            onChange={setSubject}
            options={[{ value: 'all', label: 'All Subjects' }, ...(Object.keys(SUBJECTS) as Subject[]).map((s) => ({ value: s, label: SUBJECTS[s].label }))]}
          />
        </div>
        {!data && !error && <Skeleton height={240} />}
        {groups.map(([y, list]) => (
          <section key={y} className="lsection">
            <div className="lyear">
              <h2>{y}</h2>
              <span>{list.length} {list.length === 1 ? 'Course' : 'Courses'}</span>
            </div>
            <div className="lcards">
              {list.map((r) => {
                const sub = r.subject ? SUBJECTS[r.subject] : null
                return (
                  <article key={r.id} className="lcard">
                    <div className="lcard__head">
                      <h3>{r.course_name}</h3>
                      {sub && <span className="lpill" style={{ background: sub.bg, color: sub.fg }}>{sub.label}</span>}
                      {r.archived && <span className="lpill lpill--grey">Archived</span>}
                    </div>
                    <a href={r.url} target="_blank" rel="noreferrer" className="lcard__link">
                      <span className="lcard__open">
                        <span className="lcard__icon"><Folder /></span>
                        <span>[Open slideshow folder]</span>
                      </span>
                      <span className="lcard__kind">{linkKind(r.url)} →</span>
                    </a>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
        {data && groups.length === 0 && <div className="lempty">No slideshows match these filters</div>}
      </main>
    </>
  )
}
