/**
 * Putting things in an order.
 *
 * Used for the toolbar and for the main menu: two lists, what is in and what
 * is out, and arrows to move a row up or down. Dragging is nicer to look at
 * and worse to use — with a trackpad, with one hand, with a tremor — so the
 * arrows are the way it works and dragging is not pretended at.
 */
import { t } from '../i18n'
import { ChevronDown, ChevronRight, Cross, Plus } from './Icons'
import { cx } from './ui'

export interface Arrangeable {
  id: string
  name: string
}

export function Arrangement({
  chosen,
  all,
  required,
  repeatable,
  onChange
}: {
  /** what is on it now, in order */
  chosen: string[]
  /** everything it could hold */
  all: Arrangeable[]
  /** what cannot be taken off */
  required: readonly string[]
  /** what may appear more than once, such as a gap */
  repeatable: readonly string[]
  onChange: (next: string[]) => void
}) {
  const nameOf = (id: string) => all.find((one) => one.id === id)?.name ?? id
  const spare = all.filter((one) => repeatable.includes(one.id) || !chosen.includes(one.id))

  const move = (at: number, by: number) => {
    const next = [...chosen]
    const to = at + by
    if (to < 0 || to >= next.length) return
    ;[next[at], next[to]] = [next[to], next[at]]
    onChange(next)
  }

  return (
    <div className="p-3">
      <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-faint">{t('Стоит сейчас')}</div>
      <div className="flex flex-col gap-1">
        {chosen.map((id, at) => (
          <div
            key={`${id}-${at}`}
            className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5"
            style={{ background: 'var(--field-idle)' }}
          >
            <span className="tabular-nums text-2xs text-faint">{at + 1}</span>
            <span className={cx('min-w-0 flex-1 truncate text-sm', id === 'space' && 'text-faint')}>
              {nameOf(id)}
            </span>
            <button
              className="icon-btn h-6 w-6 shrink-0"
              aria-label={t('Выше')}
              title={t('Выше')}
              disabled={at === 0}
              onClick={() => move(at, -1)}
            >
              <ChevronRight width={12} height={12} style={{ transform: 'rotate(-90deg)' }} />
            </button>
            <button
              className="icon-btn h-6 w-6 shrink-0"
              aria-label={t('Ниже')}
              title={t('Ниже')}
              disabled={at === chosen.length - 1}
              onClick={() => move(at, 1)}
            >
              <ChevronDown width={12} height={12} />
            </button>
            <button
              className="icon-btn h-6 w-6 shrink-0"
              aria-label={t('Убрать')}
              title={required.includes(id) ? t('Без этого нельзя') : t('Убрать')}
              disabled={required.includes(id)}
              onClick={() => onChange(chosen.filter((_one, index) => index !== at))}
            >
              <Cross width={12} height={12} />
            </button>
          </div>
        ))}
      </div>

      {spare.length > 0 && (
        <>
          <div className="mb-2 mt-3 text-2xs font-semibold uppercase tracking-wide text-faint">
            {t('Можно добавить')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {spare.map((one) => (
              <button
                key={one.id}
                className="flex h-[26px] items-center gap-1 rounded-pill px-2.5 text-2xs font-medium"
                style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
                onClick={() => onChange([...chosen, one.id])}
              >
                <Plus width={11} height={11} />
                {one.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * What the density slider actually does, drawn at three sizes.
 *
 * A number from zero to two says nothing; three toolbars side by side, one of
 * them the one you have chosen, say all of it at a glance.
 */
export function DensityDemo({ value }: { value: number }) {
  const rows = [
    { at: 0, label: t('Свободно') },
    { at: 1, label: t('Обычно') },
    { at: 2, label: t('Плотно') }
  ]
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const height = Math.round(48 - row.at * 4)
        const here = Math.round(value) === row.at
        return (
          <div key={row.at} className="flex items-center gap-3">
            <span className={cx('w-[68px] shrink-0 text-2xs', here ? 'text-ink' : 'text-faint')}>{row.label}</span>
            <div
              className="flex flex-1 items-center gap-1.5 rounded-[var(--radius-sm)] px-2"
              style={{
                height,
                background: 'var(--surface-solid)',
                outline: here ? '1.5px solid var(--accent)' : '1px solid var(--line)'
              }}
            >
              {[0, 1, 2].map((one) => (
                <span
                  key={one}
                  className="rounded-[6px]"
                  style={{ width: height - 18, height: height - 18, background: 'var(--field-idle)' }}
                />
              ))}
              <span
                className="ml-1 flex-1 rounded-pill"
                style={{ height: height - 22, background: 'var(--field-idle)' }}
              />
            </div>
            <span className="w-[34px] shrink-0 text-right tabular-nums text-2xs text-faint">{height}px</span>
          </div>
        )
      })}
    </div>
  )
}
