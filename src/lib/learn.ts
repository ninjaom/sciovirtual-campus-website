import { Marked, type Token } from 'marked'
import DOMPurify from 'dompurify'
import { signFiles } from './files'

/** Subjects used by Learn and Past Resources (pill colors from the mockups). */
export const SUBJECTS = {
  bio: { label: 'Biology', bg: '#DDF5F0', fg: '#17695A' },
  earth: { label: 'Earth', bg: '#FFF6DB', fg: '#8A5A00' },
  chem: { label: 'Chem & Phys', bg: '#FDE7E7', fg: '#8E1B1B' },
  inq: { label: 'Inquiry', bg: '#D7DDFF', fg: '#3B4CC0' },
} as const
export type Subject = keyof typeof SUBJECTS

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'

/**
 * Files uploaded for Learn are private; in a post they're written as
 * `learn:<path>` (e.g. `![Diagram](learn:guides/abc/diagram.png)` or
 * `[Slides](learn:guides/abc/slides.pdf)`) and swapped for short-lived links
 * when the page is shown.
 */
export function learnRefs(md: string): string[] {
  return [...md.matchAll(/\(learn:([^)\s]+)\)/g)].map((m) => m[1])
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Short label for a file chip in a guide (LearnArticle board: Slides, Doc…). */
export function chipKind(url: string): string {
  if (/docs\.google\.com\/presentation/.test(url)) return 'Slides'
  if (/docs\.google\.com\/document/.test(url)) return 'Doc'
  if (/docs\.google\.com\/spreadsheets/.test(url)) return 'Sheet'
  if (/drive\.google\.com\/(drive\/)?folders/.test(url)) return 'Folder'
  if (/\.pdf($|\?)/i.test(url)) return 'PDF'
  if (/\.(png|jpe?g|gif|webp)($|\?)/i.test(url)) return 'Picture'
  return 'Link'
}

/** True when a paragraph holds only links (and separators), so it shows as file chips. */
const onlyLinks = (tokens: Token[]) =>
  tokens.some((t) => t.type === 'link') && tokens.every((t) => t.type === 'link' || t.type === 'br' || (t.type === 'text' && /^[\s,·|•-]*$/.test(t.raw)))

/**
 * A ```faculty block: first line is the intro, then one "Name | short bio"
 * line per person (LearnArticle board's lead-faculty box).
 */
function faculty(text: string): string {
  const [intro = '', ...rows] = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const people = rows.map((r) => {
    const [name, ...bio] = r.split('|')
    const n = name.trim()
    const initials = n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    return `<div class="lfac__person"><span class="lfac__av">${esc(initials)}</span><div><span class="lfac__name">${esc(n)}</span>${bio.length ? `<span class="lfac__bio">${esc(bio.join('|').trim())}</span>` : ''}</div></div>`
  })
  return `<div class="lfac"><span class="lfac__intro">${esc(intro)}</span><div class="lfac__people">${people.join('')}</div></div>\n`
}

export interface Rendered {
  html: string
  headings: { id: string; text: string }[]
}

/** Markdown to safe HTML, with section ids for the Contents list. */
export async function renderLearn(md: string): Promise<Rendered> {
  const urls = await signFiles('learn-files', learnRefs(md))
  const withLinks = md.replace(/\(learn:([^)\s]+)\)/g, (_, p: string) => `(${urls.get(p) ?? '#'})`)
  const headings: Rendered['headings'] = []
  const used = new Set<string>()
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        const plain = text.replace(/<[^>]+>/g, '')
        if (depth !== 2) return `<h${depth}>${text}</h${depth}>\n`
        let id = slugify(plain)
        while (used.has(id)) id += '-2'
        used.add(id)
        headings.push({ id, text: plain })
        return `<h2 id="${id}">${text}</h2>\n`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        const t = title ? ` title="${esc(title)}"` : ''
        return `<a href="${esc(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
      image({ href, title, text }) {
        return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`
          + (title ? `<span class="lcaption">${esc(title)}</span>` : '')
      },
      paragraph({ tokens }) {
        if (onlyLinks(tokens)) {
          const chips = tokens
            .filter((t): t is Extract<Token, { type: 'link' }> => t.type === 'link')
            .map((l) => `<a class="lfile" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer"><span class="lfile__kind">${chipKind(l.href)}</span><span class="lfile__name">${this.parser.parseInline(l.tokens)}</span></a>`)
          return `<div class="lfiles">${chips.join('')}</div>\n`
        }
        if (tokens.length === 1 && tokens[0].type === 'image') {
          const img = tokens[0]
          return `<figure class="lfig"><img src="${esc(img.href)}" alt="${esc(img.text)}" loading="lazy">${img.title ? `<figcaption>${esc(img.title)}</figcaption>` : ''}</figure>\n`
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`
      },
      code({ text, lang }) {
        if (lang === 'faculty') return faculty(text)
        return `<pre><code>${esc(text)}</code></pre>\n`
      },
    },
  })
  const raw = await marked.parse(withLinks)
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] })
  return { html, headings }
}

/** What a link points at (Past Resources cards, admin File column). */
export function linkKind(url: string): string {
  if (/docs\.google\.com\/presentation/.test(url)) return 'Google Slides'
  if (/drive\.google\.com\/(drive\/)?folders/.test(url)) return 'Drive folder'
  if (/drive\.google\.com/.test(url)) return 'Google Drive'
  if (/\.pdf($|\?)/i.test(url)) return 'PDF'
  return 'Link'
}
