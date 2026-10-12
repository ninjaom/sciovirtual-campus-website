import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { loadPeople } from '../../lib/people'
import { renderLearn, SUBJECTS, type Subject } from '../../lib/learn'
import { Banner, Card, EmptyState, Skeleton } from '../../components/ui'
import './learn.css'

interface Item {
  id: string
  slug: string
  title: string
  type: 'guide' | 'post'
  section: string | null
  subject: Subject | null
  author_name: string | null
  author_id: string | null
  archived: boolean
  sort: number
  created_at: string
}
const COLS = 'id, slug, title, type, section, subject, author_name, author_id, archived, sort, created_at'
const THUMBS = ['#5166D6', '#44CAB2', '#7B8CE7', '#3B53D9', '#17695A']
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="lsearch">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A5F6B" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input type="search" aria-label="Search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="lchips">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={'lchip' + (o.value === value ? ' is-on' : '')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Arrow() {
  return <span className="lrowlink__arrow" aria-hidden="true">→</span>
}

/** Learn (LearnIndex mockup board): guides grouped by section, plus posts. */
export function LearnIndex() {
  const [type, setType] = useState<'all' | 'guide' | 'post'>('all')
  const [q, setQ] = useState('')
  const { data, error } = useLoad(async () => {
    const items = must(await supabase.from('posts').select(COLS).eq('published', true).order('sort').order('title')) as Item[]
    return { items, people: await loadPeople(items.map((i) => i.author_id)) }
  }, [])

  const term = q.trim().toLowerCase()
  const match = (i: Item) => !term || i.title.toLowerCase().includes(term) || (i.section ?? '').toLowerCase().includes(term)
  const posts = useMemo(() => (data?.items ?? []).filter((i) => i.type === 'post' && match(i)).sort((a, b) => b.created_at.localeCompare(a.created_at)), [data, term]) // eslint-disable-line react-hooks/exhaustive-deps
  const guides = useMemo(() => (data?.items ?? []).filter((i) => i.type === 'guide' && match(i)), [data, term]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sections keep the order of their first guide; "… Events" sections sit under "Division B Events".
  const sections = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const g of guides) {
      const k = g.section ?? 'Guides'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(g)
    }
    return [...m]
  }, [guides])
  const general = sections.filter(([k]) => !/events$/i.test(k))
  const events = sections.filter(([k]) => /events$/i.test(k))
  const showPosts = type !== 'guide' && posts.length > 0
  const showGuides = type !== 'post' && guides.length > 0
  const author = (i: Item) => i.author_name ?? (i.author_id ? data?.people.get(i.author_id)?.name : null) ?? 'ScioVirtual'

  return (
    <>
      <Banner
        title="Never Stop Learning"
        sub="Knowledge Is Power: Learn holds personally written/crafted blogs and study guides written by ScioVirtual instructors on a range of topics - anything from specific event tips to general academic advice, and much more!"
        className="banner--learn"
      >
        <SearchBox value={q} onChange={setQ} placeholder="Search guides and posts" />
      </Banner>
      <main className="page learn">
        {error && <p role="alert">Something went wrong loading Learn. ({error})</p>}
        <Chips
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'All' },
            { value: 'guide', label: 'Guides' },
            { value: 'post', label: 'Posts' },
          ]}
        />
        {!data && !error && <Skeleton height={240} />}

        {showPosts && (
          <section className="lsection">
            <h2>Latest Posts</h2>
            <div className="lposts">
              {posts.map((p, i) => (
                <Link key={p.id} to={`/learn/${p.slug}`} className="lpost">
                  <div className="lpost__thumb" style={{ background: THUMBS[i % THUMBS.length] }}>
                    <span aria-hidden="true" />
                  </div>
                  <div className="lpost__text">
                    <span className="lpill">Post</span>
                    <span className="lpost__title">{p.title}</span>
                    <span className="lpost__meta">{author(p)} · {day(p.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {showGuides && (
          <section className="lguides">
            <div className="lsection__head">
              <h2>Science Olympiad</h2>
              <span>The hardest part about Science Olympiad is finding quality guides and practice specific to your event.</span>
            </div>
            {general.map(([name, list]) => <GuideGroup key={name} name={name} list={list} />)}
            {events.length > 0 && <h3 className="lsubhead">Division B Events</h3>}
            {events.map(([name, list]) => <GuideGroup key={name} name={name} list={list} />)}
          </section>
        )}

        {data && !showPosts && !showGuides && (
          <Card>
            <EmptyState title={term ? 'Nothing matches that search' : 'Nothing here yet'} body={term ? undefined : 'Guides and posts will show here once they’re published'} />
          </Card>
        )}
      </main>
    </>
  )
}

function GuideGroup({ name, list }: { name: string; list: Item[] }) {
  return (
    <div className="lgroup">
      <h3>{name}</h3>
      <div className="lgroup__list">
        {list.map((g) => (
          <Link key={g.id} to={`/learn/${g.slug}`} className="lrowlink">
            <span className="lrowlink__text">
              <span>{g.title}</span>
              {g.archived && <span className="lpill lpill--grey">Archived</span>}
            </span>
            <Arrow />
          </Link>
        ))}
      </div>
    </div>
  )
}

/** A guide or post (LearnArticle mockup board). */
export function LearnArticle() {
  const { slug = '' } = useParams()
  const { data, error } = useLoad(async () => {
    const post = must(await supabase.from('posts').select(COLS + ', body').eq('slug', slug).eq('published', true).maybeSingle()) as (Item & { body: string }) | null
    if (!post) return { post: null }
    const [rendered, related, people] = await Promise.all([
      renderLearn(post.body),
      supabase.from('past_resources').select('id, year, course_name, url').eq('published', true).ilike('course_name', `%${post.title.replace(/[%_]/g, '')}%`).order('year', { ascending: false }).limit(6),
      loadPeople([post.author_id]),
    ])
    return { post, rendered, related: must(related) as { id: string; year: number; course_name: string; url: string }[], people }
  }, [slug])

  const post = data?.post
  const subject = post?.subject ? SUBJECTS[post.subject] : null
  const author = post ? post.author_name ?? (post.author_id ? data?.people?.get(post.author_id)?.name : null) : null

  return (
    <main className="page learn learn--article">
      <nav aria-label="Breadcrumb" className="lcrumbs">
        <Link to="/learn">Learn</Link>
        {post?.section && (
          <>
            <span aria-hidden="true" className="lcrumbs__sep">/</span>
            <span>{post.section}</span>
          </>
        )}
        {post && (
          <>
            <span aria-hidden="true" className="lcrumbs__sep">/</span>
            <span className="lcrumbs__here" aria-current="page">{post.title}</span>
          </>
        )}
      </nav>
      {error && <p role="alert">Something went wrong loading this page. ({error})</p>}
      {!data && !error && <Skeleton height={400} />}
      {data && !post && (
        <Card>
          <EmptyState title="This page isn't available" body={<Link to="/learn">Back to Learn</Link>} />
        </Card>
      )}
      {post && data?.rendered && (
        <div className="larticle">
          <article className="larticle__main">
            <div className="larticle__head">
              <div className="larticle__pills">
                <span className="lpill">{post.type === 'guide' ? 'Guide' : 'Post'}</span>
                {subject && <span className="lpill" style={{ background: subject.bg, color: subject.fg }}>{subject.label}</span>}
                {post.archived && <span className="lpill lpill--grey">Archived</span>}
              </div>
              <h1>{post.title}</h1>
              {post.type === 'post' && <span className="lpost__meta">{author ?? 'ScioVirtual'} · {day(post.created_at)}</span>}
            </div>
            <div className="lbody" dangerouslySetInnerHTML={{ __html: data.rendered.html }} />
          </article>
          {(data.rendered.headings.length > 0 || data.related.length > 0) && (
            <aside className="larticle__side">
              {data.rendered.headings.length > 0 && (
                <Contents headings={data.rendered.headings} />
              )}
              {data.related.length > 0 && (
                <section className="lside lside--blue">
                  <h2>From Past Resources</h2>
                  {data.related.map((r) => (
                    <Link key={r.id} to={`/past-resources?q=${encodeURIComponent(r.course_name)}&year=${r.year}`} className="lside__tile">
                      <span>{r.course_name} · {r.year}</span> <Arrow />
                    </Link>
                  ))}
                </section>
              )}
            </aside>
          )}
        </div>
      )}
    </main>
  )
}

/** Contents list; the section being read is marked (LearnArticle board). */
function Contents({ headings }: { headings: { id: string; text: string }[] }) {
  const [on, setOn] = useState(headings[0]?.id)
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e)
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = els.find((el) => seen.get(el.id))
        if (first) setOn(first.id)
      },
      { rootMargin: '-80px 0px -55% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [headings])
  return (
    <nav className="lside" aria-label="Contents">
      <h2>Contents</h2>
      {headings.map((h) => (
        <a key={h.id} href={`#${h.id}`} className={'lside__toc' + (h.id === on ? ' is-on' : '')} aria-current={h.id === on ? 'location' : undefined} onClick={() => setOn(h.id)}>
          {h.text}
        </a>
      ))}
    </nav>
  )
}
