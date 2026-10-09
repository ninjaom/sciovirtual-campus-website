import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { shortDate, when } from '../../lib/camp'
import { loadPeople, type PersonCard } from '../../lib/people'
import { Button, Card, Skeleton, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { useCourse } from './CourseLayout'
import { Ava, FileIcon, LinkIcon, type Attachment } from './bits'

interface Post {
  id: string
  author_id: string | null
  body: string
  attachments: Attachment[]
  created_at: string
  announcement_comments: { id: string; author_id: string | null; body: string; created_at: string }[]
}

const MAX_FILE = 10 * 1024 * 1024
const BUCKET = 'course-files'

function Paperclip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5" />
    </svg>
  )
}
function LinkGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  )
}
function XGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Shows a post's links and files; files open through short-lived signed links. */
export function AttachmentList({ items, urls }: { items: Attachment[]; urls: Map<string, string> }) {
  return (
    <>
      {items.map((a, i) =>
        a.type === 'link' ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="filechip">
            <LinkIcon />
            {a.label || a.url}
          </a>
        ) : (
          <a key={i} href={urls.get(a.path) ?? '#'} target="_blank" rel="noreferrer" className="filechip">
            <FileIcon />
            {a.name}
          </a>
        ),
      )}
    </>
  )
}

export function Announcements() {
  const { course } = useCourse()
  const { profile } = useAuth()
  const toast = useToast()
  const me = profile!

  const { data, reload, setData } = useLoad(async () => {
    const posts = must(
      await supabase
        .from('announcements')
        .select('id, author_id, body, attachments, created_at, announcement_comments(id, author_id, body, created_at)')
        .eq('course_id', course.id)
        .order('created_at', { ascending: false }),
    ) as Post[]
    for (const p of posts) p.announcement_comments.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const people = await loadPeople([me.id, ...posts.flatMap((p) => [p.author_id, ...p.announcement_comments.map((c) => c.author_id)])])
    const paths = posts.flatMap((p) => p.attachments.filter((a) => a.type === 'file').map((a) => (a as { path: string }).path))
    const urls = new Map<string, string>()
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    }
    return { posts, people, urls }
  }, [course.id])

  // ---------- New post ----------
  const [draft, setDraft] = useState('')
  const [links, setLinks] = useState<{ url: string; label: string }[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [posting, setPosting] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function pickFiles(list: FileList | null) {
    const picked = [...(list ?? [])]
    const tooBig = picked.filter((f) => f.size > MAX_FILE)
    if (tooBig.length) toast('Files can be up to 10 MB', 'error')
    setFiles((f) => [...f, ...picked.filter((x) => x.size <= MAX_FILE)])
    if (fileInput.current) fileInput.current.value = ''
  }

  async function post() {
    if (!draft.trim() && !links.length && !files.length) return
    setPosting(true)
    const attachments: Attachment[] = links.map((l) => ({ type: 'link', url: l.url, label: l.label || undefined }))
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\- ]+/g, '_')
      const path = `${course.id}/${crypto.randomUUID()}/${safe}`
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined })
      if (up.error) {
        setPosting(false)
        toast(up.error.message.includes('mime') ? 'That file type can’t be attached' : 'Couldn’t upload ' + f.name, 'error')
        return
      }
      attachments.push({ type: 'file', path, name: f.name, size: f.size })
    }
    const res = await supabase.from('announcements').insert({ course_id: course.id, author_id: me.id, body: draft.trim(), attachments })
    setPosting(false)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    setDraft('')
    setLinks([])
    setFiles([])
    toast('Posted')
    reload()
  }

  // ---------- Edit / delete ----------
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [deleting, setDeleting] = useState<Post | null>(null)

  async function saveEdit() {
    if (!editing) return
    const res = await supabase.from('announcements').update({ body: editing.body.trim(), edited_at: new Date().toISOString() }).eq('id', editing.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    setData((d) => (d ? { ...d, posts: d.posts.map((p) => (p.id === editing.id ? { ...p, body: editing.body.trim() } : p)) } : d))
    setEditing(null)
    toast('All Changes Saved')
  }
  async function confirmDelete() {
    if (!deleting) return
    const paths = deleting.attachments.filter((a) => a.type === 'file').map((a) => (a as { path: string }).path)
    const res = await supabase.from('announcements').delete().eq('id', deleting.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    setDeleting(null)
    toast('Deleted')
    reload()
  }

  const canManage = (p: Post) => p.author_id === me.id || me.role === 'admin'

  return (
    <div className="annlist">
      <Card className="composer">
        <div className="composer__top">
          <Ava person={data?.people.get(me.id)} fallback={me.firstName[0] + me.lastName[0]} />
          <label htmlFor="ann-draft" className="sr-only">
            New announcement
          </label>
          <textarea id="ann-draft" rows={3} className="composer__text" placeholder="Share something with your class" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        {(links.length > 0 || files.length > 0) && (
          <div className="composer__chips">
            {links.map((l, i) => (
              <span key={'l' + i} className="filechip">
                <LinkIcon />
                {l.label || l.url}
                <button type="button" className="chipx" aria-label="Remove link" onClick={() => setLinks((x) => x.filter((_, j) => j !== i))}>
                  <XGlyph />
                </button>
              </span>
            ))}
            {files.map((f, i) => (
              <span key={'f' + i} className="filechip">
                <FileIcon />
                {f.name}
                <button type="button" className="chipx" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                  <XGlyph />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer__bar">
          <div className="composer__tools">
            <button type="button" className="toolbtn" onClick={(e) => { setOrigin(e.currentTarget); setLinkOpen(true) }}>
              <LinkGlyph />
              <span>Add Link</span>
            </button>
            <button type="button" className="toolbtn" onClick={() => fileInput.current?.click()}>
              <Paperclip />
              <span>Attach File</span>
            </button>
            <input ref={fileInput} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.ppt,.pptx,.doc,.docx" onChange={(e) => pickFiles(e.target.files)} />
          </div>
          <Button size="lg" className="composer__post" onClick={post} disabled={posting || (!draft.trim() && !links.length && !files.length)}>
            {posting ? 'Posting…' : 'Post'}
          </Button>
        </div>
      </Card>

      {!data && <Skeleton height={180} />}
      {data?.posts.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          people={data.people}
          urls={data.urls}
          me={me.id}
          canManage={canManage(p)}
          editing={editing?.id === p.id ? editing.body : null}
          onEdit={() => setEditing({ id: p.id, body: p.body })}
          onEditChange={(body) => setEditing({ id: p.id, body })}
          onEditCancel={() => setEditing(null)}
          onEditSave={saveEdit}
          onDelete={(el) => { setOrigin(el); setDeleting(p) }}
          onChanged={reload}
        />
      ))}
      {data && data.posts.length === 0 && (
        <Card>
          <p className="inote" style={{ fontSize: 14 }}>No announcements yet</p>
        </Card>
      )}

      {linkOpen && <AddLink origin={origin} onClose={() => setLinkOpen(false)} onAdd={(l) => { setLinks((x) => [...x, l]); setLinkOpen(false) }} />}
      {deleting && (
        <Dialog
          open
          origin={origin}
          onClose={() => setDeleting(null)}
          title="Delete this announcement?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmDelete}>Delete</Button>
            </>
          }
        >
          <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>This can't be undone.</p>
        </Dialog>
      )}
    </div>
  )
}

function AddLink({ origin, onClose, onAdd }: { origin: HTMLElement | null; onClose: () => void; onAdd: (l: { url: string; label: string }) => void }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  function submit(e?: FormEvent) {
    e?.preventDefault()
    let u = url.trim()
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u
    try {
      new URL(u)
    } catch {
      return setErr('Enter a full link, like https://example.com')
    }
    onAdd({ url: u, label: label.trim() })
  }
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Add Link"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()}>Add Link</Button>
        </>
      }
    >
      <form onSubmit={submit} className="dlgform" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextField label="Link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" error={err ?? undefined} autoFocus />
        <TextField label="Text to show (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      </form>
    </Dialog>
  )
}

function PostCard({
  post,
  people,
  urls,
  me,
  canManage,
  editing,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onDelete,
  onChanged,
}: {
  post: Post
  people: Map<string, PersonCard>
  urls: Map<string, string>
  me: string
  canManage: boolean
  editing: string | null
  onEdit: () => void
  onEditChange: (b: string) => void
  onEditCancel: () => void
  onEditSave: () => void
  onDelete: (el: HTMLElement) => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const author = post.author_id ? people.get(post.author_id) : undefined
  const n = post.announcement_comments.length

  async function addComment(e: FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    const res = await supabase.from('announcement_comments').insert({ announcement_id: post.id, author_id: me, body: comment.trim() })
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    setComment('')
    onChanged()
  }
  async function removeComment(id: string) {
    const res = await supabase.from('announcement_comments').delete().eq('id', id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    onChanged()
  }

  return (
    <article className="update post">
      <div className="update__head" style={{ alignItems: 'flex-start' }}>
        <div className="update__who">
          <Ava person={author} />
          <div className="update__meta">
            <span className="update__name">{author?.name ?? 'Instructor'}</span>
            <span className="update__when">{when(post.created_at)}</span>
          </div>
        </div>
        {canManage && editing == null && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="minibtn" onClick={onEdit}>Edit</button>
            <button type="button" className="minibtn minibtn--danger" onClick={(e) => onDelete(e.currentTarget)}>Delete</button>
          </div>
        )}
      </div>
      {editing != null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label htmlFor={'edit-' + post.id} className="sr-only">Edit announcement</label>
          <textarea id={'edit-' + post.id} className="composer__text" rows={4} value={editing} onChange={(e) => onEditChange(e.target.value)} autoFocus />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={onEditCancel}>Cancel</Button>
            <Button onClick={onEditSave} disabled={!editing.trim()}>Save</Button>
          </div>
        </div>
      ) : (
        post.body && <p className="update__body">{post.body}</p>
      )}
      <AttachmentList items={post.attachments} urls={urls} />
      <div className="post__comments">
        <button type="button" className="post__toggle" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          {n} {n === 1 ? 'comment' : 'comments'} {open ? '▴' : '▾'}
        </button>
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {post.announcement_comments.map((c) => {
              const who = c.author_id ? people.get(c.author_id) : undefined
              return (
                <div key={c.id} className="cmt">
                  <Ava person={who} size={32} />
                  <div className="cmt__bubble">
                    <span className="cmt__top">
                      <span className="cmt__who">{who?.name ?? 'Someone'}</span>
                      <span className="cmt__when">{shortDate(new Date(c.created_at))}</span>
                    </span>
                    <span className="cmt__text">{c.body}</span>
                  </div>
                  <button type="button" className="cmt__x" aria-label="Remove comment" onClick={() => removeComment(c.id)}>
                    <XGlyph />
                  </button>
                </div>
              )
            })}
            <form className="cmt" style={{ alignItems: 'center' }} onSubmit={addComment}>
              <Ava person={people.get(me)} size={32} />
              <input type="text" className="cmt__input" aria-label="Add a comment" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            </form>
          </div>
        )}
      </div>
    </article>
  )
}
