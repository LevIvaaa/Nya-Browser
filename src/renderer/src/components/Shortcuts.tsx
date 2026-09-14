import { useEffect, useState } from 'react'
import { Row } from './ui'
import { t } from '../i18n'
import type { Settings } from '../../../shared/types'
import { SHORTCUT_COMMANDS, comboFor, comboOf, isCombo, prettyCombo } from '../../../shared/shortcuts'

/**
 * The key bindings, as rows you can change.
 *
 * Recording works by listening for the next keypress, which is why the window
 * is asked to stand down first: without that, pressing Ctrl+T to bind it would
 * open a tab instead of being heard.
 */
export function Shortcuts({
  shortcuts,
  onPatch
}: {
  shortcuts: Record<string, string>
  onPatch: (patch: Partial<Settings>) => void
}) {
  const [recording, setRecording] = useState<string | null>(null)
  const [taken, setTaken] = useState('')

  useEffect(() => {
    void window.browser.captureShortcut(recording !== null)
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        setTaken('')
        return
      }
      // Backspace is how a command is left without a key at all.
      if (event.key === 'Backspace' || event.key === 'Delete') {
        onPatch({ shortcuts: { ...shortcuts, [recording]: '' } })
        setRecording(null)
        setTaken('')
        return
      }
      const combo = comboOf({
        code: event.code,
        key: event.key,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      })
      // A bare letter is typing, not a shortcut: keep listening.
      if (!combo || !isCombo(combo)) return
      const clash = SHORTCUT_COMMANDS.find(
        (command) => command.id !== recording && comboFor(command.id, shortcuts) === combo
      )
      if (clash) {
        setTaken(clash.id)
        return
      }
      onPatch({ shortcuts: { ...shortcuts, [recording]: combo } })
      setRecording(null)
      setTaken('')
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void window.browser.captureShortcut(false)
    }
  }, [recording, shortcuts, onPatch])

  return (
    <>
      {SHORTCUT_COMMANDS.map((command) => {
        const combo = comboFor(command.id, shortcuts)
        const busy = recording === command.id
        const changed = Object.prototype.hasOwnProperty.call(shortcuts, command.id)
        return (
          <Row
            key={command.id}
            title={t(command.label)}
            hint={busy && taken ? t('Это сочетание уже занято') : undefined}
          >
            <button
              className="rounded-[9px] px-2.5 py-1.5 text-2xs font-semibold"
              style={{
                minWidth: 96,
                background: busy ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--field-idle)',
                color: busy ? 'var(--accent)' : changed ? 'var(--text)' : 'var(--text-dim)',
                boxShadow: busy ? 'inset 0 0 0 1px var(--accent)' : 'none',
                transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
              }}
              onClick={() => {
                setTaken('')
                setRecording(busy ? null : command.id)
              }}
            >
              {busy ? t('Нажмите сочетание') : prettyCombo(combo)}
            </button>
          </Row>
        )
      })}
    </>
  )
}
