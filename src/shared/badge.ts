/**
 * The number a page keeps in front of its own title.
 *
 * Mail, chats and build servers all do the same thing: "(3) Inbox",
 * "[2] #general", "3 • Pull requests". Reading it means a tab can show what it
 * is holding without the page knowing anything about this browser, and without
 * a permission, an API or a single request.
 *
 * Deliberately narrow. A year, a price, a version and a date all start with
 * digits too, and a badge that lights up for "2026 in review" is worse than no
 * badge at all — so the count has to be wrapped or followed by one of the few
 * marks these sites actually use.
 */
export function badgeOf(title: string): number {
  const found = /^\s*[([{]?\s*(\d{1,4})\s*[)\]}•·]/.exec(title)
  const n = found ? Number(found[1]) : 0
  return Number.isFinite(n) && n > 0 && n < 10000 ? n : 0
}
