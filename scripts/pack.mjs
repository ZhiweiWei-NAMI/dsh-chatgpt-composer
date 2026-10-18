/**
 * Reproducible packer for dsh-chatgpt-composer.
 *
 * It writes `dsh-chatgpt-composer-<version>.tgz` with the standard npm layout
 * (`package/...`), using only `package.json`'s `files` list, fixed tar metadata
 * (uid/gid 0, one constant mtime, sorted entries) and gzip at a fixed level, so
 * two runs over unchanged sources produce byte-identical output and the same
 * sha256. It then re-reads the archive and fails if the entry set is not exactly
 * the expected one — no `.sdk`, no `scripts/`, no stray logs.
 *
 * Usage: node scripts/pack.mjs [--out <dir>]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const OUT_DIR = outIndex >= 0 && argv[outIndex + 1] !== undefined ? resolve(argv[outIndex + 1]) : ROOT
const MTIME = 1_600_000_000
const MODE = 0o644

/** Every file the package ships, as POSIX paths relative to the package root. */
function collect(manifest) {
  const files = new Set(['package.json'])
  for (const entry of manifest.files ?? []) {
    if (!entry.includes('*')) {
      files.add(entry)
      continue
    }
    const base = entry.slice(0, entry.indexOf('*')).replace(/\/$/u, '')
    const suffix = entry.slice(entry.lastIndexOf('*') + 1)
    const walk = (directory) => {
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, child.name)
        if (child.isDirectory()) walk(path)
        else if (path.endsWith(suffix)) files.add(relative(ROOT, path).split(sep).join('/'))
      }
    }
    walk(join(ROOT, base))
  }
  return [...files].sort()
}

/** Write one ustar header block. */
function header(name, size) {
  const block = Buffer.alloc(512)
  const write = (value, offset, length) => {
    const text = Buffer.from(value, 'utf8')
    if (text.length > length) throw new Error(`pack: ${name} does not fit its tar field`)
    text.copy(block, offset)
  }
  write(name, 0, 100)
  write(`${MODE.toString(8).padStart(6, '0')} \0`, 100, 8)
  write('0000000\0', 108, 8)
  write('0000000\0', 116, 8)
  write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12)
  write(`${MTIME.toString(8).padStart(11, '0')}\0`, 136, 12)
  write('        ', 148, 8)
  write('0', 156, 1)
  write('ustar\0', 257, 6)
  write('00', 263, 2)
  let sum = 0
  for (const byte of block) sum += byte
  write(`${sum.toString(8).padStart(6, '0')} \0`, 148, 8)
  return block
}

/** Build one deterministic tar image. */
function tarball(entries) {
  const chunks = []
  for (const { name, content } of entries) {
    chunks.push(header(`package/${name}`, content.length))
    chunks.push(content)
    const padding = (512 - (content.length % 512)) % 512
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

/** List the entry names of a tar image. */
function entryNames(image) {
  const names = []
  for (let offset = 0; offset + 512 <= image.length; ) {
    const block = image.subarray(offset, offset + 512)
    if (block.every((byte) => byte === 0)) break
    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '')
    const size = Number.parseInt(block.subarray(124, 136).toString('utf8').replace(/\0.*$/u, '').trim(), 8)
    names.push(name)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return names
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const names = collect(manifest)
const entries = names.map((name) => {
  const path = join(ROOT, name)
  if (!existsSync(path) || statSync(path).isDirectory()) throw new Error(`pack: ${name} is listed in files but missing`)
  return { name, content: readFileSync(path) }
})
const image = tarball(entries)
const gz = gzipSync(image, { level: 9 })
const target = join(OUT_DIR, `${manifest.name}-${manifest.version}.tgz`)
writeFileSync(target, gz)

const listed = entryNames(gunzipSync(readFileSync(target)))
const expected = names.map((name) => `package/${name}`)
const problems = []
if (JSON.stringify(listed) !== JSON.stringify(expected)) problems.push(`entry set mismatch:\n  expected ${expected.join(', ')}\n  actual   ${listed.join(', ')}`)
for (const name of listed) if (!/^package\/(lib\/|cordis\.patch\.yml$|README\.md$|LICENSE$|package\.json$)/u.test(name)) problems.push(`unexpected entry ${name}`)
if (!listed.includes('package/lib/client.js') || !listed.includes('package/lib/typert.host.js')) problems.push('the browser bundle or the host artifact is missing')

const digest = createHash('sha256').update(gz).digest('hex')
console.log(`${relative(process.cwd(), target)}`)
console.log(`  bytes  ${String(gz.length)}`)
console.log(`  sha256 ${digest}`)
console.log(`  entries (${String(listed.length)})`)
for (const name of listed) console.log(`    ${name}`)
if (problems.length > 0) {
  console.error('\npack: verification failed')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\npack: verification passed')
