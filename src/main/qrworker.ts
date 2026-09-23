/**
 * Расшифровка QR-кодов на снимке страницы — в отдельном потоке.
 *
 * Снимок видимой части страницы — это пара миллионов точек, и jsQR проходит
 * их за десятую-другую долю секунды. В главном процессе это была бы десятая
 * доля секунды, на которую замирает весь браузер: вкладки, прокрутка, ввод.
 * Здесь замирает только этот поток, и никто этого не видит.
 *
 * jsQR сделан для кадра с камеры, где код один. На странице их бывает
 * несколько, и тогда он собирает угловые метки от разных кодов и не читает ни
 * одного — на целом снимке с тремя кодами он не находил ничего. Поэтому снимок
 * режется на перекрывающиеся плитки: в плитке кода одного размера помещается
 * ровно один, а перекрытие не даёт коду попасть на шов.
 */
import { parentPort } from 'node:worker_threads'
import jsQR from 'jsqr'

type Area = { x: number; y: number; w: number; h: number }
type Ask = {
  id: number
  data: ArrayBuffer
  width: number
  height: number
  /** Где искать в первую очередь. */
  areas?: Area[]
  /**
   * `frames` — кадры идущих видео: одним уменьшенным проходом.
   * `areas` — элементы, похожие на код: каждый отдельно, потом весь экран.
   */
  mode?: 'frames' | 'areas'
}
type Found = { text: string; x: number; y: number; w: number; h: number }

/**
 * Размеры плиток: под обычный код на странице и под крупный. Мелкая плитка
 * подстраивается под окно — в узком окне коды стоят теснее, и плитка в
 * 640 точек захватывала бы сразу два.
 */
const tilesFor = (long: number) => [Math.min(640, Math.max(380, Math.round(long / 2.2))), 1280]

parentPort?.on('message', ({ id, data, width, height, areas, mode }: Ask) => {
  const found: Found[] = []
  try {
    const pixels = new Uint8ClampedArray(data)
    // Снимок приходит в порядке BGRA, а jsQR ждёт RGBA. Для чёрно-белого
    // кода разница невелика, но цветные коды на цветном фоне читаются хуже,
    // если яркость считать не по тем каналам.
    for (let i = 0; i < pixels.length; i += 4) {
      const blue = pixels[i]
      pixels[i] = pixels[i + 2]
      pixels[i + 2] = blue
    }

    let tile = new Uint8ClampedArray(0)

    /** Один проход jsQR по прямоугольнику снимка. */
    const scan = (x0: number, y0: number, w: number, h: number) => {
      x0 = Math.max(0, Math.floor(x0))
      y0 = Math.max(0, Math.floor(y0))
      w = Math.min(width - x0, Math.floor(w))
      h = Math.min(height - y0, Math.floor(h))
      if (w < 40 || h < 40) return
      if (tile.length < w * h * 4) tile = new Uint8ClampedArray(w * h * 4)
      const view = tile.subarray(0, w * h * 4)
      for (let y = 0; y < h; y++) {
        const from = ((y0 + y) * width + x0) * 4
        view.set(pixels.subarray(from, from + w * 4), y * w * 4)
      }
      const code = jsQR(view, w, h, { inversionAttempts: 'attemptBoth' })
      if (!code || !code.data) return
      const { topLeftCorner: a, topRightCorner: b, bottomLeftCorner: c, bottomRightCorner: d } =
        code.location
      const left = x0 + Math.min(a.x, b.x, c.x, d.x)
      const top = y0 + Math.min(a.y, b.y, c.y, d.y)
      const right = x0 + Math.max(a.x, b.x, c.x, d.x)
      const bottom = y0 + Math.max(a.y, b.y, c.y, d.y)
      // Один и тот же код находится в нескольких перекрывающихся плитках.
      const cx = (left + right) / 2
      const cy = (top + bottom) / 2
      const twin = found.find(
        (one) =>
          one.text === code.data &&
          Math.abs(one.x + one.w / 2 - cx) < (right - left) / 2 &&
          Math.abs(one.y + one.h / 2 - cy) < (bottom - top) / 2
      )
      if (!twin) found.push({ text: code.data, x: left, y: top, w: right - left, h: bottom - top })

      // Найденный код закрашивается на самом снимке. Иначе соседняя плитка,
      // куда попал его край с угловой меткой, собирала бы метки от двух
      // кодов сразу и не читала ни одного.
      const pad = Math.max(6, (right - left) * 0.1)
      const mx0 = Math.max(0, Math.floor(left - pad))
      const my0 = Math.max(0, Math.floor(top - pad))
      const mx1 = Math.min(width, Math.ceil(right + pad))
      const my1 = Math.min(height, Math.ceil(bottom + pad))
      for (let y = my0; y < my1; y++) pixels.fill(255, (y * width + mx0) * 4, (y * width + mx1) * 4)
    }

    /**
     * Прямоугольник целиком, потом плитками.
     *
     * Целиком — потому что один код на экране встречается чаще всего и
     * читается одним проходом. Плитками — потому что двух кодов в одном
     * проходе jsQR не прочтёт. Найденное целиком уже закрашено, и плитки его
     * второй раз не найдут.
     */
    const region = (x: number, y: number, w: number, h: number) => {
      const long = Math.max(w, h)
      if (long <= 1400) scan(x, y, w, h)
      if (long <= tilesFor(long)[0]) return
      for (const size of tilesFor(long)) {
        if (size > Math.max(w, h) * 1.2) continue
        const step = size / 2
        for (let ty = y; ty < y + h; ty += step) {
          for (let tx = x; tx < x + w; tx += step) {
            // Последняя плитка в ряду прижимается к краю, а не выходит за него.
            const sx = Math.min(tx, x + w - size)
            const sy = Math.min(ty, y + h - size)
            scan(sx, sy, size, size)
            if (tx + size >= x + w) break
          }
          if (ty + size >= y + h) break
        }
      }
    }

    /**
     * Кадр видео — одним проходом, уменьшенный до разумного размера.
     *
     * Кадр смотрят раз в секунду, пока идёт ролик, и резать его на плитки
     * каждый раз — это полсекунды работы каждую секунду. Код, который
     * показывают в ролике, крупный: его делают для телефона, поднесённого к
     * экрану с дивана, и уменьшение он переносит. Мелкие коды в кадре найдёт
     * полный просмотр — он случается на паузе и после перемотки.
     */
    const frame = (x0: number, y0: number, w: number, h: number) => {
      x0 = Math.max(0, Math.floor(x0))
      y0 = Math.max(0, Math.floor(y0))
      w = Math.min(width - x0, Math.floor(w))
      h = Math.min(height - y0, Math.floor(h))
      if (w < 40 || h < 40) return
      const f = Math.min(1, 960 / Math.max(w, h))
      if (f === 1) return scan(x0, y0, w, h)

      // Уменьшение усреднением: каждая новая точка — среднее тех, что под
      // ней. Так мелкие клетки кода не пропадают, а сливаются в серое.
      const tw = Math.max(1, Math.round(w * f))
      const th = Math.max(1, Math.round(h * f))
      const small = new Uint8ClampedArray(tw * th * 4)
      const step = 1 / f
      for (let ty = 0; ty < th; ty++) {
        const sy0 = y0 + Math.floor(ty * step)
        const sy1 = Math.max(sy0 + 1, Math.min(y0 + h, y0 + Math.floor((ty + 1) * step)))
        for (let tx = 0; tx < tw; tx++) {
          const sx0 = x0 + Math.floor(tx * step)
          const sx1 = Math.max(sx0 + 1, Math.min(x0 + w, x0 + Math.floor((tx + 1) * step)))
          let r = 0
          let g = 0
          let b = 0
          let n = 0
          for (let sy = sy0; sy < sy1; sy++) {
            for (let sx = sx0; sx < sx1; sx++) {
              const i = (sy * width + sx) * 4
              r += pixels[i]
              g += pixels[i + 1]
              b += pixels[i + 2]
              n++
            }
          }
          const o = (ty * tw + tx) * 4
          small[o] = r / n
          small[o + 1] = g / n
          small[o + 2] = b / n
          small[o + 3] = 255
        }
      }
      const code = jsQR(small, tw, th, { inversionAttempts: 'attemptBoth' })
      if (!code || !code.data) return
      const { topLeftCorner: a, topRightCorner: b, bottomLeftCorner: c, bottomRightCorner: d } =
        code.location
      const left = x0 + Math.min(a.x, b.x, c.x, d.x) / f
      const top = y0 + Math.min(a.y, b.y, c.y, d.y) / f
      const right = x0 + Math.max(a.x, b.x, c.x, d.x) / f
      const bottom = y0 + Math.max(a.y, b.y, c.y, d.y) / f
      found.push({ text: code.data, x: left, y: top, w: right - left, h: bottom - top })
    }

    if (mode === 'frames') {
      for (const area of (areas ?? []).slice(0, 6)) frame(area.x, area.y, area.w, area.h)
    } else {
      // Сначала — то, что страница сама считает похожим на код: векторный
      // рисунок, фон блока, фрейм, холст. Каждый отдельно, с полем вокруг,
      // чтобы тихая зона кода не срезалась. Плотную сетку из четырёх кодов
      // слепая нарезка не читает — в любую плитку попадают сразу несколько.
      for (const area of (areas ?? []).slice(0, 24)) {
        const pad = Math.max(10, Math.min(area.w, area.h) * 0.08)
        const x = area.x - pad
        const y = area.y - pad
        const w = area.w + pad * 2
        const h = area.h + pad * 2
        if (Math.max(w, h) > 1400) region(x, y, w, h)
        else scan(x, y, w, h)
      }
      // Потом весь экран — для кодов, которых в разметке не видно вовсе:
      // собранных из ячеек, нарисованных внутри чужого холста. Найденное выше
      // уже закрашено и второй раз не мешает.
      region(0, 0, width, height)
    }
  } catch {
    /* испорченный снимок — значит, кодов на нём нет */
  }
  parentPort?.postMessage({ id, found: found.slice(0, 8) })
})
