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
