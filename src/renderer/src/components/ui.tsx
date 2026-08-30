import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Cross } from './Icons'

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ toggle */
export function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="no-drag focus-ring relative h-[26px] w-[46px] shrink-0 rounded-pill disabled:opacity-40"
      style={{
        background: checked ? 'var(--accent)' : 'var(--line-strong)',
        transition: 'background var(--t-base) var(--ease-out)'
      }}
    >
      <span
        className="absolute top-[3px] h-5 w-5 rounded-pill bg-white shadow-sm"
        style={{
          left: checked ? 23 : 3,
          transition: 'left var(--t-base) var(--ease-spring), transform var(--t-fast) var(--ease-out)'
        }}
      />
    </button>
  )
}

/* --------------------------------------------------------------- segmented */
export interface SegmentOption<T extends string> {
  value: T
  label?: string
  icon?: ReactNode
  title?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md'
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className="no-drag inline-flex items-center gap-0.5 rounded-[12px] p-[3px]"
      style={{ background: 'var(--field-idle)' }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={cx(
              'focus-ring flex items-center justify-center gap-1.5 rounded-[9px] font-medium',
              size === 'sm' ? 'h-[24px] px-2.5 text-xs' : 'h-[30px] px-3 text-sm'
            )}
            style={{
              background: active ? 'var(--surface-solid)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-dim)',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              transition:
                'background var(--t-base) var(--ease-out), color var(--t-fast) linear, box-shadow var(--t-base) var(--ease-out)'
            }}
          >
            {option.icon}
            {option.label && <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ slider */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  width = 150
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  width?: number
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="no-drag flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          width,
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--line-strong) ${pct}%)`
        }}
      />
      <span className="w-16 text-right text-sm tabular-nums text-dim">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ select */
export function Select<T extends string>({
  value,
  options,
  onChange,
  width
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  width?: number
}) {
  return (
    <div className="no-drag relative" style={{ width }}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="field focus-ring w-full cursor-pointer appearance-none pr-8 font-medium"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} style={{ background: 'var(--surface-solid)' }}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        width={13}
        height={13}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint"
      />
    </div>
  )
}

/* ------------------------------------------------------------------- input */
export function TextField({
  value,
  onChange,
  placeholder,
  width = 260,
  mono,
  type = 'text',
  autoFocus,
  onEnter,
  label
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  width?: number | string
  mono?: boolean
  type?: 'text' | 'password' | 'url'
  autoFocus?: boolean
  onEnter?: () => void
  label?: string
}) {
  return (
    <input
      value={value}
      type={type}
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.key === 'Enter' && onEnter?.()}
      style={{ width }}
      className={cx('field focus-ring', mono && 'font-mono text-xs')}
    />
  )
}

/* ----------------------------------------------------------- layout pieces */
export function Section({
  title,
  icon,
  description,
  children,
  action
}: {
  title: string
  icon?: ReactNode
  description?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="animate-fade-up contain">
      <header className="mb-3 flex items-center gap-2.5 px-1">
        {icon && (
          <span
            className="flex h-7 w-7 items-center justify-center rounded-[9px]"
            style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description && <p className="text-sm text-dim">{description}</p>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="card overflow-hidden">{children}</div>
    </section>
  )
}

export function Row({
  title,
  hint,
  children,
  danger,
  icon
}: {
  title: string
  hint?: string
  children?: ReactNode
  danger?: boolean
  icon?: ReactNode
}) {
  return (
    <div
      className="flex min-h-[52px] items-center justify-between gap-6 px-4 py-2.5"
      style={{
        borderTop: '1px solid var(--line)',
        transition: 'background var(--t-fast) linear'
      }}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 text-dim">{icon}</span>}
        <div className="min-w-0">
          <div className={cx('text-base font-medium', danger && 'text-[var(--bad)]')}>{title}</div>
          {hint && <div className="mt-0.5 text-sm leading-snug text-dim">{hint}</div>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Pill({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'
}) {
  const colors: Record<string, string> = {
    neutral: 'var(--text-dim)',
    good: 'var(--good)',
    warn: 'var(--warn)',
    bad: 'var(--bad)',
    accent: 'var(--accent)'
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-[3px] text-2xs font-semibold uppercase tracking-wide"
      style={{ color: colors[tone], background: `color-mix(in srgb, ${colors[tone]} 14%, transparent)` }}
    >
      {children}
    </span>
  )
}

export function ChoiceCard<T extends string>({
  value,
  current,
  onSelect,
  icon,
  title,
  hint
}: {
  value: T
  current: T
  onSelect: (value: T) => void
  icon: ReactNode
  title: string
  hint?: string
}) {
  const active = value === current
  return (
    <button
      onClick={() => onSelect(value)}
      className="focus-ring no-drag relative flex flex-1 flex-col items-start gap-2 rounded-card border p-3 text-left"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--line)',
        background: active ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : 'var(--field-idle)',
        transition:
          'border-color var(--t-base) var(--ease-out), background var(--t-base) var(--ease-out), transform var(--t-fast) var(--ease-spring)'
      }}
      onMouseDown={(event) => (event.currentTarget.style.transform = 'scale(0.985)')}
      onMouseUp={(event) => (event.currentTarget.style.transform = '')}
      onMouseLeave={(event) => (event.currentTarget.style.transform = '')}
    >
      <span className="flex items-center gap-2 text-base font-medium">
        <span style={{ color: active ? 'var(--accent)' : 'var(--text-dim)' }}>{icon}</span>
        {title}
      </span>
      {hint && <span className="text-sm leading-snug text-dim">{hint}</span>}
      {active && (
        <span
          className="animate-pop absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-pill text-white"
          style={{ background: 'var(--accent)' }}
        >
          <Check width={10} height={10} />
        </span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------- modal */
export function Modal({
  title,
  children,
  onClose,
  footer,
  width = 460
}: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="animate-fade fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'color-mix(in srgb, var(--bg) 55%, transparent)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="animate-sheet contain overflow-hidden rounded-card"
        style={{
          width,
          maxWidth: '92vw',
          background: 'var(--elevated)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid var(--line)'
        }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Cross width={15} height={15} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer
            className="flex items-center justify-end gap-2 px-5 py-3.5"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ popover */
export function Popover({
  children,
  onClose,
  anchor = 'right',
  width = 300,
  top = 46
}: {
  children: ReactNode
  onClose: () => void
  anchor?: 'left' | 'right'
  width?: number
  top?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* The page is hidden while a popover is open, so a soft backdrop keeps
          that intentional instead of looking like the page vanished. */}
      <div
        className="animate-fade fixed inset-0 z-40"
        style={{ background: 'color-mix(in srgb, var(--bg) 40%, transparent)' }}
        onClick={onClose}
      />
      <div
        ref={ref}
        className="animate-fade-down contain absolute z-50 overflow-hidden rounded-card"
        style={{
          top,
          [anchor]: 8,
          width,
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(28px) saturate(180%)'
        }}
      >
        {children}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------- misc */
export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="animate-fade flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <span className="text-faint">{icon}</span>}
      <div className="text-base font-medium">{title}</div>
      {hint && <div className="max-w-[340px] text-sm text-dim">{hint}</div>}
    </div>
  )
}

export function Avatar({
  avatar,
  color,
  size = 26,
  ring
}: {
  avatar: string
  color: string
  size?: number
  ring?: boolean
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-pill"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 55%, #000))`,
        fontSize: size * 0.5,
        boxShadow: ring ? `0 0 0 2px color-mix(in srgb, ${color} 45%, transparent)` : 'var(--shadow-sm)',
        transition: 'box-shadow var(--t-base) var(--ease-out), transform var(--t-fast) var(--ease-spring)'
      }}
    >
      {avatar.startsWith('file:') ? '🖼️' : avatar}
    </span>
  )
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          className="animate-fade pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[8px] px-2 py-1 text-2xs"
          style={{ background: 'var(--elevated)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-md)' }}
        >
          {label}
        </span>
      )}
    </span>
  )
}

export const formatBytes = (bytes: number) => {
  if (!bytes) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

export const formatDate = (ms: number) => {
  const date = new Date(ms)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
