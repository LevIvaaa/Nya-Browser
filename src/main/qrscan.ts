/**
 * QR-коды везде, где их видно глазом.
 *
 * Страница умеет прочитать код только из того, что лежит в ней картинкой или
 * холстом. А код бывает кадром видео, векторной картинкой, фоном блока,
 * содержимым чужого фрейма, нарисованным ячейками таблицы — и страница его не
 * видит, хотя человек видит.
 *
 * Поэтому второй способ смотрит туда же, куда человек: на отрисованную
 * страницу. Снимается видимая часть, расшифровывается в отдельном потоке
 * (qrworker.ts) и возвращается странице прямоугольниками в её собственных
 * координатах. Снимок не покидает этой машины и нигде не сохраняется.
 */
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { log } from './log'

export type ScreenCode = { text: string; x: number; y: number; w: number; h: number }

/**
 * Длинная сторона снимка, который уходит на расшифровку. Больше — дольше, а
 * код, который человек видит на экране, и на таком размере читается.
 */
const LONGEST = 1800

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (found: ScreenCode[]) => void>()

function settleAll() {
  for (const done of waiting.values()) done([])
  waiting.clear()
}

/** Поток заводится при первой нужде и живёт, пока не упадёт. */
function decoder(): Worker {
  if (worker) return worker
  const next = new Worker(join(__dirname, 'qrworker.js'))
  next.on('message', ({ id, found }: { id: number; found: ScreenCode[] }) => {
    const done = waiting.get(id)
    waiting.delete(id)
    done?.(found)
  })
  next.on('error', (error) => {
    log('qr: decoder failed —', String(error))
    worker = null
    settleAll()
  })
  next.on('exit', () => {
    worker = null
    settleAll()
  })
  // Поток не должен держать браузер открытым, когда его закрывают.
  next.unref()
  worker = next
  return next
}

/**
 * Коды на видимой части страницы, в координатах самой страницы.
 *
 * `view` — размер окна страницы в её пикселях: снимок сделан в пикселях
 * экрана, и масштаб страницы между ними пересчитывается здесь.
 */
export async function codesOnScreen(
  wc: WebContents,
  view: { width: number; height: number },
  areas: { x: number; y: number; w: number; h: number }[] = [],
  mode: 'frames' | 'areas' = 'areas'
): Promise<ScreenCode[]> {
  if (wc.isDestroyed() || view.width < 50 || view.height < 50) return []
  const shot = await wc.capturePage()
  if (shot.isEmpty()) return []

  // Снимок хранит своё разрешение под масштабом экрана. Приводим его к одному
  // представлению нужной ширины: тогда размер и байты точно сходятся.
  const factor = Math.max(1, ...shot.getScaleFactors())
  const real = shot.getSize(factor)
  const width = Math.min(LONGEST, real.width)
  const image = shot.resize({ width, quality: 'good' })
  const size = image.getSize()
  const bitmap = image.toBitmap()
  if (bitmap.length !== size.width * size.height * 4) return []

  const id = ++seq
  const found = await new Promise<ScreenCode[]>((done) => {
    waiting.set(id, done)
    // Своя копия байтов: её можно отдать потоку целиком, не копируя ещё раз.
    const data = new Uint8Array(bitmap).buffer as ArrayBuffer
    // Области приходят в пикселях страницы, а режется снимок в своих.
    const sx = size.width / view.width
    const sy = size.height / view.height
    const inImage = areas.map((a) => ({ x: a.x * sx, y: a.y * sy, w: a.w * sx, h: a.h * sy }))
    decoder().postMessage(
      { id, data, width: size.width, height: size.height, areas: inImage, mode },
      [data]
    )
    // Поток, который не ответил, не должен держать страницу в ожидании.
    setTimeout(() => {
      if (waiting.delete(id)) done([])
    }, 5000)
  })

  const kx = view.width / size.width
  const ky = view.height / size.height
  return found.map((code) => ({
    text: code.text.slice(0, 4096),
    x: code.x * kx,
    y: code.y * ky,
    w: code.w * kx,
    h: code.h * ky
  }))
}
