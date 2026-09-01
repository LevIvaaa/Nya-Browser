import { useEffect, useMemo, useState } from 'react'
import type { Place, Weather, WeatherSettings } from '../../../shared/types'
import { Modal, TextField, cx } from './ui'

/* ------------------------------------------------------------- wmo codes */

/**
 * WMO weather codes, grouped the way a person would describe the sky. The
 * group decides both the wording and which animation runs.
 */
type Sky = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'storm'

function skyOf(code: number): Sky {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2) return 'cloudy'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 71 && code <= 77) return 'snow'
  if (code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'storm'
  return 'rain'
}

const WORDS: Record<number, string> = {
  0: 'Ясно',
  1: 'Малооблачно',
  2: 'Переменная облачность',
  3: 'Пасмурно',
  45: 'Туман',
  48: 'Изморозь',
  51: 'Морось',
  53: 'Морось',
  55: 'Сильная морось',
  56: 'Ледяная морось',
  57: 'Ледяная морось',
  61: 'Небольшой дождь',
  63: 'Дождь',
  65: 'Ливень',
  66: 'Ледяной дождь',
  67: 'Ледяной дождь',
  71: 'Небольшой снег',
  73: 'Снег',
  75: 'Сильный снег',
  77: 'Снежная крупа',
  80: 'Кратковременный дождь',
  81: 'Ливень',
  82: 'Сильный ливень',
  85: 'Снегопад',
  86: 'Сильный снегопад',
  95: 'Гроза',
  96: 'Гроза с градом',
  99: 'Гроза с градом'
}

const words = (code: number) => WORDS[code] ?? 'Погода'

const temp = (value: number, fahrenheit: boolean) =>
  fahrenheit ? `${Math.round(value * 1.8 + 32)}°` : `${value}°`

/* -------------------------------------------------------------- the art */

/**
 * The sky, drawn and animated in SVG. Everything moves on its own timeline so
 * the widget looks alive without anything driving it from React.
 */
function SkyArt({ sky, day, size = 64 }: { sky: Sky; day: boolean; size?: number }) {
  const sun = day ? '#FFC24B' : '#CBD5F5'
  const cloud = 'color-mix(in srgb, var(--ink) 22%, transparent)'

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      {(sky === 'clear' || sky === 'cloudy') &&
        (day ? (
          <g>
            <circle cx="26" cy="24" r="10" fill={sun} />
            <g stroke={sun} strokeWidth="2.4" strokeLinecap="round" opacity="0.85">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                <line key={angle} x1="26" y1="8" x2="26" y2="3" transform={`rotate(${angle} 26 24)`} />
              ))}
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 26 24"
                to="360 26 24"
                dur="40s"
                repeatCount="indefinite"
              />
            </g>
          </g>
        ) : (
          <path
            d="M34 14a12 12 0 1 0 12 15A13 13 0 0 1 34 14z"
            fill={sun}
            opacity="0.9"
          />
        ))}

      {sky !== 'clear' && (
        <g fill={cloud}>
          <g>
            <path d="M20 42a9 9 0 0 1 .6-17.9A13 13 0 0 1 45 27a8 8 0 0 1-.6 15z" />
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 4 -1.5; 0 0"
              dur="9s"
              repeatCount="indefinite"
            />
          </g>
          {(sky === 'overcast' || sky === 'storm') && (
            <g opacity="0.55">
              <path d="M12 48a7 7 0 0 1 .5-14 10 10 0 0 1 19 2 6 6 0 0 1-.5 12z" />
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0 0; -5 1; 0 0"
                dur="13s"
                repeatCount="indefinite"
              />
            </g>
          )}
        </g>
      )}

      {sky === 'fog' && (
        <g stroke={cloud} strokeWidth="3" strokeLinecap="round">
          {[46, 52, 58].map((y, i) => (
            <line key={y} x1="12" y1={y} x2="52" y2={y} opacity={0.8 - i * 0.2}>
              <animate
                attributeName="x1"
                values={`12; ${18 + i * 3}; 12`}
                dur={`${6 + i * 2}s`}
                repeatCount="indefinite"
              />
            </line>
          ))}
        </g>
      )}

      {(sky === 'rain' || sky === 'storm') && (
        <g stroke="#5FA8FF" strokeWidth="2.4" strokeLinecap="round">
          {[22, 32, 42].map((x, i) => (
            <line key={x} x1={x} y1="46" x2={x - 2} y2="52">
              <animate
                attributeName="opacity"
                values="0; 1; 0"
                dur="1.3s"
                begin={`${i * 0.35}s`}
                repeatCount="indefinite"
              />
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0 -4; 0 8"
                dur="1.3s"
                begin={`${i * 0.35}s`}
                repeatCount="indefinite"
              />
            </line>
          ))}
        </g>
      )}

      {sky === 'storm' && (
        <path d="M32 44l-6 9h5l-3 8 10-11h-5l4-6z" fill="#FFC24B">
          <animate attributeName="opacity" values="0.2; 1; 0.2" dur="2.4s" repeatCount="indefinite" />
        </path>
      )}

      {sky === 'snow' && (
        <g fill="#DCE9FF">
          {[22, 32, 42].map((x, i) => (
            <circle key={x} cx={x} cy="47" r="2.2">
              <animate
                attributeName="opacity"
                values="0; 1; 0"
                dur="2.6s"
                begin={`${i * 0.7}s`}
                repeatCount="indefinite"
              />
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0 -4; 2 9"
                dur="2.6s"
                begin={`${i * 0.7}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------ the widget */

export default function WeatherWidget({
  place,
  onPick
}: {
  place: WeatherSettings
  onPick: (place: WeatherSettings) => void
}) {
  const [data, setData] = useState<Weather | null>(null)
  const [picking, setPicking] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!place.place) return
    let alive = true
    const load = () =>
      void window.browser.weather(place.lat, place.lon).then((value) => {
        if (!alive) return
        setData(value)
        setFailed(value === null)
      })
    load()
    // The main process caches for fifteen minutes; asking every ten leaves the
    // widget fresh without turning it into a heartbeat.
    const timer = setInterval(load, 10 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [place.place, place.lat, place.lon])

  const sky = useMemo(() => (data ? skyOf(data.code) : 'clear'), [data])

  if (!place.place) {
    return (
      <>
        <button
          onClick={() => setPicking(true)}
          className="card flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center"
          style={{ transition: 'background var(--t-base) var(--ease-out)' }}
        >
          <SkyArt sky="clear" day size={40} />
          <span className="text-sm font-medium">Выберите город</span>
          <span className="text-2xs text-faint">Погода появится здесь</span>
        </button>
        {picking && <PlaceDialog place={place} onClose={() => setPicking(false)} onPick={onPick} />}
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => setPicking(true)}
        className="card flex h-full w-full flex-col justify-between overflow-hidden p-3 text-left"
        title="Сменить город"
      >
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-2xs font-semibold uppercase tracking-wider text-faint">
              {place.place}
            </div>
            <div className="mt-0.5 text-[30px] font-semibold leading-none tabular-nums tracking-[-0.03em]">
              {data ? temp(data.temperature, place.fahrenheit) : '—'}
            </div>
          </div>
          <SkyArt sky={sky} day={data?.day ?? true} size={54} />
        </div>

        <div className="w-full">
          <div className="truncate text-sm text-dim">
            {failed ? 'Нет связи с сервисом погоды' : data ? words(data.code) : 'Загружаем…'}
          </div>
          {data && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs tabular-nums text-faint">
              <span>
                {temp(data.low, place.fahrenheit)} … {temp(data.high, place.fahrenheit)}
              </span>
              <span>ощущается {temp(data.feels, place.fahrenheit)}</span>
              <span>ветер {data.wind} км/ч</span>
            </div>
          )}
        </div>

        {data && data.forecast.length > 0 && (
          <div className="mt-1.5 flex w-full items-end justify-between gap-1">
            {data.forecast.map((entry) => (
              <div key={entry.day} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <span className="text-2xs text-faint">
                  {new Date(entry.day).toLocaleDateString('ru-RU', { weekday: 'short' })}
                </span>
                <SkyArt sky={skyOf(entry.code)} day size={22} />
                <span className="text-2xs tabular-nums text-dim">
                  {temp(entry.high, place.fahrenheit)}
                </span>
              </div>
            ))}
          </div>
        )}
      </button>

      {picking && <PlaceDialog place={place} onClose={() => setPicking(false)} onPick={onPick} />}
    </>
  )
}

/* --------------------------------------------------------- pick a place */

function PlaceDialog({
  place,
  onClose,
  onPick
}: {
  place: WeatherSettings
  onClose: () => void
  onPick: (place: WeatherSettings) => void
}) {
  const [query, setQuery] = useState(place.place)
  const [results, setResults] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)

  // Typed letters are not sent one by one: the search waits for a pause.
  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      void window.browser.searchPlaces(text).then((found) => {
        setResults(found)
        setSearching(false)
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  const choose = (found: Place) => {
    onPick({
      // "Киев, Киев" helps nobody: a city that names its own region says it once.
      place: [found.name, found.region === found.name ? '' : found.region]
        .filter(Boolean)
        .join(', ')
        .slice(0, 80),
      lat: found.lat,
      lon: found.lon,
      fahrenheit: place.fahrenheit
    })
    onClose()
  }

  return (
    <Modal
      title="Погода"
      onClose={onClose}
      footer={
        <>
          {place.place && (
            <button
              className="btn mr-auto"
              onClick={() => {
                onPick({ ...place, place: '', lat: 0, lon: 0 })
                onClose()
              }}
            >
              Забыть город
            </button>
          )}
          <button
            className="btn"
            onClick={() => onPick({ ...place, fahrenheit: !place.fahrenheit })}
          >
            {place.fahrenheit ? 'Показывать °C' : 'Показывать °F'}
          </button>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">Город</span>
          <TextField value={query} onChange={setQuery} placeholder="Например, Киев" width="100%" autoFocus />
        </label>

        <div className="flex min-h-[120px] flex-col">
          {results.map((found) => (
            <button
              key={`${found.lat},${found.lon}`}
              onClick={() => choose(found)}
              className={cx(
                'flex items-baseline gap-2 rounded-[9px] px-2 py-2 text-left hover:bg-[var(--surface-hover)]'
              )}
              style={{ transition: 'background var(--t-fast) linear' }}
            >
              <span className="text-base text-ink">{found.name}</span>
              <span className="truncate text-sm text-faint">
                {[found.region, found.country].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-2 py-2 text-sm text-faint">
              {searching
                ? 'Ищем…'
                : query.trim().length < 2
                  ? 'Начните вводить название города'
                  : 'Ничего не нашлось'}
            </p>
          )}
        </div>

        <p className="text-2xs text-faint">
          Погода приходит с open-meteo.com. Запрос уходит только когда выбран город, без ключей и
          без вашего точного адреса — координаты округляются.
        </p>
      </div>
    </Modal>
  )
}
