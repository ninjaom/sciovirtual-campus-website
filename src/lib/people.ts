import { supabase } from './supabase'
import { avatarLinks } from './avatars'
import { initials } from './format'
import type { Role } from './types'

export interface PersonCard {
  id: string
  name: string
  first: string
  last: string
  role: Role
  initials: string
  avatarUrl: string | null
}

/**
 * Names and photos for a set of people, through people_directory (which only
 * returns people the signed-in person may see). Photos are signed links.
 */
export async function loadPeople(ids: (string | null | undefined)[]): Promise<Map<string, PersonCard>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, PersonCard>()
  if (!want.length) return out
  const rows: { id: string; first_name: string; last_name: string; role: Role; avatar_path: string | null }[] = []
  for (let i = 0; i < want.length; i += 150) {
    const { data } = await supabase.from('people_directory').select('id, first_name, last_name, role, avatar_path').in('id', want.slice(i, i + 150))
    rows.push(...((data ?? []) as typeof rows))
  }
  const urls = await avatarLinks(rows.map((r) => r.avatar_path))
  for (const r of rows)
    out.set(r.id, {
      id: r.id,
      name: `${r.first_name} ${r.last_name}`,
      first: r.first_name,
      last: r.last_name,
      role: r.role,
      initials: initials(r.first_name, r.last_name),
      avatarUrl: r.avatar_path ? urls.get(r.avatar_path) ?? null : null,
    })
  return out
}
