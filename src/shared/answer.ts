/**
 * Answering in the address bar.
 *
 * Some questions do not need a search engine: seventeen per cent of forty,
 * how many miles is ninety kilometres, what time it is in Tokyo. Typing them
 * into a search box and reading the answer off somebody's page is the long way
 * round, and it sends the question to a stranger.
 *
 * Everything here is worked out on this machine, from the typed text alone. No
 * network, no rates that need fetching — so currency is deliberately absent:
 * an exchange rate that is three weeks old is worse than no answer.
 */

export interface Answer {
  /** what to show, already formatted */
  text: string
  /** the question as understood, for the row underneath */
  about: string
  /** what this is, for the icon */
  kind: 'math' | 'units' | 'time'
}

/* ------------------------------------------------------------------- maths */

/**
 * An arithmetic expression, worked out.
 *
 * Its own tiny parser rather than anything that could run code: the input is
 * read as numbers and the six operators, and anything else stops it. A browser
 * that evaluated what was typed in its address bar would be a browser with a
 * remote code execution hole in its address bar.
 */
export function calculate(input: string): number | null {
  const text = input.replace(/\s+/g, '').replace(/,(\d)/g, '.$1').replace(/×/g, '*').replace(/÷/g, '/')
  if (!text || !/^[-+*/^().0-9%]+$/.test(text)) return null
  // Something has to make it an expression rather than a number or a date.
  if (!/[-+*/^%]/.test(text)) return null
  // Two separators or more is a version or a date, never a sum: 1.2.3 and
  // 12/03/2026 must go to the search engine, while 10/4 is arithmetic.
  if (/^\d+([./]\d+){2,}$/.test(text)) return null

  let at = 0
  const eat = (ch: string) => {
    if (text[at] === ch) {
      at += 1
      return true
    }
    return false
  }

  const number = (): number | null => {
    if (eat('(')) {
      const inside = sum()
      if (inside === null || !eat(')')) return null
      return inside
    }
    if (eat('-')) {
      const value = number()
      return value === null ? null : -value
    }
    const start = at
    while (at < text.length && /[0-9.]/.test(text[at])) at += 1
    if (at === start) return null
    const value = Number(text.slice(start, at))
    if (!Number.isFinite(value)) return null
    // A percentage, which in an address bar always means "of the thing before".
    return eat('%') ? value / 100 : value
  }

  const power = (): number | null => {
    const base = number()
    if (base === null) return null
    if (!eat('^')) return base
    const exponent = power()
    return exponent === null ? null : base ** exponent
  }

  const product = (): number | null => {
    let value = power()
    if (value === null) return null
    for (;;) {
      if (eat('*')) {
        const next = power()
        if (next === null) return null
        value *= next
      } else if (eat('/')) {
        const next = power()
        if (next === null || next === 0) return null
        value /= next
      } else {
        return value
      }
    }
  }

  function sum(): number | null {
    let value = product()
    if (value === null) return null
    for (;;) {
      if (eat('+')) {
        const next = product()
        if (next === null) return null
        // "40+17%" means forty plus seventeen per cent of forty, which is what
        // anybody typing it into a box means by it.
        value += next < 1 && /%/.test(text) ? value * next : next
      } else if (eat('-')) {
        const next = product()
        if (next === null) return null
        value -= next < 1 && /%/.test(text) ? value * next : next
      } else {
        return value
      }
    }
  }

  const result = sum()
  if (result === null || at !== text.length || !Number.isFinite(result)) return null
  return result
}

/* ------------------------------------------------------------------- units */

interface Unit {
  /** how many of the base unit one of these is */
  factor: number
  family: string
  /** how it is written in an answer, short and free of declension */
  short: string
  /** the same, for a question asked in Latin letters */
  latin: string
  names: string[]
}

/** The units people actually convert in a browser, and nothing else. */
const UNITS: Unit[] = [
  { family: 'length', factor: 0.001, short: 'мм', latin: 'mm', names: ['мм', 'mm', 'миллиметрах', 'миллиметр', 'миллиметра'] },
  { family: 'length', factor: 0.01, short: 'см', latin: 'cm', names: ['см', 'cm', 'сантиметрах', 'сантиметр', 'сантиметра'] },
  { family: 'length', factor: 1, short: 'м', latin: 'm', names: ['м', 'm', 'метр', 'метра', 'метров', 'метрах', 'meter', 'meters'] },
  { family: 'length', factor: 1000, short: 'км', latin: 'km', names: ['км', 'km', 'километр', 'километра', 'километров', 'километрах'] },
  { family: 'length', factor: 0.0254, short: 'дюйм.', latin: 'in', names: ['дюйм', 'дюйма', 'дюймов', 'дюймах', 'in', 'inch', 'inches'] },
  { family: 'length', factor: 0.3048, short: 'фут.', latin: 'ft', names: ['фут', 'фута', 'футов', 'футах', 'ft', 'foot', 'feet'] },
  { family: 'length', factor: 0.9144, short: 'ярд.', latin: 'yd', names: ['ярд', 'ярда', 'ярдов', 'ярдах', 'yd', 'yard', 'yards'] },
  { family: 'length', factor: 1609.344, short: 'миль', latin: 'mi', names: ['миля', 'мили', 'миль', 'милях', 'mi', 'mile', 'miles'] },
  { family: 'mass', factor: 0.001, short: 'г', latin: 'g', names: ['г', 'g', 'грамм', 'грамма', 'граммов', 'граммах', 'gram', 'grams'] },
  { family: 'mass', factor: 1, short: 'кг', latin: 'kg', names: ['кг', 'kg', 'килограмм', 'килограмма', 'килограммов', 'килограммах'] },
  { family: 'mass', factor: 1000, short: 'т', latin: 't', names: ['т', 't', 'тонна', 'тонны', 'тонн', 'тоннах', 'ton', 'tons'] },
  { family: 'mass', factor: 0.45359237, short: 'фунт.', latin: 'lb', names: ['фунт', 'фунта', 'фунтов', 'фунтах', 'lb', 'lbs', 'pound', 'pounds'] },
  { family: 'mass', factor: 0.0283495, short: 'унц.', latin: 'oz', names: ['унция', 'унции', 'унций', 'унциях', 'oz', 'ounce', 'ounces'] },
  { family: 'data', factor: 1, short: 'Б', latin: 'B', names: ['б', 'b', 'байт', 'байта', 'байтов', 'байтах', 'byte', 'bytes'] },
  { family: 'data', factor: 1024, short: 'КБ', latin: 'KB', names: ['кб', 'kb', 'kib'] },
  { family: 'data', factor: 1024 ** 2, short: 'МБ', latin: 'MB', names: ['мб', 'mb', 'mib'] },
  { family: 'data', factor: 1024 ** 3, short: 'ГБ', latin: 'GB', names: ['гб', 'gb', 'gib'] },
  { family: 'data', factor: 1024 ** 4, short: 'ТБ', latin: 'TB', names: ['тб', 'tb', 'tib'] },
  { family: 'speed', factor: 1, short: 'км/ч', latin: 'km/h', names: ['км/ч', 'kmh', 'km/h', 'кмч'] },
  { family: 'speed', factor: 1.609344, short: 'миль/ч', latin: 'mph', names: ['миль/ч', 'mph', 'mi/h'] },
  { family: 'speed', factor: 3.6, short: 'м/с', latin: 'm/s', names: ['м/с', 'm/s', 'мс'] }
]

const unitBy = (name: string): Unit | null => {
  const key = name.toLowerCase()
  return UNITS.find((unit) => unit.names.includes(key)) ?? null
}

/** Temperature is not a scale factor, so it gets its own answer. */
function temperature(value: number, from: string, to: string): number | null {
  const c = /^(c|с|°c|°с|цельс\w*|celsius)$/i
  const f = /^(f|ф|°f|fahrenheit|фаренгейт\w*)$/i
  const k = /^(k|кельвин\w*|kelvin)$/i
  const asC = c.test(from) ? value : f.test(from) ? ((value - 32) * 5) / 9 : k.test(from) ? value - 273.15 : null
  if (asC === null) return null
  if (c.test(to)) return asC
  if (f.test(to)) return (asC * 9) / 5 + 32
  if (k.test(to)) return asC + 273.15
  return null
}

/** How many digits an answer is worth, given how big it is. */
function tidy(value: number): string {
  const size = Math.abs(value)
  const digits = size >= 1000 ? 0 : size >= 100 ? 1 : size >= 1 ? 2 : 4
  return Number(value.toFixed(digits))
    .toString()
    .replace('.', ',')
}

/* ------------------------------------------------------------------- clock */

/** A handful of places people actually ask the time in, and their zones. */
const PLACES: Array<{ zone: string; names: string[] }> = [
  { zone: 'Europe/Moscow', names: ['москве', 'москва', 'moscow', 'мск'] },
  { zone: 'Europe/London', names: ['лондоне', 'лондон', 'london'] },
  { zone: 'Europe/Berlin', names: ['берлине', 'берлин', 'berlin'] },
  { zone: 'Europe/Paris', names: ['париже', 'париж', 'paris'] },
  { zone: 'Europe/Kyiv', names: ['киеве', 'киев', 'kyiv', 'kiev'] },
  { zone: 'Europe/Minsk', names: ['минске', 'минск', 'minsk'] },
  { zone: 'Asia/Almaty', names: ['алматы', 'almaty'] },
  { zone: 'Asia/Tokyo', names: ['токио', 'tokyo'] },
  { zone: 'Asia/Shanghai', names: ['пекине', 'пекин', 'beijing', 'shanghai', 'шанхае'] },
  { zone: 'Asia/Dubai', names: ['дубае', 'дубай', 'dubai'] },
  { zone: 'Asia/Istanbul', names: ['стамбуле', 'стамбул', 'istanbul'] },
  { zone: 'Asia/Novosibirsk', names: ['новосибирске', 'новосибирск'] },
  { zone: 'Asia/Vladivostok', names: ['владивостоке', 'владивосток'] },
  { zone: 'Asia/Yekaterinburg', names: ['екатеринбурге', 'екатеринбург'] },
  { zone: 'America/New_York', names: ['нью-йорке', 'нью-йорк', 'new york', 'newyork'] },
  { zone: 'America/Los_Angeles', names: ['лос-анджелесе', 'лос-анджелес', 'los angeles'] },
  { zone: 'Australia/Sydney', names: ['сиднее', 'сидней', 'sydney'] }
]

/* ------------------------------------------------------------------ the lot */

/**
 * What the typed text answers, if it answers anything.
 *
 * Deliberately quiet: anything that does not clearly parse gets no answer at
 * all, because a wrong answer above the search results is worse than none.
 */
export function answer(input: string, now = new Date()): Answer | null {
  const text = input.trim()
  if (!text || text.length > 120) return null

  // Maths.
  const sum = calculate(text)
  if (sum !== null) {
    return { text: tidy(sum), about: text, kind: 'math' }
  }

  // Per cent of something: "25% от 800", "17 % of 40".
  const share = /^([\d.,]+)\s*%\s*(?:от|of)\s+([\d\s.,]+)$/u.exec(text)
  if (share) {
    const part = Number(share[1].replace(',', '.'))
    const whole = Number(share[2].replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(part) && Number.isFinite(whole)) {
      return { text: tidy((part / 100) * whole), about: text, kind: 'math' }
    }
  }

  // Units: "90 км в милях", "90 km to miles", "18 c to f".
  const convert =
    /^([-+]?[\d\s.,]+)\s*([^\s\d]+(?:\/[^\s\d]+)?)\s*(?:в|во|to|in|→|=)\s*([^\s\d]+(?:\/[^\s\d]+)?)$/iu.exec(text)
  if (convert) {
    const value = Number(convert[1].replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(value)) {
      const degrees = temperature(value, convert[2], convert[3])
      if (degrees !== null) {
        return { text: `${tidy(degrees)}°`, about: text, kind: 'units' }
      }
      const from = unitBy(convert[2])
      const to = unitBy(convert[3])
      if (from && to && from.family === to.family) {
        // The unit is written back in the alphabet the question was asked in,
        // and in a short form that does not decline: «55,92 миль», never the
        // «55,92 милях» that came of echoing whatever word was typed.
        const word = /^[a-z0-9/.]+$/i.test(convert[3]) ? to.latin : to.short
        return {
          text: `${tidy((value * from.factor) / to.factor)} ${word}`,
          about: text,
          kind: 'units'
        }
      }
    }
  }

  // The time somewhere: "время в токио", "time in tokyo".
  const clock = /^(?:сколько\s+времени|который\s+час|время|time)\s+(?:в|во|in)\s+(.+)$/iu.exec(text)
  if (clock) {
    const wanted = clock[1].trim().toLowerCase()
    const place = PLACES.find((one) => one.names.includes(wanted))
    if (place) {
      try {
        const shown = new Intl.DateTimeFormat(undefined, {
          timeZone: place.zone,
          hour: '2-digit',
          minute: '2-digit',
          weekday: 'short'
        }).format(now)
        return { text: shown, about: place.zone.replace('_', ' '), kind: 'time' }
      } catch {
        return null
      }
    }
  }

  return null
}
