import { net } from 'electron'

/**
 * Asking whether a password is already in somebody's list of stolen ones,
 * without telling anybody the password.
 *
 * The trick is k-anonymity, and it is worth spelling out because it is the
 * only reason this is acceptable at all: the password is hashed here, only the
 * first five characters of that hash are sent, and the answer is every stolen
 * hash that begins with those five. Half a million passwords share a prefix.
 * The service learns that somebody, somewhere, has a password in a bucket of
 * half a million; it never learns which, and never sees the password.
 */
const ENDPOINT = 'https://api.pwnedpasswords.com/range/'

/** Suffixes of stolen hashes sharing this prefix, upper case, without counts. */
export async function stolenWithPrefix(prefix: string): Promise<Set<string>> {
  const out = new Set<string>()
  if (!/^[0-9A-F]{5}$/.test(prefix)) return out
  try {
    const response = await net.fetch(ENDPOINT + prefix, {
      headers: { 'add-padding': 'true', 'user-agent': 'Nya Browser' }
    })
    if (!response.ok) return out
    const text = await response.text()
    for (const line of text.split('\n')) {
      const suffix = line.split(':')[0]?.trim().toUpperCase()
      // Padding rows come back with a count of zero and mean nothing.
      const count = Number(line.split(':')[1] ?? '0')
      if (suffix && count > 0) out.add(suffix)
    }
  } catch {
    /* no network, no answer: the audit simply says nothing about leaks */
  }
  return out
}
