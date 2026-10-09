import { supabase } from './supabase'

/*
 * Photos live in a private bucket and are shown through signed links that
 * last an hour. Each photo's link is reused for as long as it's good (also
 * across page reloads in the same tab), so the browser can keep the photo
 * instead of downloading it again on every visit.
 */
const LIFETIME = 3600 // seconds
const REUSE_MARGIN = 5 * 60 * 1000 // stop reusing a link 5 minutes before it expires
const KEY = 'campus-avatar-links'

type Entry = { url: string; until: number }
const links = new Map<string, Entry>(readStored())

function readStored(): [string, Entry][] {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as [string, Entry][]) : []
  } catch {
    return []
  }
}
function store() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...links]))
  } catch {
    /* storage unavailable: links are still reused for this page view */
  }
}

/** Signed links for these photo paths (paths without a photo are skipped). */
export async function avatarLinks(paths: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const now = Date.now()
  const out = new Map<string, string>()
  const need: string[] = []
  for (const p of new Set([...paths].filter((x): x is string => !!x))) {
    const hit = links.get(p)
    if (hit && hit.until - REUSE_MARGIN > now) out.set(p, hit.url)
    else need.push(p)
  }
  for (let i = 0; i < need.length; i += 200) {
    const { data } = await supabase.storage.from('avatars').createSignedUrls(need.slice(i, i + 200), LIFETIME)
    for (const s of data ?? [])
      if (s.path && s.signedUrl) {
        links.set(s.path, { url: s.signedUrl, until: now + LIFETIME * 1000 })
        out.set(s.path, s.signedUrl)
      }
  }
  if (need.length) store()
  return out
}

export async function avatarLink(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  return (await avatarLinks([path])).get(path) ?? null
}

/** Forget a photo's link (after it's replaced or removed). */
export function forgetAvatar(path: string | null | undefined) {
  if (path && links.delete(path)) store()
}

/*
 * Photos are shrunk in the browser before upload: center-cropped to a
 * square (they're always shown in a circle) and saved at 256 × 256, which
 * keeps each photo around 15 KB instead of several MB.
 */
const SIZE = 256

export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
  if ('close' in bitmap) bitmap.close()
  const webp = await toBlob(canvas, 'image/webp', 0.85)
  // Older Safari can't make WebP and quietly returns PNG; use JPEG there.
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.85)
  if (!jpeg) throw new Error('could not encode photo')
  return jpeg
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Respect phone photos' rotation.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

export const photoExt = (blob: Blob) => (blob.type === 'image/webp' ? 'webp' : 'jpg')
