import { t } from '../i18n'
import type { NetworkCheck } from '../../../shared/types'

/**
 * The four answers a network check gives, shown as four things rather than as
 * four words.
 *
 * The first version of this was `связь: ✓ имена: ✓ интернет: ✗` in small grey
 * monospace — accurate, and indistinguishable from a program printing its
 * internals at somebody. What a person wants from this row is to glance at it
 * and see, without reading, that three of the four are fine and one is not.
 * So: a filled dot in the colour of the answer, the name beside it in plain
 * type, and the one that failed carrying its own tint so the eye lands there
 * first.
 *
 * The one that was not asked — the site, when the check ran without one — is
 * left out entirely rather than shown as a blank or a dash. A row of three is
 * a row of three.
 */
export function Checks({ check, size = 'normal' }: { check: NetworkCheck; size?: 'normal' | 'small' }) {
  const parts: Array<{ name: string; ok: boolean }> = [
    { name: t('связь'), ok: check.online },
    { name: t('имена'), ok: check.dns },
    { name: t('интернет'), ok: check.internet }
  ]
  if (check.site !== null) parts.push({ name: t('сайт'), ok: check.site })

  return (
    <div className={`flex flex-wrap items-center ${size === 'small' ? 'gap-1' : 'gap-1.5'}`}>
      {parts.map((one) => (
        <span
          key={one.name}
          className={`flex shrink-0 items-center gap-1.5 rounded-pill ${
            size === 'small' ? 'h-[20px] px-2 text-2xs' : 'h-[24px] px-2.5 text-xs'
          }`}
          style={{
            // A tint rather than a fill: four solid colour patches in a row
            // would shout, and only one of them is ever news.
            background: one.ok
              ? 'color-mix(in srgb, var(--good) 12%, transparent)'
              : 'color-mix(in srgb, var(--bad) 14%, transparent)',
            color: one.ok ? 'var(--text-dim)' : 'var(--bad)'
          }}
        >
          <span
            className="shrink-0 rounded-pill"
            style={{
              width: 6,
              height: 6,
              background: one.ok ? 'var(--good)' : 'var(--bad)',
              // The failing one gets a halo, which is what makes it findable
              // in a glance rather than in a read.
              boxShadow: one.ok ? 'none' : '0 0 0 3px color-mix(in srgb, var(--bad) 22%, transparent)'
            }}
          />
          {one.name}
        </span>
      ))}
    </div>
  )
}
