/**
 * Chromium's number, said in words.
 *
 * `ERR_NAME_NOT_RESOLVED` tells a developer everything and a person nothing.
 * Every line here is written so that the next thing to try is contained in it,
 * and a code with no line falls through to whatever Chromium itself said —
 * still better than silence.
 *
 * It lives in shared because two places need exactly the same sentence: the
 * error page a failed tab shows, and the failure log the diagnostics page
 * reads. Two tables would have drifted apart by the second release, and the
 * second copy would have needed translating into sixty-four languages to say
 * what the first one already says.
 */
export const NET_HINTS: Record<number, string> = {
  [-2]: 'Не удалось обработать ответ сервера.',
  [-6]: 'Файл не найден.',
  [-7]: 'Сервер слишком долго не отвечает.',
  [-21]: 'Сеть изменилась во время загрузки.',
  [-100]: 'Соединение закрыто сервером.',
  [-101]: 'Соединение сброшено.',
  [-102]: 'Сервер отказался от соединения.',
  [-104]: 'Сервер отказался от соединения.',
  [-105]: 'Не удалось найти адрес — проверьте имя сайта.',
  [-106]: 'Нет подключения к интернету.',
  [-107]: 'Ошибка защищённого соединения (TLS).',
  [-109]: 'Сервер отказался от соединения.',
  [-118]: 'Время ожидания соединения истекло.',
  [-130]: 'Прокси-сервер не отвечает.',
  [-131]: 'Прокси-сервер не отвечает.',
  [-137]: 'Не удалось найти адрес — проверьте имя сайта.',
  [-200]: 'Сертификат сайта выдан на другое имя.',
  [-201]: 'Срок действия сертификата истёк.',
  [-202]: 'Сертификат выдан недоверенным центром.',
  [-207]: 'Сертификат выдан недоверенным центром.',
  [-324]: 'Соединение закрыто сервером.',
  [-348]: 'Не удалось обработать ответ сервера.',
  [-501]: 'Ответ сервера небезопасен.'
}

/**
 * The shortest true sentence about what is wrong, in the order somebody would
 * work it out for themselves.
 *
 * Kept apart from the checking so it can be reasoned about on its own: every
 * combination of four booleans has exactly one right answer here, and
 * tests/health.mjs is where that is written down.
 */
export type Verdict = 'offline' | 'no-internet' | 'no-dns' | 'site-down' | 'fine'

export function verdictOf(
  online: boolean,
  dns: boolean,
  internet: boolean,
  site: boolean | null
): Verdict {
  // The machine's own idea of whether it has a link comes first: no link means
  // every other answer below would be a guess dressed up as a finding.
  if (!online) return 'offline'
  // Nothing at all got out. Naming DNS here would be wrong — a name that
  // cannot be looked up because nothing leaves the machine is a symptom.
  if (!internet && !dns) return 'no-internet'
  // Something got out, but names do not turn into numbers.
  if (!dns) return 'no-dns'
  if (site === false) return 'site-down'
  return 'fine'
}
