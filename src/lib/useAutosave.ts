import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveState = 'saved' | 'saving' | 'error'

/**
 * Saves changes on its own a moment after typing stops (Design rules:
 * no Save buttons on settings pages). Changes to different fields are
 * merged into one save.
 */
export function useAutosave<P extends object>(save: (patch: Partial<P>) => PromiseLike<unknown>, delay = 600) {
  const [state, setState] = useState<SaveState>('saved')
  const pending = useRef<Partial<P>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saver = useRef(save)
  saver.current = save

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length === 0) return
    setState('saving')
    try {
      const res = (await saver.current(patch)) as { error?: unknown } | undefined
      setState(res && res.error ? 'error' : 'saved')
    } catch {
      setState('error')
    }
  }, [])

  const change = useCallback(
    (patch: Partial<P>) => {
      pending.current = { ...pending.current, ...patch }
      setState('saving')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [flush, delay],
  )

  // Save anything left when leaving the page.
  useEffect(() => () => void flush(), [flush])

  return { state, change, flush }
}
