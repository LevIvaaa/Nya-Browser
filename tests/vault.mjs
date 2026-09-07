// Which hosts count as the same site — run with `npm test`.
//
// This decides when a saved password is offered on a page. Too strict and a
// password saved on accounts.example.com is useless on mail.example.com; too
// loose and one co.uk site is offered a credential saved on another. The loose
// direction is the one that matters, so most of what is here is about refusing
// to share.

import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(mkdtempSync(join(tmpdir(), 'nya-vault-')), 'vault.mjs')

await build({
  entryPoints: [join(here, '..', 'src', 'main', 'vault.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: join(here, 'electron-stub.mjs') },
  outfile: out,
  logLevel: 'error'
})

const { siteOf, vault } = await import(pathToFileURL(out).href)

let passed = 0
const failures = []

const check = (name, actual, expected) => {
  if (actual === expected) passed++
  else failures.push({ name, actual, expected })
}

/* ------------------------------------------------------------ what a site is */

check('a plain domain is itself', siteOf('example.com'), 'example.com')
check('a subdomain belongs to its domain', siteOf('mail.example.com'), 'example.com')
check('depth does not matter', siteOf('a.b.c.example.com'), 'example.com')
check('case does not matter', siteOf('MAIL.Example.COM'), 'example.com')
check('a trailing dot does not matter', siteOf('example.com.'), 'example.com')

check('a country second level is part of the suffix', siteOf('shop.example.co.uk'), 'example.co.uk')
check('and the bare form of it', siteOf('example.co.uk'), 'example.co.uk')
check('com.br works the same way', siteOf('mail.example.com.br'), 'example.com.br')

check('a bare label is nobody', siteOf('localhost'), '')
check('an IPv4 address is only itself', siteOf('192.168.0.1'), '')
check('an IPv6 address is only itself', siteOf('[::1]'), '')
check('nothing is nothing', siteOf(''), '')

/* ------------------------------------------- and what must never be shared */

const sameSite = (a, b) => {
  const one = siteOf(a)
  return one !== '' && one === siteOf(b)
}

check('two subdomains of one domain are one site', sameSite('mail.example.com', 'accounts.example.com'), true)
check('a domain and its subdomain are one site', sameSite('example.com', 'login.example.com'), true)

check('two different domains are not', sameSite('example.com', 'example.net'), false)
check('a lookalike prefix is not', sameSite('example.com', 'notexample.com'), false)
check('a lookalike suffix is not', sameSite('example.com', 'example.com.evil.net'), false)
check('two sites under co.uk are not', sameSite('example.co.uk', 'other.co.uk'), false)
check('two sites under com.br are not', sameSite('shop.example.com.br', 'shop.other.com.br'), false)
check('two hosts on localhost are not', sameSite('localhost', 'localhost'), false)
check('two addresses are not', sameSite('192.168.0.1', '192.168.0.1'), false)

/* --------------------------------------------- what a shut vault will not do */

// Reading an entry needs the key. Deleting one needed nothing, so anyone who
// sat down at an unlocked machine could throw away every password without ever
// proving they were allowed to read one.
{
  const dir = mkdtempSync(join(tmpdir(), 'nya-vault-locked-'))
  vault.load(dir, false)
  check('a fresh vault opens with the keychain', vault.locked, false)
  const saved = vault.save('example.com', 'someone', 'a password worth keeping')
  check('a password can be saved while the vault is open', saved, true)
  const [entry] = vault.list()
  vault.lock()
  check('and the vault locks', vault.locked, true)
  check('a locked vault does not give the password up', vault.reveal(entry.id), null)
  check('a locked vault does not delete it either', vault.remove(entry.id), false)
  check('so the entry is still there', vault.list().length, 1)
}

for (const { name, actual, expected } of failures) {
  console.log(`FAIL ${name}`)
  console.log(`  got      ${JSON.stringify(actual)}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
}
console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
