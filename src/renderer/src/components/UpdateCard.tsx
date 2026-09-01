import type { UpdateState } from '../../../shared/types'
import logoUrl from '../assets/logo.png'
import { Popover } from './ui'

/** Megabytes, because that is the unit the answer is decided in. */
function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} МБ`
}

/**
 * The update notice, as a popover under its toolbar button.
 *
 * It appears by itself at the two moments that need an answer — a version was
 * found, and it has finished downloading — and never in between: the download
 * runs in the background and can be sent back to the toolbar button, which
 * keeps the progress in the corner of the eye instead of in the way.
 */
export default function UpdateCard({
  state,
  onClose
}: {
  state: UpdateState
  onClose: () => void
}) {
  const version = state.available ?? state.version

  const heading =
    state.stage === 'downloading'
      ? 'Загружаем обновление'
      : state.stage === 'ready'
        ? 'Обновление готово'
        : 'Доступно обновление'

  return (
    // Further in than a menu: this one arrives on its own, and a card flush
    // against the window edge reads as a system toast rather than as part of
    // the browser.
    <Popover onClose={onClose} inset={20}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-[11px]">
          <img src={logoUrl} alt="" className="h-[38px] w-[38px] shrink-0" />
          <div className="flex min-w-0 flex-col gap-[2px]">
            <div className="text-base font-semibold tracking-[-0.01em]">{heading}</div>
            <div className="flex items-center gap-1.5 text-xs tabular-nums text-faint">
              {state.stage === 'downloading' ? (
                <span>
                  Версия {version} · {state.percent}%
                </span>
              ) : (
                <>
                  <span>{state.version}</span>
                  <span aria-hidden>→</span>
                  <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                    {version}
                  </span>
                  {state.stage === 'ready' ? (
                    <span>· загружено</span>
                  ) : (
                    state.size > 0 && <span>· {megabytes(state.size)}</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {state.stage === 'downloading' && (
          <div
            className="relative h-[6px] overflow-hidden rounded-pill"
            style={{ background: 'var(--field)' }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-pill"
              style={{
                width: `${state.percent}%`,
                background: 'var(--accent)',
                transition: 'width var(--t-slow) var(--ease-out)'
              }}
            />
          </div>
        )}

        <div className="text-sm text-dim">
          {state.stage === 'downloading'
            ? 'Качаем в фоне — можно работать дальше. Скажем, когда будет готово.'
            : state.stage === 'ready'
              ? 'Браузер закроется, обновится и откроется снова. Вкладки восстановятся.'
              : 'Загрузить сейчас? Скачаем в фоне, работать не помешает.'}
        </div>

        <div className="flex gap-2">
          {state.stage === 'ready' ? (
            <button
              className="btn btn-primary flex-1"
              onClick={() => void window.browser.installUpdate()}
            >
              Обновить
            </button>
          ) : state.stage === 'downloading' ? (
            <button className="btn flex-1" onClick={onClose}>
              Скрыть
            </button>
          ) : (
            <button
              className="btn btn-primary flex-1"
              onClick={() => void window.browser.downloadUpdate()}
            >
              Загрузить
            </button>
          )}
          {state.stage !== 'downloading' && (
            <button className="btn" onClick={onClose}>
              Позже
            </button>
          )}
        </div>
      </div>
    </Popover>
  )
}
