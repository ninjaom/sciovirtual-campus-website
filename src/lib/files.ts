import { supabase } from './supabase'

/** Short-lived links for private files (one request per 200 files). */
export async function signFiles(bucket: string, paths: (string | null | undefined)[], seconds = 3600): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))]
  const out = new Map<string, string>()
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(list.slice(i, i + 200), seconds)
    for (const s of data ?? []) if (s.path && s.signedUrl) out.set(s.path, s.signedUrl)
  }
  return out
}

/** A safe storage file name, kept readable. */
export const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, '_')
