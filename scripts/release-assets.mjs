import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const cwd = path.resolve(import.meta.dirname, '..')
const reportFile = process.argv[2]
assert.ok(reportFile, 'Usage: node scripts/release-assets.mjs /path/to/integration/report.json')
const run = (command, args) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
assert.equal(run('git', ['status', '--porcelain']), '', 'release source must be committed and clean')
const commit = run('git', ['rev-parse', 'HEAD'])
assert.equal(run('git', ['rev-parse', 'v1.0.0^{commit}']), commit, 'release tag must identify the current source')
const integration = JSON.parse(await readFile(reportFile, 'utf8'))
assert.equal(integration.gitTarget, 'github:JMoCoder/opencode-openchamber-plan#v1.0.0')
assert.equal(integration.checks.length, 15)
assert.ok(integration.checks.every(({ passed }) => passed))
const unit = run(process.execPath, ['--test', 'test/plugin.test.mjs'])
assert.match(unit, /# pass 12/)
assert.match(unit, /# fail 0/)
run('npm', ['run', 'pack:check'])

const output = path.join(cwd, 'artifacts/release')
await mkdir(output, { recursive: true })
const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', output]))
const sha256 = async (file) => createHash('sha256').update(await readFile(path.join(output, file))).digest('hex')
const verification = {
  schemaVersion: 1,
  version: '1.0.0',
  releaseCommit: commit,
  verifiedAt: new Date().toISOString(),
  runtime: { opencode: run(process.env.OPENCODE_BIN || 'opencode', ['--version']), node: process.version, npm: run('npm', ['--version']), platform: process.platform },
  unit: { passed: 12, failed: 0 },
  package: { file: packed.filename, sha256: await sha256(packed.filename), contentsChecked: true },
  integration: { target: integration.gitTarget, checks: integration.checks.map(({ name, passed }) => ({ name, passed })), explicitReloadCalls: 0, serviceRestarts: 0 },
  limitations: ['The knowledge-tool/storage fixture is not OpenChamber itself.', 'The model is deterministic localhost test code, not a paid or production language model.', 'Actual OpenChamber GUI interaction and arbitrary frontend validation are not certified.', 'Compatibility is verified on the recorded OpenCode version, not every V2 release.'],
}
await writeFile(path.join(output, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`)
const sums = await Promise.all([packed.filename, 'verification.json'].map(async (file) => `${await sha256(file)}  ${file}`))
await writeFile(path.join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`)
console.log(`Release assets verified and written to ${output}`)
console.log(sums.join('\n'))
