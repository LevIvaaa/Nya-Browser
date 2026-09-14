import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { Check, Copy, Translate } from './Icons'
import { Modal } from './ui'

/**
 * The words that were in a picture.
 *
 * A screenshot of an error message, a photographed page, a price on a poster:
 * the text is right there and completely unusable. This puts it where text
 * belongs — selectable, copyable, and translatable in one more click, since
 * half the reason for reading a picture is that it is in another language.
 */
export default function PictureText({ text, onClose }: { text: string; onClose: () => void }) {
  const [shown, setShown] = useState(text)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [translated, setTranslated] = useState(false)

  useEffect(() => {
    setShown(text)
    setTranslated(false)
  }, [text])

  return (
    <Modal
      title={t('Текст с картинки')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            className="btn mr-auto"
            disabled={busy}
            onClick={async () => {
              if (translated) {
                setShown(text)
                setTranslated(false)
                return
              }
              setBusy(true)
              const lines = text.split('\n')
              const said = await window.browser.translateLines(lines)
              setBusy(false)
              if (said.length > 0) {
                setShown(said.join('\n'))
                setTranslated(true)
              }
            }}
          >
            <Translate width={14} height={14} />
            {translated ? t('Показать оригинал') : t('Перевести')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('Закрыть')}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await window.browser.copyText(shown)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            }}
          >
            {copied ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
            {t('Копировать')}
          </button>
        </>
      }
    >
      <textarea
        value={shown}
        readOnly
        rows={Math.min(16, Math.max(4, shown.split('\n').length + 1))}
        className="field focus-ring w-full resize-none text-sm"
        style={{ lineHeight: 1.5, height: 'auto' }}
      />
    </Modal>
  )
}
