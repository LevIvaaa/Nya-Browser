/**
 * Making a password, and judging one.
 *
 * Shared so the same rules apply wherever a password is offered or looked at:
 * the generator in the vault page, the offer over a sign-up form, and the audit
 * that says which of the saved ones are worth changing.
 */

const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const MARKS = '!@#$%^&*-_=+?'

export interface PasswordShape {
  length: number
  digits: boolean
  marks: boolean
  /** letters that cannot be told apart are left out either way */
  upper: boolean
}

export const DEFAULT_SHAPE: PasswordShape = { length: 20, digits: true, marks: true, upper: true }

/**
 * A password nobody has to read out loud, so the letters that look alike —
 * l and 1, O and 0 — are simply not in the alphabet.
 */
export function makePassword(shape: Partial<PasswordShape> = {}, random?: (max: number) => number): string {
  const wanted = { ...DEFAULT_SHAPE, ...shape }
  const length = Math.min(64, Math.max(8, Math.round(wanted.length)))
  let alphabet = LOWER
  if (wanted.upper) alphabet += UPPER
  if (wanted.digits) alphabet += DIGITS
  if (wanted.marks) alphabet += MARKS
  const pick =
    random ??
    ((max: number) => {
      const buffer = new Uint32Array(1)
      // The browser and Node both have this; nothing here uses Math.random.
      crypto.getRandomValues(buffer)
      return buffer[0] % max
    })
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[pick(alphabet.length)]
  return out
}

export type PasswordVerdict = 'weak' | 'fair' | 'good'

/**
 * How much guessing it would take, roughly, said in three words.
 *
 * Deliberately crude: the point is to sort a list of saved passwords into the
 * ones worth changing tonight and the rest, not to put a number on anything.
 */
export function judge(password: string): PasswordVerdict {
  const length = password.length
  let kinds = 0
  if (/[a-z]/.test(password)) kinds += 1
  if (/[A-Z]/.test(password)) kinds += 1
  if (/[0-9]/.test(password)) kinds += 1
  if (/[^a-zA-Z0-9]/.test(password)) kinds += 1
  // A word with a number after it is the shape of most bad passwords.
  const plain = /^[a-zA-Z]+[0-9]{0,4}$/.test(password)
  if (length < 8 || plain || kinds < 2) return 'weak'
  if (length < 12 || kinds < 3) return 'fair'
  return 'good'
}
