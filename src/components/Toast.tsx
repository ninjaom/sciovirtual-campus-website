import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import './Toast.css'

type Tone = 'success' | 'error'
interface ToastItem {
  id: number
  text: ReactNode
  tone: Tone
}

const ToastCtx = createContext<(text: ReactNode, tone?: Tone) => void>(() => {})

/** Action feedback (saved, added, sent, or an error). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const show = useCallback((text: ReactNode, tone: Tone = 'success') => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs, { id, text, tone }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'toast toast--' + t.tone}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastCtx)
