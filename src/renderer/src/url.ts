/**
 * Addresses, as they are read rather than as they are sent.
 *
 * A Russian Wikipedia link is two thirds percent-escapes on the wire, and a
 * list of them is a wall of `%D0%97%D0%B0` where the titles should be. Every
 * place in the browser that shows an address to a person shows it through
 * here; what is opened, copied or stored is always the original.
 */
export function readable(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    // A malformed escape is left exactly as it came: a half-decoded address
    // would be a different address.
    return url
  }
}

/** The host on its own, without the www. that nobody reads. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
