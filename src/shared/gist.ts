/**
 * Making a long article shorter, and saying what it is about.
 *
 * Both of these are the same old idea — count the words that carry meaning,
 * then pick what uses them — and both are here rather than in the page so
 * they can be tested against real text. There is no model and no service:
 * every sentence in a summary is a sentence from the article, which is the
 * only reason a summary can be trusted at all.
 */

/**
 * The few sentences that carry the article.
 *
 * No model and no service: sentences are scored by the words they share with
 * the rest of the text, which is the old idea behind every extractive
 * summary, and the best three or four are shown in the order they were
 * written. It is not a rewrite and does not pretend to be — every line in it
 * is a line from the article, which is why it can be trusted at all.
 */
export function shorten(text: string, want = 4): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length < 400) return []
  // Sentence ends, in the two alphabets this browser is most often read in.
  const sentences = clean
    .split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ«"'(\d])/)
    .map((one) => one.trim())
    .filter((one) => one.length > 40 && one.length < 400)
  if (sentences.length < 6) return []

  // Words that carry meaning: the short ones are grammar in any language.
  const weigh = (one: string) =>
    one
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3)

  const seen = new Map<string, number>()
  for (const sentence of sentences) {
    for (const word of weigh(sentence)) seen.set(word, (seen.get(word) ?? 0) + 1)
  }
  // A word in every sentence says nothing; one in a handful says a lot.
  const total = sentences.length
  const scored = sentences.map((sentence, index) => {
    const bag = weigh(sentence)
    if (bag.length === 0) return { index, sentence, score: 0 }
    let score = 0
    for (const word of new Set(bag)) {
      const seenIn = seen.get(word) ?? 0
      if (seenIn <= 1 || seenIn > total * 0.6) continue
      score += seenIn
    }
    // Long sentences would win on volume alone.
    return { index, sentence, score: score / Math.sqrt(bag.length) }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, want)
    .sort((a, b) => a.index - b.index)
    .map((one) => one.sentence)
}

/**
 * The words this article is about, marked where they appear.
 *
 * The same counting as the summary, used differently: the dozen words that
 * do the most work get a quiet underline, so skimming a long piece for the
 * part you came for is looking rather than reading.
 */
export function keywords(text: string, want = 10): string[] {
  // Six letters, not five: "which", "there", "their" and their kind in every
  // language are exactly the words that would otherwise win, because they
  // are everywhere.
  const bag = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 5)
  if (bag.length < 80) return []
  const seen = new Map<string, number>()
  for (const word of bag) seen.set(word, (seen.get(word) ?? 0) + 1)
  return [...seen.entries()]
    // Often enough to be a subject, rare enough to be a particular one.
    /*
     * Often enough to be a subject, rare enough to be a particular one.
     *
     * The upper bound is a share of the text with a floor under it: two per
     * cent of a two-thousand-word article is forty, which is right, and two per
     * cent of a three-hundred-word one is six — below the three-time minimum,
     * so without the floor nothing on a short page would ever qualify.
     */
    .filter(([, n]) => n >= 3 && n <= Math.max(4, bag.length * 0.02))
    .sort((a, b) => b[1] - a[1])
    .slice(0, want)
    .map(([word]) => word)
}
