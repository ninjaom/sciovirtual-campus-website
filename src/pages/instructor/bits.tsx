import type { PersonCard } from '../../lib/people'

/** Round photo or initials. Directors are blue, instructors teal, students lavender. */
export function Ava({ person, size = 42, fallback = '?' }: { person?: PersonCard | null; size?: number; fallback?: string }) {
  const tone = person?.role === 'admin' ? ' ava--director' : person?.role === 'student' ? ' ava--student' : ''
  return (
    <span className={'ava' + tone} style={{ width: size, height: size, fontSize: size >= 40 ? 14 : 13 }} aria-hidden="true">
      {person?.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" decoding="async" /> : person?.initials ?? fallback}
    </span>
  )
}

export function FileIcon() {
  return (
    <span className="filechip__icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </svg>
    </span>
  )
}

export function LinkIcon() {
  return (
    <span className="filechip__icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    </span>
  )
}

/** Attachments stored on posts: a link, or a file in the course-files bucket. */
export type Attachment = { type: 'link'; url: string; label?: string } | { type: 'file'; path: string; name: string; size?: number }
