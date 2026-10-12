import { supabase } from './supabase'
/** Calls the small server functions (sign-up and password reset). */
export async function postApi<T>(path: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as T
  } catch {
    return { ok: false, error: 'server' } as T
  }
}

/** Same, signed in: for admin-only server functions. */
export async function postApiAuth<T>(path: string, body: unknown): Promise<T> {
  try {
    const { data } = await supabase.auth.getSession()
    const res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify(body),
    })
    return (await res.json()) as T
  } catch {
    return { ok: false, error: 'server' } as T
  }
}
