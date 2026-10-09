import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, type LinkProps } from 'react-router'
import './ui.css'

/* ---------- Buttons: three looks (plus teal accent and danger) ---------- */

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'accent' | 'danger'
type ButtonSize = 'md' | 'sm' | 'lg'

function btnClass(variant: ButtonVariant, size: ButtonSize, block?: boolean, extra?: string) {
  return ['btn', `btn--${variant}`, `btn--${size}`, block ? 'btn--block' : '', extra ?? ''].filter(Boolean).join(' ')
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }) {
  return <button type={type} className={btnClass(variant, size, block, className)} {...rest} />
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  className,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }) {
  return <Link className={btnClass(variant, size, block, className)} {...rest} />
}

export function ButtonA({
  variant = 'primary',
  size = 'md',
  block,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }) {
  return <a className={btnClass(variant, size, block, className)} {...rest} />
}

/* ---------- Cards ---------- */

export function Card({
  title,
  actions,
  children,
  className,
  as: Tag = 'section',
}: {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  as?: 'section' | 'article' | 'div'
}) {
  return (
    <Tag className={'card' + (className ? ' ' + className : '')}>
      {(title || actions) && (
        <div className="card__head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  )
}

/* ---------- Form fields ---------- */

interface FieldBits {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Style for the label + input wrapper (e.g. flex basis in a row). */
  fieldStyle?: CSSProperties
}

function FieldWrap({ id, label, hint, error, children, fieldStyle }: FieldBits & { id: string; children: ReactNode }) {
  return (
    <div className="field" style={fieldStyle}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {children}
      {error ? (
        <span id={id + '-msg'} role="alert" className="field__error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6M12 16.5v.5" />
          </svg>
          {error}
        </span>
      ) : hint ? (
        <span id={id + '-msg'} className="field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function TextField({ label, hint, error, id, className, fieldStyle, ...rest }: FieldBits & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldWrap id={fid} label={label} hint={hint} error={error} fieldStyle={fieldStyle}>
      <input
        id={fid}
        className={'input' + (error ? ' is-invalid' : '') + (className ? ' ' + className : '')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? fid + '-msg' : undefined}
        {...rest}
      />
    </FieldWrap>
  )
}

export function SelectField({ label, hint, error, id, children, fieldStyle, ...rest }: FieldBits & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldWrap id={fid} label={label} hint={hint} error={error} fieldStyle={fieldStyle}>
      <select id={fid} className={'input' + (error ? ' is-invalid' : '')} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
    </FieldWrap>
  )
}

export function TextAreaField({ label, hint, error, id, fieldStyle, ...rest }: FieldBits & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldWrap id={fid} label={label} hint={hint} error={error} fieldStyle={fieldStyle}>
      <textarea id={fid} className={'input input--area' + (error ? ' is-invalid' : '')} aria-invalid={error ? true : undefined} {...rest} />
    </FieldWrap>
  )
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="search" className="input input--search" {...props} />
}

/* ---------- Pills ---------- */

export type PillTone = 'blue' | 'green' | 'amber' | 'grey' | 'red' | 'solid'

export function Pill({ tone = 'blue', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}

/* ---------- Tabs (segmented, sliding highlight) ---------- */

export function Tabs<T extends string>({
  label,
  options,
  value,
  onChange,
  fill,
}: {
  label: string
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  /** Stretch to full width with equal segments (used in pop-ups). */
  fill?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      setThumb(el && el.offsetWidth > 0 ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null)
    }
    measure()
    // Re-measure when the tabs change size (e.g. inside a pop-up that just opened).
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [value, options.length])
  return (
    <div ref={wrap} role="tablist" aria-label={label} className={'tabs' + (thumb ? ' is-measured' : '') + (fill ? ' tabs--fill' : '')}>
      {thumb && (
        <span
          className="tabs__thumb"
          aria-hidden="true"
          style={{ width: thumb.w, height: thumb.h, transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
        />
      )}
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className="tabs__tab" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch__knob" />
    </button>
  )
}

/* ---------- States ---------- */

export function EmptyState({ title, body, icon }: { title: ReactNode; body?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden="true">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l15-6v14L3 13z" />
            <path d="M7 13v4a2 2 0 0 0 4 0v-3" />
          </svg>
        )}
      </span>
      <span className="empty__title">{title}</span>
      {body && <span className="empty__body">{body}</span>}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 14, round }: { width?: number | string; height?: number; round?: boolean }) {
  return <span className="sk" style={{ width, height, borderRadius: round ? '50%' : undefined }} aria-hidden="true" />
}

export function SavedStatus({ state = 'saved' }: { state?: 'saved' | 'saving' | 'error' }) {
  return (
    <span role="status" className={'saved saved--' + state}>
      {state === 'saved' && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
      {state === 'saved' ? 'All changes saved' : state === 'saving' ? '[Saving…]' : '[Couldn’t save. Try again.]'}
    </span>
  )
}

/* ---------- Tables ---------- */

export function TableWrap({ children, sticky, maxHeight }: { children: ReactNode; sticky?: boolean; maxHeight?: number }) {
  return (
    <div className={'tablewrap' + (sticky ? ' tablewrap--sticky' : '')} style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </div>
  )
}

/* ---------- Banner (blue hero strip) ---------- */

export function Banner({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="banner">
      <span className="banner__c1" aria-hidden="true" />
      <span className="banner__c2" aria-hidden="true" />
      <div className="banner__inner">
        <div className="banner__text">
          {eyebrow && <span className="banner__eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {children && <div className="banner__side">{children}</div>}
      </div>
    </section>
  )
}
