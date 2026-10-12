import { useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { safeName } from '../../lib/files'
import { linkKind, SUBJECTS, slugify, type Subject } from '../../lib/learn'
import { Button, ButtonLink, Card, Pill, SearchInput, SelectField, Skeleton, TableWrap, Tabs, TextAreaField, TextField, type PillTone } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError, Note } from './AdminBits'
import './phase6.css'

interface Post {
  id: string
  slug: string
  title: string
  type: 'guide' | 'post'
  section: string | null
  subject: Subject | null
  body: string
  author_name: string | null
  author_id: string | null
  published: boolean
  archived: boolean
  sort: number
  updated_at: string
}
interface Resource {
  id: string
  year: number
  course_name: string
  subject: Subject | null
  url: string
  published: boolean
  archived: boolean
  sort: number
}
type Status = 'published' | 'draft' | 'archived'
const STATUS: Record<Status, { label: string; tone: PillTone }> = {
  published: { label: 'Published', tone: 'green' },
  draft: { label: 'Draft', tone: 'amber' },
  archived: { label: 'Archived', tone: 'grey' },
}
const statusOf = (x: { published: boolean; archived: boolean }): Status => (!x.published ? 'draft' : x.archived ? 'archived' : 'published')
const fromStatus = (s: Status) => ({ published: s !== 'draft', archived: s === 'archived' })
const TYPE = { guide: 'Event guide', post: 'Post' } as const
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Admin › Learn & Past Resources (AdminResources mockup board). */
export function Resources() {
  const toast = useToast()
  const [tab, setTab] = useState<'learn' | 'past'>('learn')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [editPost, setEditPost] = useState<Post | 'new' | null>(null)
  const [editRes, setEditRes] = useState<Resource | 'new' | null>(null)

  const { data, error, reload } = useLoad(async () => {
    const [posts, res] = await Promise.all([
      supabase.from('posts').select('id, slug, title, type, section, subject, body, author_name, author_id, published, archived, sort, updated_at').order('type').order('section').order('sort').order('title'),
      supabase.from('past_resources').select('id, year, course_name, subject, url, published, archived, sort').order('year', { ascending: false }).order('course_name'),
    ])
    return { posts: must(posts) as Post[], res: must(res) as Resource[] }
  }, [])

  const term = q.trim().toLowerCase()
  const posts = useMemo(
    () => (data?.posts ?? []).filter((p) => (filter === 'all' || p.type === filter) && (!term || p.title.toLowerCase().includes(term) || (p.section ?? '').toLowerCase().includes(term))),
    [data, filter, term],
  )
  const res = useMemo(
    () => (data?.res ?? []).filter((r) => (filter === 'all' || String(r.year) === filter) && (!term || r.course_name.toLowerCase().includes(term))),
    [data, filter, term],
  )
  const years = [...new Set((data?.res ?? []).map((r) => r.year))].sort((a, b) => b - a)

  return (
    <>
      <AdminHead title="Learn & Past Resources">
        <Button
          onClick={(e) => {
            setOrigin(e.currentTarget)
            if (tab === 'learn') setEditPost('new')
            else setEditRes('new')
          }}
        >
          + {tab === 'learn' ? 'New guide or post' : 'Add slideshow'}
        </Button>
      </AdminHead>
      {error && <LoadError message={error} />}

      <Tabs<'learn' | 'past'>
        label="Content type"
        value={tab}
        onChange={(t) => { setTab(t); setFilter('all') }}
        options={[
          { value: 'learn', label: 'Learn' },
          { value: 'past', label: 'Past Resources' },
        ]}
      />

      <Card>
        <div className="p6filters">
          <SearchInput aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="p6select" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            {tab === 'learn' ? (
              <>
                <option value="all">All types</option>
                <option value="guide">Event guides</option>
                <option value="post">Posts</option>
              </>
            ) : (
              <>
                <option value="all">All years</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </>
            )}
          </select>
        </div>
        {!data ? (
          <Skeleton height={240} />
        ) : (
          <TableWrap>
            <table className="atable" style={{ minWidth: 680 }}>
              <thead>
                {tab === 'learn' ? (
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Last updated</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                ) : (
                  <tr>
                    <th>Event</th>
                    <th>Year</th>
                    <th>File</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                )}
              </thead>
              <tbody>
                {tab === 'learn'
                  ? posts.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.title}</strong></td>
                        <td className="p6muted">{TYPE[p.type]}{p.section ? ` · ${p.section}` : ''}</td>
                        <td className="p6muted">{p.published ? day(p.updated_at) : '—'}</td>
                        <td><Pill tone={STATUS[statusOf(p)].tone}>{STATUS[statusOf(p)].label}</Pill></td>
                        <td className="actions">
                          <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditPost(p) }}>Edit</Button>
                        </td>
                      </tr>
                    ))
                  : res.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.course_name}</strong></td>
                        <td className="p6muted">{r.year}</td>
                        <td className="p6muted">Slideshow · {linkKind(r.url)}</td>
                        <td><Pill tone={STATUS[statusOf(r)].tone}>{STATUS[statusOf(r)].label}</Pill></td>
                        <td className="actions">
                          <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditRes(r) }}>Edit</Button>
                        </td>
                      </tr>
                    ))}
                {(tab === 'learn' ? posts : res).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p6empty">{tab === 'learn' ? 'No guides or posts yet' : 'No slideshows yet'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note>{tab === 'learn' ? 'Note: archived events stay readable but are marked Archived' : 'Note: slideshows only; recordings stay private'}</Note>
      </Card>

      {editPost && data && (
        <PostDialog
          post={editPost === 'new' ? null : editPost}
          all={data.posts}
          origin={origin}
          onClose={() => setEditPost(null)}
          onSaved={(msg) => { setEditPost(null); reload(); toast(msg) }}
        />
      )}
      {editRes && data && (
        <ResourceDialog
          res={editRes === 'new' ? null : editRes}
          origin={origin}
          onClose={() => setEditRes(null)}
          onSaved={(msg) => { setEditRes(null); reload(); toast(msg) }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------
// Guide or post
// ---------------------------------------------------------------------
function PostDialog({ post, all, origin, onClose, onSaved }: { post: Post | null; all: Post[]; origin: HTMLElement | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { profile } = useAuth()
  const [f, setF] = useState({
    title: post?.title ?? '',
    type: post?.type ?? 'guide',
    section: post?.section ?? '',
    subject: post?.subject ?? '',
    author_name: post?.author_name ?? '',
    body: post?.body ?? '',
    status: post ? statusOf(post) : ('draft' as Status),
    sort: post ? String(post.sort) : '',
  })
  const [errs, setErrs] = useState<{ title?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const sections = [...new Set(all.map((p) => p.section).filter((s): s is string => !!s))].sort()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function upload(file: File | null | undefined) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return setErrs({ form: 'Files can be up to 20 MB' })
    setBusy(true)
    const path = `posts/${crypto.randomUUID()}/${safeName(file.name)}`
    const up = await supabase.storage.from('learn-files').upload(path, file, { contentType: file.type || undefined, cacheControl: '31536000' })
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (up.error) return setErrs({ form: up.error.message.includes('mime') ? 'Use a PDF or a picture (JPG, PNG, WebP, GIF)' : 'Couldn’t upload that file. Please try again.' })
    const name = file.name.replace(/\.[^.]+$/, '')
    const snippet = /^image\//.test(file.type) ? `![${name}](learn:${path})` : `[${name}](learn:${path})`
    const el = bodyRef.current
    const at = el ? el.selectionStart : f.body.length
    setF((x) => ({ ...x, body: x.body.slice(0, at) + snippet + x.body.slice(at) }))
  }

  async function save() {
    if (!f.title.trim()) return setErrs({ title: 'Enter a title' })
    setBusy(true)
    let slug = post?.slug ?? slugify(f.title)
    if (!post) {
      const taken = new Set(all.map((p) => p.slug))
      for (let i = 2; taken.has(slug); i++) slug = `${slugify(f.title)}-${i}`
    }
    const row = {
      title: f.title.trim(),
      type: f.type,
      section: f.section.trim() || null,
      subject: f.subject || null,
      author_name: f.author_name.trim() || null,
      body: f.body,
      sort: Number(f.sort) || 0,
      ...fromStatus(f.status),
    }
    const res = post
      ? await supabase.from('posts').update(row).eq('id', post.id)
      : await supabase.from('posts').insert({ ...row, slug, author_id: profile?.id ?? null })
    setBusy(false)
    if (res.error) return setErrs({ form: 'Something went wrong. Please try again.' })
    onSaved(post ? 'All Changes Saved' : 'Added')
  }
  async function remove() {
    if (!post) return
    const res = await supabase.from('posts').delete().eq('id', post.id)
    if (res.error) return setErrs({ form: 'Something went wrong. Please try again.' })
    onSaved('Deleted')
  }

  if (confirm && post)
    return (
      <Dialog
        open
        origin={origin}
        onClose={() => setConfirm(false)}
        title={`Delete ${post.title}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete</Button>
          </>
        }
      >
        <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>This can't be undone. To hide it but keep it, set it to Draft or Archived instead.</p>
      </Dialog>
    )

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      width={760}
      title={post ? `Edit ${post.title}` : 'New guide or post'}
      footer={
        <>
          {post && (
            <Button variant="outline" className="btn--danger-outline" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          )}
          {post && post.published && (
            <ButtonLink to={`/learn/${post.slug}`} variant="outline" target="_blank">Preview</ButtonLink>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="dlgform p6form">
        <TextField label="Title" value={f.title} onChange={set('title')} error={errs.title} autoFocus={!post} />
        <div className="fieldrow">
          <SelectField label="Type" value={f.type} onChange={set('type')} fieldStyle={{ flex: '1 1 160px' }}>
            <option value="guide">Event guide</option>
            <option value="post">Post</option>
          </SelectField>
          <SelectField label="Status" value={f.status} onChange={set('status')} fieldStyle={{ flex: '1 1 160px' }}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </SelectField>
          <SelectField label="Subject" value={f.subject} onChange={set('subject')} fieldStyle={{ flex: '1 1 160px' }}>
            <option value="">None</option>
            {(Object.keys(SUBJECTS) as Subject[]).map((s) => <option key={s} value={s}>{SUBJECTS[s].label}</option>)}
          </SelectField>
        </div>
        <div className="fieldrow">
          <TextField label="Section" list="learn-sections" value={f.section} onChange={set('section')} placeholder="e.g. Biology Events" hint="Guides are grouped by section on Learn" fieldStyle={{ flex: '2 1 240px' }} />
          <datalist id="learn-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
          <TextField label="Order in section" inputMode="numeric" value={f.sort} onChange={set('sort')} fieldStyle={{ flex: '1 1 120px' }} />
          <TextField label="Written by (optional)" value={f.author_name} onChange={set('author_name')} placeholder={profile ? `${profile.firstName} ${profile.lastName}` : ''} fieldStyle={{ flex: '2 1 200px' }} />
        </div>
        <TextAreaField
          ref={bodyRef}
          label="Text"
          rows={14}
          value={f.body}
          onChange={set('body')}
          hint="Markdown: ## for a section heading, **bold**, [link text](https://…), - for bullets. Links on a line by themselves show as file buttons."
        />
        <div className="p6btns">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>Add PDF or Picture</Button>
          <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.gif" onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        {errs.form && <p role="alert" className="field__error">{errs.form}</p>}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------
// Past Resources: one slideshow folder link per course and year
// ---------------------------------------------------------------------
function ResourceDialog({ res, origin, onClose, onSaved }: { res: Resource | null; origin: HTMLElement | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [mode, setMode] = useState<'one' | 'list'>('one')
  const [f, setF] = useState({
    course_name: res?.course_name ?? '',
    year: res ? String(res.year) : String(new Date().getFullYear()),
    subject: res?.subject ?? '',
    url: res?.url ?? '',
    status: res ? statusOf(res) : ('published' as Status),
  })
  const [list, setList] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const okUrl = (u: string) => /^https?:\/\/\S+\.\S+/.test(u.trim())
  const subjectOf = (s: string): Subject | null => {
    const k = s.trim().toLowerCase()
    const hit = (Object.keys(SUBJECTS) as Subject[]).find((x) => x === k || SUBJECTS[x].label.toLowerCase() === k || SUBJECTS[x].label.toLowerCase().startsWith(k))
    return k ? hit ?? null : null
  }

  async function save() {
    if (mode === 'list') {
      // One per line: Year, Course, Link (, Subject)
      const rows = list
        .split(/\r?\n/)
        .map((l) => l.split(/\t|,/).map((x) => x.trim()))
        .filter((c) => c.some(Boolean))
      const bad = rows.findIndex((c) => !/^\d{4}$/.test(c[0] ?? '') || !c[1] || !okUrl(c[2] ?? ''))
      if (!rows.length) return setErr('Paste at least one line')
      if (bad >= 0) return setErr(`Line ${bad + 1} should look like: 2026, Disease Detectives, https://…`)
      const ins = await supabase.from('past_resources').insert(rows.map((c) => ({ year: Number(c[0]), course_name: c[1], url: c[2], subject: subjectOf(c[3] ?? '') })))
      if (ins.error) return setErr('Something went wrong. Please try again.')
      return onSaved(`Added ${rows.length}`)
    }
    if (!f.course_name.trim()) return setErr('Enter the course or event')
    if (!/^\d{4}$/.test(f.year.trim())) return setErr('Enter a year, like 2026')
    if (!okUrl(f.url)) return setErr('Enter a full link starting with https://')
    const row = { course_name: f.course_name.trim(), year: Number(f.year), subject: f.subject || null, url: f.url.trim(), ...fromStatus(f.status) }
    const out = res ? await supabase.from('past_resources').update(row).eq('id', res.id) : await supabase.from('past_resources').insert(row)
    if (out.error) return setErr('Something went wrong. Please try again.')
    onSaved(res ? 'All Changes Saved' : 'Added')
  }
  async function remove() {
    if (!res) return
    const out = await supabase.from('past_resources').delete().eq('id', res.id)
    if (out.error) return setErr('Something went wrong. Please try again.')
    onSaved('Deleted')
  }

  if (confirm && res)
    return (
      <Dialog
        open
        origin={origin}
        onClose={() => setConfirm(false)}
        title={`Delete ${res.course_name} (${res.year})?`}
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
      width={560}
      title={res ? `Edit ${res.course_name}` : 'Add slideshow'}
      footer={
        <>
          {res && (
            <Button variant="outline" className="btn--danger-outline" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{res ? 'Save' : 'Add'}</Button>
        </>
      }
    >
      <div className="dlgform p6form">
        {!res && (
          <Tabs<'one' | 'list'>
            fill
            label="Add one or a list"
            value={mode}
            onChange={(m) => { setMode(m); setErr(null) }}
            options={[
              { value: 'one', label: 'One' },
              { value: 'list', label: 'Paste a list' },
            ]}
          />
        )}
        {mode === 'one' ? (
          <>
            <TextField label="Course or event" value={f.course_name} onChange={set('course_name')} placeholder="Disease Detectives: Advanced" />
            <div className="fieldrow">
              <TextField label="Year" inputMode="numeric" value={f.year} onChange={set('year')} fieldStyle={{ flex: '1 1 100px' }} />
              <SelectField label="Subject" value={f.subject} onChange={set('subject')} fieldStyle={{ flex: '1 1 160px' }}>
                <option value="">None</option>
                {(Object.keys(SUBJECTS) as Subject[]).map((s) => <option key={s} value={s}>{SUBJECTS[s].label}</option>)}
              </SelectField>
              <SelectField label="Status" value={f.status} onChange={set('status')} fieldStyle={{ flex: '1 1 140px' }}>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </SelectField>
            </div>
            <TextField label="Slideshow folder link" value={f.url} onChange={set('url')} placeholder="https://drive.google.com/drive/folders/…" />
          </>
        ) : (
          <TextAreaField
            label="One per line: Year, Course, Link, Subject (optional)"
            rows={8}
            value={list}
            onChange={(e) => setList(e.target.value)}
            placeholder={'2026, Disease Detectives: Advanced, https://drive.google.com/…, Biology\n2025, Forensics, https://drive.google.com/…, Chem & Phys'}
            hint="Copied cells from Google Sheets work too"
          />
        )}
        {err && <p role="alert" className="field__error">{err}</p>}
      </div>
    </Dialog>
  )
}
