// Makes the GitHub release exist before electron-builder tries to publish into
// it, and says afterwards whether everything the updater needs arrived.
//
// electron-builder starts one publisher per artifact. When the release does not
// exist yet they both decide to create it, and the loser gets a 422 that kills
// the run — after the installer is uploaded but before latest.yml is, which is
// the one file an installed copy reads to learn there is an update at all. That
// failure looks like a published release and behaves like no release. Creating
// the release first means both publishers find it and only upload.
//
//   node build/tools/gh-release.mjs           create it if it is not there
//   node build/tools/gh-release.mjs --verify  check the assets afterwards
//
// Needs GH_TOKEN, the same token electron-builder publishes with. Nothing here
// prints it.

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { owner, repo } = pkg.build.publish
const tag = `v${pkg.version}`
const verify = process.argv.includes('--verify')

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('GH_TOKEN is not set — the release token lives outside the repository')
  process.exit(2)
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      ...init.headers
    }
  })
  const body = response.status === 204 ? {} : await response.json()
  return { ok: response.ok, status: response.status, body }
}

// Returns the exit code rather than calling process.exit: on Windows, exiting
// while fetch is still tearing its socket down aborts the process with a libuv
// assertion instead of the code we meant.
async function main() {
  const existing = await api(`/releases/tags/${tag}`)

  if (verify) {
    if (!existing.ok) {
      console.error(`${tag} is not published: ${existing.body.message ?? existing.status}`)
      return 1
    }
    // The installer on its own is a download page; without latest.yml nobody
    // already running an older copy is ever told about it.
    const want = [
      `NyaBrowser-${pkg.version}-setup.exe`,
      `NyaBrowser-${pkg.version}-setup.exe.blockmap`,
      'latest.yml'
    ]
    const have = new Map(existing.body.assets.map((asset) => [asset.name, asset]))
    for (const name of want) {
      const asset = have.get(name)
      const mark = asset?.state === 'uploaded' ? '+' : '-'
      console.log(`  ${mark} ${name}${asset ? ` (${asset.size} bytes)` : ''}`)
    }
    const missing = want.filter((name) => have.get(name)?.state !== 'uploaded')
    if (missing.length) {
      console.error(`${tag} is missing: ${missing.join(', ')}`)
      return 1
    }
    console.log(`${tag} is complete: ${existing.body.html_url}`)
    return 0
  }

  if (existing.ok) {
    console.log(`${tag} already exists, electron-builder will upload into it`)
    return 0
  }

  const created = await api('/releases', {
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, name: pkg.version, draft: false, prerelease: false })
  })
  if (!created.ok) {
    console.error(`cannot create ${tag}: ${created.status} ${created.body.message ?? ''}`)
    return 1
  }
  console.log(`${tag} created: ${created.body.html_url}`)
  return 0
}

process.exitCode = await main()
