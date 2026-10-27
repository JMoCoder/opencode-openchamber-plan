import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

const repository = path.resolve(import.meta.dirname, '..')
const temporaryBase = process.platform === 'linux' ? '/tmp/opencode' : os.tmpdir()
await mkdir(temporaryBase, { recursive: true })
const root = await mkdtemp(path.join(temporaryBase, 'openchamber-plan-release-'))
const home = path.join(root, 'home')
const globalConfig = path.join(home, '.config/opencode')
const configFile = path.join(globalConfig, 'opencode.json')
const projectA = path.join(root, 'project-a')
const projectB = path.join(root, 'project-b')
const fixture = path.join(repository, 'test/fixtures/knowledge')
const binary = process.env.OPENCODE_BIN || 'opencode'
const gitTarget = process.env.PLUGIN_SPEC
const pluginID = 'openchamber.plan-knowledge'
const marker = "calling session's own Project Knowledge Plans"
const nativeMarker = 'write them only in:'
const checks = []
const requests = []
const callbacks = []
const commands = []
const queue = []
const sessionDirectories = new Map()
const plans = new Map()
const notes = []
let child
let log = ''
let apiURL
let password
let packageTarget
let activeSession

await mkdir(globalConfig, { recursive: true })
for (const project of [projectA, projectB]) {
  await mkdir(path.join(project, 'src'), { recursive: true })
  await writeFile(path.join(project, 'src/example.txt'), 'original\n')
}

// Do not inherit model credentials, real service discovery, or host config.
const inheritedKeys = new Set(['PATH', 'LANG', 'LC_ALL', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => inheritedKeys.has(key)))
Object.assign(env, {
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_DATA_HOME: path.join(home, '.local/share'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  XDG_STATE_HOME: path.join(home, '.local/state'),
  OPENCODE_DB: path.join(root, 'test.db'),
  OPENCODE_DISABLE_MODELS_FETCH: 'true',
  NPM_CONFIG_CACHE: path.join(home, '.npm'),
  NPM_CONFIG_USERCONFIG: path.join(root, 'empty.npmrc'),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
})
await writeFile(env.NPM_CONFIG_USERCONFIG, '')

function check(name, detail) {
  checks.push({ name, passed: true, ...(detail ? { detail } : {}) })
  console.log(`PASS ${name}`)
}

async function command(executable, args, cwd = projectA, timeout = 120_000) {
  const proc = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (chunk) => { stdout += chunk })
  proc.stderr.on('data', (chunk) => { stderr += chunk })
  const timer = setTimeout(() => proc.kill('SIGKILL'), timeout)
  try {
    const code = await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', resolve) })
    commands.push({ executable: path.basename(executable), args, code, stdout, stderr })
    if (code !== 0) throw new Error(`Command failed: ${path.basename(executable)} ${args.join(' ')}\n${stdout}\n${stderr}`)
    return stdout.trim()
  } finally {
    clearTimeout(timer)
  }
}

async function knowledge(input, sessionID) {
  const { action, parameters, ...flat } = input
  const args = { ...flat, ...(parameters ?? {}), action }
  const directory = sessionDirectories.get(sessionID)
  assert.ok(directory === projectA || directory === projectB, 'fixture session directory')
  const scope = args.directory ?? directory
  assert.ok(scope === projectA || scope === projectB, 'fixture write remains disposable')
  if (action === 'knowledge.list') return { plans: [...plans.values()].filter((plan) => plan.directory === directory), notes: [] }
  if (action === 'knowledge.show') return { shown: true }
  if (action !== 'knowledge.save') throw new Error('Unsupported test fixture action')
  if (args.kind !== 'plan') { notes.push({ directory: scope, body: args.body }); return { saved: true } }
  if (!args.id) {
    assert.equal(typeof args.body, 'string')
    const id = randomUUID()
    const folder = path.join(home, '.config/openchamber-test', Buffer.from(scope).toString('base64url'), 'plans')
    await mkdir(folder, { recursive: true })
    const plan = { id, directory: scope, path: path.join(folder, `${id}.md`) }
    plans.set(id, plan)
    await writeFile(plan.path, args.body)
    return { plan }
  }
  const plan = plans.get(args.id)
  assert.equal(plan?.directory, directory, 'fixture plan belongs to calling project')
  if (args.body !== undefined) {
    if (await readFile(plan.path, 'utf8') !== args.expected) throw new Error('Plan changed; reload before saving')
    await writeFile(plan.path, args.body)
  }
  return { plan }
}

const fixtureServer = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    if (req.url === '/callback') {
      try {
        const result = await knowledge(body.input, body.sessionID)
        callbacks.push({ ...body, result })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
      } catch (error) {
        callbacks.push({ ...body, error: error.message })
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }))
      }
      return
    }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return }
    requests.push(body)
    // Native mode hooks can admit one additional reminder-only continuation.
    // Acknowledge it without inventing tool calls or consuming another turn.
    assert.ok(requests.length < 300, 'bounded number of model fixture requests')
    const answer = queue.shift() ?? { text: 'Mode reminder acknowledged.' }
    const common = { id: `chatcmpl-${randomUUID()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'probe' }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    if (answer.tool) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: answer.tool, arguments: JSON.stringify(answer.input) } }] })
      send({}, 'tool_calls')
    } else {
      send({ role: 'assistant', content: answer.text ?? 'test completed' })
      send({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: error.message } }))
  }
})
await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve))
const fixtureURL = `http://127.0.0.1:${fixtureServer.address().port}`
env.PLAN_PLUGIN_TEST_CALLBACK = `${fixtureURL}/callback`
const config = {
  $schema: 'https://opencode.ai/config.json',
  model: 'local-test/probe',
  snapshots: false,
  plugins: [fixture],
  providers: {
    'local-test': {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `${fixtureURL}/v1`, apiKey: 'test-only' },
      models: { probe: { modelID: 'probe', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 65_536, output: 4_096 } } },
    },
  },
}
async function saveConfig() { await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`) }
await saveConfig()

async function api(method, route, data, directory = projectA) {
  const response = await fetch(`${apiURL}${route}`, {
    method,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'x-opencode-directory': encodeURIComponent(directory), ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : undefined
}

async function session(directory = projectA) {
  const { data } = await api('POST', '/api/session', { title: 'Disposable package lifecycle test', agent: 'plan', model: { providerID: 'local-test', id: 'probe' }, location: { directory } }, directory)
  sessionDirectories.set(data.id, directory)
  return data.id
}

async function turn(sessionID, steps = [], directory = projectA) {
  const previous = await api('GET', `/api/session/${sessionID}/message?limit=100`, undefined, directory)
  const previousIDs = new Set(previous.data.map(({ id }) => id))
  queue.push(...steps, { text: 'Disposable test turn completed.' })
  await api('POST', `/api/session/${sessionID}/prompt`, { text: 'Run only the scripted disposable verification operation.' }, directory)
  await api('POST', `/api/experimental/session/${sessionID}/wait`, undefined, directory)
  assert.equal(queue.length, 0, 'all scripted answers were consumed')
  const messages = await api('GET', `/api/session/${sessionID}/message?limit=100`, undefined, directory)
  const added = messages.data.filter(({ id }) => !previousIDs.has(id)).sort((a, b) => a.time.created - b.time.created)
  assert.equal(added.filter((message) => message.type === 'assistant' && message.error).length, 0, JSON.stringify(added))
  return added.flatMap((message) => message.content ?? []).filter((part) => part.type === 'tool')
}

// Observe behavior at idle boundaries. No explicit reload or restart is used.
async function expectLifecycle(enabled, sessionID = activeSession) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    await turn(sessionID)
    const active = (await api('GET', '/api/plugin')).data.some(({ id }) => id === pluginID)
    const adapted = JSON.stringify(requests.at(-1).messages).includes(marker)
    if (active === enabled && adapted === enabled) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Configuration did not hot-reload to enabled=${enabled}`)
}

function denied(tool, pattern = /Plan Project Knowledge write denied/) {
  assert.equal(tool.state.status, 'error', JSON.stringify(tool))
  assert.match(JSON.stringify(tool.state), pattern)
}

try {
  const version = await command(binary, ['--version'])
  assert.match(version, /v?2\./)
  const [packed] = JSON.parse(await command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repository))
  await command('tar', ['-xzf', path.join(root, packed.filename), '-C', root])
  packageTarget = path.join(root, 'package')
  assert.equal(await readFile(path.join(packageTarget, 'index.js'), 'utf8'), await readFile(path.join(repository, 'index.js'), 'utf8'))
  check('packed artifact matches the source entrypoint', { version, sha256: createHash('sha256').update(await readFile(path.join(root, packed.filename))).digest('hex') })

  child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: projectA, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(child.exitCode, null, 'isolated server remains alive')
    apiURL = log.match(/server listening on (http:\/\/\S+)/)?.[1]
    password = log.match(/server password (\S+)/)?.[1]
    if (apiURL && password) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(apiURL && password, 'isolated server readiness')
  activeSession = await session()
  await turn(activeSession)
  const permissions = (await api('GET', '/api/agent/plan')).data.permissions
  assert.ok(JSON.stringify(requests.at(-1).messages).includes(nativeMarker))
  check('baseline uses the original native Plan reminder')

  config.plugins.push(packageTarget)
  await saveConfig()
  await expectLifecycle(true)
  assert.deepEqual((await api('GET', '/api/agent/plan')).data.permissions, permissions)
  check('official explicit local-directory configuration hot-loads the packed artifact')

  const body = '# Package lifecycle plan\n\n## Steps\n- [ ] Implement the approved disposable edit\n'
  const created = await turn(activeSession, [
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.list' } },
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', parameters: { kind: 'plan', body } } },
  ])
  assert.ok(created.every((call) => call.state.status === 'completed'))
  const plan = callbacks.filter((call) => call.result?.plan).at(-1).result.plan
  assert.equal(await readFile(plan.path, 'utf8'), body)
  const revision = body.replace('approved disposable', 'approved and verified disposable')
  await turn(activeSession, [
    { tool: 'read', input: { path: plan.path } },
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'plan', id: plan.id, body: revision, expected: body } },
  ])
  assert.equal(await readFile(plan.path, 'utf8'), revision)
  const stale = await turn(activeSession, [{ tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'plan', id: plan.id, body: '# Stale overwrite', expected: body } }])
  denied(stale[0], /Plan changed; reload before saving/)
  assert.equal(await readFile(plan.path, 'utf8'), revision)
  check('Plan creation and same-ID revision preserve exact-text concurrency checks')

  const source = path.join(projectA, 'src/example.txt')
  const edit = { path: source, oldString: 'original', newString: 'implemented' }
  const blocked = await turn(activeSession, [
    { tool: 'edit', input: edit },
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'note', body: 'must be blocked' } },
    { tool: 'openchamber', input: { action: 'knowledge.save', directory: projectB, parameters: { kind: 'plan', body: '# Wrong project' } } },
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.delete', kind: 'plan', id: plan.id } },
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'plan', id: plan.id, body: '# Missing expected' } },
  ])
  assert.equal(blocked.length, 5)
  denied(blocked[0], /Plan directory|permission|denied/i)
  for (const call of blocked.slice(1)) denied(call)
  assert.equal(await readFile(source, 'utf8'), 'original\n')
  assert.equal(notes.length, 0)
  check('native source edit and out-of-scope knowledge writes are refused')

  config.plugins.push(`-${pluginID}`)
  await saveConfig()
  await expectLifecycle(false)
  const before = notes.length
  const unguarded = await turn(activeSession, [{ tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'note', body: 'disposable unload probe' } }])
  assert.equal(unguarded[0].state.status, 'completed')
  assert.equal(notes.length, before + 1)
  check('official ID control hot-disables the adapter and disposes its tool hook')

  config.plugins.pop()
  await saveConfig()
  await expectLifecycle(true)
  const guardedAgain = await turn(activeSession, [{ tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'note', body: 'blocked after re-enable' } }])
  denied(guardedAgain[0])
  check('removing the disable control hot-re-enables the adapter')

  config.plugins = [fixture]
  await saveConfig()
  await expectLifecycle(false)
  check('removing the local-directory entry hot-unloads the package')
  config.plugins.push(new URL(`file://${packageTarget}`).href)
  await saveConfig()
  await expectLifecycle(true)
  check('official file-directory URL configuration hot-reinstalls the package')

  const fresh = await session(projectB)
  const inherited = await turn(fresh, [{ tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'plan', body: '# Fresh project\n\n## Steps\n- [ ] inherited globally\n' } }], projectB)
  assert.equal(inherited[0].state.status, 'completed')
  assert.equal(callbacks.filter((call) => call.result?.plan).at(-1).result.plan.directory, projectB)
  for (const directory of [projectA, projectB]) {
    await assert.rejects(stat(path.join(directory, 'opencode.json')), { code: 'ENOENT' })
    await assert.rejects(stat(path.join(directory, '.opencode')), { code: 'ENOENT' })
  }
  check('a fresh project inherits the global package without local configuration')

  await api('POST', `/api/session/${activeSession}/agent`, { agent: 'build' })
  const done = revision.replace('- [ ]', '- [x]')
  const built = await turn(activeSession, [
    { tool: 'read', input: { path: plan.path } },
    { tool: 'edit', input: edit },
    { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'plan', id: plan.id, body: done, expected: revision } },
  ])
  assert.ok(built.every((call) => call.state.status === 'completed'), JSON.stringify(built))
  assert.equal(await readFile(source, 'utf8'), 'implemented\n')
  assert.equal(await readFile(plan.path, 'utf8'), done)
  check('explicit Plan-to-Build switch edits source and completes the same plan')
  await api('POST', `/api/session/${activeSession}/agent`, { agent: 'plan' })

  if (gitTarget) {
    config.plugins = [fixture]
    await saveConfig()
    await expectLifecycle(false)
    await command(binary, ['plugin', 'add', gitTarget])
    Object.assign(config, JSON.parse(await readFile(configFile, 'utf8')))
    assert.ok(config.plugins.includes(gitTarget), 'official add persisted the Git package target')
    await expectLifecycle(true)
    const gitPlugins = await api('GET', '/api/plugin')
    await writeFile(path.join(root, 'git-plugins.json'), JSON.stringify(gitPlugins, null, 2))
    const installed = gitPlugins.data.find(({ id }) => id === pluginID)
    assert.ok(installed)
    assert.equal(installed.source.type, 'package')
    assert.equal(installed.source.target, gitTarget)
    check('official plugin add hot-installs the Git package target', { target: gitTarget, plugin: installed })
    const remoteCalls = await turn(activeSession, [
      { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'plan', body: '# Git package probe\n\n## Steps\n- [ ] verified installed artifact\n' } },
      { tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'note', body: 'must be blocked by the Git-installed guard' } },
    ])
    assert.equal(remoteCalls[0].state.status, 'completed')
    denied(remoteCalls[1])
    check('the Git-installed artifact permits Plans and rejects Notes')
    await command(binary, ['plugin', 'remove', gitTarget])
    Object.assign(config, JSON.parse(await readFile(configFile, 'utf8')))
    assert.ok(!config.plugins.includes(gitTarget), 'official remove persisted uninstall')
    await expectLifecycle(false)
    const removedCalls = await turn(activeSession, [{ tool: 'openchamber_knowledge', input: { action: 'knowledge.save', kind: 'note', body: 'disposable Git unload probe' } }])
    assert.equal(removedCalls[0].state.status, 'completed')
    check('official plugin remove hot-unloads the Git package target')
  }

  assert.deepEqual((await api('GET', '/api/agent/plan')).data.permissions, permissions)
  assert.equal(child.exitCode, null)
  process.kill(child.pid, 0)
  check('all lifecycle checks used the same live server process and unchanged Plan permissions', { pid: child.pid, explicitReloadCalls: 0, serviceRestarts: 0 })
} catch (error) {
  checks.push({ name: 'integration failure', passed: false, detail: error.stack })
  console.error(error.stack)
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve))
  }
  await new Promise((resolve) => fixtureServer.close(resolve))
  const redact = (text) => password ? text.replaceAll(password, '[redacted]') : text
  await writeFile(path.join(root, 'server.log'), redact(log))
  await writeFile(path.join(root, 'commands.json'), redact(JSON.stringify(commands, null, 2)))
  await writeFile(path.join(root, 'report.json'), JSON.stringify({ checks, root, gitTarget: gitTarget ?? null, requests: requests.length, callbacks: callbacks.length }, null, 2))
  await writeFile(path.join(root, 'model-requests.json'), JSON.stringify(requests, null, 2))
  console.log(`Artifacts: ${root}`)
}
