import { t } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PrintOptions } from '../../../shared/types'
import { ChevronRight, Printer } from './Icons'

/**
 * The browser's own print dialog.
 *
 * Electron's does not open — measured on both shapes of window this browser
 * could use, with a callback that is never called and no error either way. What
 * does work is asking Windows which printers exist, printing to one of them
 * without a dialog, and making the PDF ourselves. So the questions are asked
 * here instead, and the answers drive both halves at once.
 *
 * The preview is not a picture of the window: it is the PDF the printer will be
 * handed, from the same options, drawn with the PDF.js already here for the
 * document viewer. Where the pages break on screen is where they break on
 * paper — including what the margins, the paper size and the scale do to them.
 */

const PAPERS: Array<{ id: PrintOptions['paper']; label: string }> = [
  { id: 'A4', label: 'A4' },
  { id: 'A3', label: 'A3' },
  { id: 'A5', label: 'A5' },
  { id: 'Letter', label: 'Letter' },
  { id: 'Legal', label: 'Legal' },
  { id: 'Tabloid', label: 'Tabloid' }
]

/** The destination that is a file rather than a printer. */
const PDF_TARGET = ' pdf'

export default function PrintSheet({ onClose }: { onClose: () => void }) {
  const [printers, setPrinters] = useState<
    Array<{ name: string; description: string; isDefault: boolean }> | null
  >(null)
  const [target, setTarget] = useState(PDF_TARGET)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<PrintOptions>({
    landscape: false,
    paper: 'A4',
    margins: 'default',
    scale: 100,
    background: true,
    headers: false,
    pages: '',
    copies: 1,
    colour: true,
    duplex: false
  })
  const set = (patch: Partial<PrintOptions>) => setOptions((old) => ({ ...old, ...patch }))

  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [failed, setFailed] = useState(false)
  const [drawing, setDrawing] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const doc = useRef<{ numPages: number; getPage: (n: number) => Promise<PdfPage> } | null>(null)

  useEffect(() => {
    void window.browser.printers().then((list) => {
      setPrinters(list)
      const preferred = list.find((printer) => printer.isDefault) ?? list[0]
      if (preferred) setTarget(preferred.name)
    })
  }, [])

  /** Only what the PDF is made from; copies and duplex change nothing on screen. */
  const shape = useMemo(
    () =>
      JSON.stringify({
        landscape: options.landscape,
        paper: options.paper,
        margins: options.margins,
        scale: options.scale,
        background: options.background,
        headers: options.headers,
        pages: options.pages
      }),
    [options]
  )

  // Remade whenever one of those changes, a moment after the last keystroke, so
  // that typing a page range does not render the document six times over.
  useEffect(() => {
    let dropped = false
    const timer = setTimeout(() => {
      void (async () => {
        setDrawing(true)
        setFailed(false)
        const bytes = await window.browser.printPreview(options)
        if (dropped) return
        if (!bytes) {
          setDrawing(false)
          return setFailed(true)
        }
        try {
          const [pdfjs, worker] = await Promise.all([
            import('pdfjs-dist'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url')
          ])
          // PDF.js wants a worker even for three pages; the bundler emits one
          // beside the interface and this points at it.
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default
          const loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
          if (dropped) return
          doc.current = loaded as unknown as typeof doc.current
          setPages(loaded.numPages)
          setPage((current) => Math.min(current, loaded.numPages))
        } catch (error) {
          console.error('print preview', error)
          if (!dropped) setFailed(true)
        } finally {
          if (!dropped) setDrawing(false)
        }
      })()
    }, 260)
    return () => {
      dropped = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape])

  // Draw whichever page is being looked at.
  useEffect(() => {
    let dropped = false
    void (async () => {
      const loaded = doc.current
      const sheet = canvas.current
      if (!loaded || !sheet || pages === 0) return
      const shown = await loaded.getPage(Math.min(page, pages))
      if (dropped) return
      const base = shown.getViewport({ scale: 1 })
      const fit = Math.min(340 / base.width, 460 / base.height)
      const viewport = shown.getViewport({ scale: fit * window.devicePixelRatio })
      sheet.width = Math.round(viewport.width)
      sheet.height = Math.round(viewport.height)
      sheet.style.width = `${Math.round(viewport.width / window.devicePixelRatio)}px`
      sheet.style.height = `${Math.round(viewport.height / window.devicePixelRatio)}px`
      const context = sheet.getContext('2d')
      if (!context) return
      context.fillStyle = '#fff'
      context.fillRect(0, 0, sheet.width, sheet.height)
      await shown.render({ canvas: sheet, canvasContext: context, viewport }).promise
    })()
    return () => {
      dropped = true
    }
  }, [page, pages, drawing])

  const toPdf = target === PDF_TARGET

  const field = (label: string, control: React.ReactNode) => (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-2xs uppercase tracking-wider text-faint">{label}</span>
      {control}
    </label>
  )

  const check = (label: string, on: boolean, onChange: (next: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-dim">
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center" onClick={onClose}>
      <div
        className="animate-fade absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg) 45%, transparent)' }}
      />
      <div
        className="animate-sheet relative mt-[30px] flex max-h-[calc(100vh-60px)] w-[min(820px,95vw)] gap-5 rounded-card p-5"
        style={{
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* ------------------------------------------------------- settings */}
        <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto pr-1">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Printer width={15} height={15} />
            </span>
            <span className="text-base font-semibold text-ink">{t('Печать')}</span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {field(
              t('Принтер'),
              <select
                className="field h-[36px] w-full text-sm"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value={PDF_TARGET}>{t('Сохранить как PDF')}</option>
                {(printers ?? []).map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.description || printer.name}
                  </option>
                ))}
              </select>
            )}

            <div className="flex gap-3">
              {field(
                t('Копии'),
                <input
                  className="field h-[36px] w-full text-sm tabular-nums"
                  value={options.copies}
                  onChange={(event) =>
                    set({
                      copies: Math.max(
                        1,
                        Math.min(50, Number(event.target.value.replace(/\D/g, '')) || 1)
                      )
                    })
                  }
                />
              )}
              {field(
                t('Страницы'),
                <input
                  className="field h-[36px] w-full text-sm"
                  placeholder={t('все')}
                  value={options.pages}
                  onChange={(event) => set({ pages: event.target.value.replace(/[^\d,\-\s]/g, '') })}
                />
              )}
            </div>

            {field(
              t('Ориентация'),
              <div className="flex gap-1.5">
                {[
                  { id: false, label: t('Книжная') },
                  { id: true, label: t('Альбомная') }
                ].map((item) => (
                  <button
                    key={String(item.id)}
                    className="h-[34px] flex-1 rounded-[9px] text-sm"
                    style={
                      options.landscape === item.id
                        ? { background: 'var(--accent)', color: '#fff' }
                        : { background: 'var(--field-idle)', color: 'var(--text-dim)' }
                    }
                    onClick={() => set({ landscape: item.id })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              {field(
                t('Размер'),
                <select
                  className="field h-[36px] w-full text-sm"
                  value={options.paper}
                  onChange={(event) => set({ paper: event.target.value as PrintOptions['paper'] })}
                >
                  {PAPERS.map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {paper.label}
                    </option>
                  ))}
                </select>
              )}
              {field(
                t('Поля'),
                <select
                  className="field h-[36px] w-full text-sm"
                  value={options.margins}
                  onChange={(event) =>
                    set({ margins: event.target.value as PrintOptions['margins'] })
                  }
                >
                  <option value="default">{t('Обычные')}</option>
                  <option value="narrow">{t('Узкие')}</option>
                  <option value="none">{t('Без полей')}</option>
                </select>
              )}
            </div>

            {field(
              t('Масштаб'),
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={25}
                  max={200}
                  step={5}
                  value={options.scale}
                  onChange={(event) => set({ scale: Number(event.target.value) })}
                  className="flex-1"
                />
                <span className="w-[46px] text-right text-sm tabular-nums text-dim">
                  {options.scale}%
                </span>
              </div>
            )}

            <div className="mt-1">
              {check(t('Печатать фон'), options.background, (background) => set({ background }))}
              {check(t('Колонтитулы'), options.headers, (headers) => set({ headers }))}
              {!toPdf && check(t('Цветная'), options.colour, (colour) => set({ colour }))}
              {!toPdf && check(t('Двусторонняя'), options.duplex, (duplex) => set({ duplex }))}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 pt-1">
            <button className="btn" onClick={onClose} disabled={busy}>
              {t('Отмена')}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || (!toPdf && !target)}
              onClick={async () => {
                setBusy(true)
                if (toPdf) await window.browser.printPdf(options)
                else await window.browser.printTo(target, options)
                setBusy(false)
                onClose()
              }}
            >
              {toPdf ? t('Сохранить') : t('Печать')}
            </button>
          </div>
        </div>

        {/* -------------------------------------------------------- preview */}
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div
            className="flex w-full flex-1 items-center justify-center rounded-[14px] p-3"
            style={{ background: 'var(--field-idle)', minHeight: 470 }}
          >
            {failed ? (
              <span className="text-sm text-faint">{t('Предпросмотр недоступен')}</span>
            ) : pages === 0 ? (
              <span className="text-sm text-faint">{t('Готовим предпросмотр…')}</span>
            ) : (
              <canvas
                ref={canvas}
                className="rounded-[6px]"
                style={{
                  boxShadow: 'var(--shadow-md)',
                  opacity: drawing ? 0.55 : 1,
                  transition: 'opacity var(--t-base) linear'
                }}
              />
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-dim">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[var(--surface-hover)] disabled:opacity-30"
              disabled={page <= 1}
              onClick={() => setPage((n) => Math.max(1, n - 1))}
              aria-label={t('Предыдущая страница')}
            >
              <span style={{ transform: 'rotate(180deg)' }}>
                <ChevronRight width={13} height={13} />
              </span>
            </button>
            <span className="tabular-nums">{pages === 0 ? '—' : `${page} / ${pages}`}</span>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[var(--surface-hover)] disabled:opacity-30"
              disabled={page >= pages}
              onClick={() => setPage((n) => Math.min(pages, n + 1))}
              aria-label={t('Следующая страница')}
            >
              <ChevronRight width={13} height={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The little of a PDF.js page this file uses. */
interface PdfPage {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: {
    canvas: HTMLCanvasElement
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
  }) => { promise: Promise<void> }
}
