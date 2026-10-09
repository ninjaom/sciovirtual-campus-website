import { useCallback, useEffect, useRef, useState } from 'react'

/** Loads data once (and again whenever deps change or reload() is called). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loader = useRef(load)
  loader.current = load

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await loader.current())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, setData, error, loading, reload }
}

/** Throws a Supabase error so useLoad can show it. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}
