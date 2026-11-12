// Build an exact commit without copying local env files or changing the source checkout.
// Usage: node infra/scripts/build-release.mjs <40-char SHA> <HTTPS API base> <v1|v2>
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const [commit, apiBase, label] = process.argv.slice(2)
if (!/^[a-f0-9]{40}$/.test(commit || '') || !/^v[0-9]+$/.test(label || '')) {
  throw new Error('Provide an exact commit SHA, HTTPS API base and release label (v1/v2).')
}
const api = new URL(apiBase)
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash) {
  throw new Error('API base must use HTTPS without credentials, query parameters or a fragment.')
}
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = join(root, 'artifacts', 'releases', `${label}-${commit.slice(0, 12)}`)
if (fs.existsSync(output)) throw new Error('Release directory already exists; do not overwrite it.')
const temporary = fs.mkdtempSync(join(tmpdir(), 'seoul-now-web-build-'))
const digest = (path) => createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const run = (program, args, options = {}) => {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(`${program} failed`)
  return result.stdout?.trim()
}
try {
  const archive = join(temporary, 'source.tar')
  const source = join(temporary, 'source')
  fs.mkdirSync(source)
  run('git', ['archive', '--format=tar', '--output', archive, commit])
  run('tar', ['-xf', archive, '-C', source])
  if (digest(join(source, 'package-lock.json')) !== digest(join(root, 'package-lock.json'))) {
    throw new Error('Installed dependency baseline differs; install the release dependencies first.')
  }
  // Reuse dependencies already validated locally; this command installs nothing.
  fs.symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir')
  const browserEnv = loadEnv('production', root, 'VITE_')
  const mapKey = browserEnv.VITE_KAKAO_MAP_APP_KEY || ''
  if (!mapKey) throw new Error('The existing Kakao JavaScript key is missing; configure it locally.')
  run('npm', ['run', 'build'], {
    cwd: source,
    stdio: 'inherit',
    env: { ...process.env, VITE_API_BASE_URL: apiBase, VITE_KAKAO_MAP_APP_KEY: mapKey },
  })
  fs.mkdirSync(output, { recursive: true })
  fs.cpSync(join(source, 'dist'), join(output, 'dist'), { recursive: true })
  const files = {}
  function inventory(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      if (entry.isDirectory()) inventory(join(directory, entry.name), relative + '/')
      else if (entry.isFile()) files[relative] = digest(join(directory, entry.name))
      else throw new Error('Unexpected non-file build output')
    }
  }
  inventory(join(output, 'dist'))
  const manifest = {
    release: label,
    source_commit: commit,
    source_tree: run('git', ['rev-parse', `${commit}^{tree}`]),
    api_base_url: apiBase,
    kakao_javascript_key_sha256: createHash('sha256').update(mapKey).digest('hex'),
    node: process.version,
    built_at: new Date().toISOString(),
    files,
  }
  fs.writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Release built: ${output} (${Object.keys(files).length} files)`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
