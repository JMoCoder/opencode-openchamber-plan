import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import plugin from '../index.js'

const cwd = new URL('../', import.meta.url)
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(metadata.name, 'opencode-openchamber-plan')
assert.equal(metadata.version, '1.0.0')
assert.equal(metadata.license, 'MIT')
assert.equal(metadata.exports, './index.js')
assert.equal(plugin.id, 'openchamber.plan-knowledge')
assert.equal(typeof plugin.setup, 'function')
assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0)
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8' }))
const files = packed.files.map(({ path }) => path).sort()
assert.deepEqual(files, ['CHANGELOG.md', 'LICENSE', 'README.md', 'index.js', 'package.json'])
console.log(`Package check passed: ${metadata.name}@${metadata.version}; ${files.join(', ')}`)
