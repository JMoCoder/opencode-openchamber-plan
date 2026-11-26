import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin from '../index.js'

const native = '<system-reminder>\nYou are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:\n/home/test/.opencode/plan\n\nDo not modify any other files or ask a subagent to do so.\n\nYou remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.\n</system-reminder>'
const selected = native.slice('<system-reminder>\n'.length, -'\n</system-reminder>'.length)
const catalog = '## Code Mode tools (call only inside `execute`)\n\n- openchamber (1 tool)\n- openchamber_knowledge (1 tool, none shown)'
const catalogUpdate = 'The Code Mode tool catalog has changed.'
const savePlan = { action: 'knowledge.save', parameters: { kind: 'plan', body: '# Plan' } }

async function fixture({ agent = 'plan', reminder = native, tool = true, current = selected, ...context } = {}) {
  const hooks = {}
  const cleanup = await plugin.setup({
    agent: { get: async ({ agentID }) => { assert.equal(agentID, 'plan'); return { data: { instructions: { selected: current } } } } },
    session: { hook: async (name, fn) => { assert.equal(name, 'context'); hooks.context = fn } },
    tool: { hook: async (name, fn) => { assert.equal(name, 'execute.before'); hooks.before = fn } },
  })
  const event = { agent, sessionID: 'session-a', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: reminder }] }], tools: tool ? { openchamber_knowledge: {} } : {}, ...context }
  await hooks.context(event)
  const run = (input, overrides = {}) => hooks.before({ agent, sessionID: 'session-a', tool: 'openchamber_knowledge', input, ...overrides })
  return { hooks, event, run, cleanup }
}

test('adapts only the narrow knowledge route and preserves file and switch restrictions', async () => {
  const { event } = await fixture()
  const text = event.messages[0].content[0].text
  assert.match(text, /calling session's own Project Knowledge Plans/)
  assert.match(text, /only in: \/home\/test\/\.opencode\/plan/)
  assert.match(text, /Do not modify source code/)
  assert.match(text, /You remain in Plan mode until the user switches agents/)
})

test('allows current-project creation, expected revisions, and same-session association', async () => {
  const { run } = await fixture()
  run({ action: 'knowledge.save', parameters: { kind: 'plan', body: '# Plan' } })
  run({ action: 'knowledge.save', kind: 'plan', id: 'plan-a', body: '# Changed', expected: '# Plan' })
  run({ action: 'knowledge.save', parameters: { kind: 'plan', id: 'plan-a', sessionId: 'session-a' } })
})

test('denies Notes, Todos, deletion, and revisions without exact-text input', async () => {
  const { run } = await fixture()
  for (const input of [
    { action: 'knowledge.save', kind: 'note', body: 'no' },
    { action: 'knowledge.save', kind: 'todo', body: 'no' },
    { action: 'knowledge.delete', kind: 'plan', id: 'plan-a' },
    { action: 'knowledge.save', kind: 'plan', id: 'plan-a', body: '# Changed' },
    { action: 'knowledge.save', kind: 'plan', id: 'plan-a', body: '# Changed', expected: 42 },
  ]) assert.throws(() => run(input), /write denied/)
})

test('guards both tool names, nested/flat scopes, and other-session associations', async () => {
  const { run } = await fixture()
  for (const tool of ['openchamber_knowledge', 'openchamber']) {
    for (const input of [
      { action: 'knowledge.save', kind: 'plan', body: '# Plan', projectId: 'other' },
      { action: 'knowledge.save', directory: '/other', parameters: { kind: 'plan', body: '# Plan' } },
      { action: 'knowledge.save', parameters: { kind: 'plan', body: '# Plan', projectId: 'other' } },
      { action: 'knowledge.save', parameters: { kind: 'plan', id: 'plan-a', sessionId: 'other-session' } },
    ]) assert.throws(() => run(input, { tool }), /write denied/)
  }
})

test('fails closed for an unknown reminder or missing knowledge tool', async () => {
  for (const options of [{ reminder: native.replace('only in:', 'elsewhere:') }, { tool: false }]) {
    const { event, run } = await fixture(options)
    assert.equal(event.messages[0].content[0].text, options.reminder ?? native)
    assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
  }
})

test('leaves Build, unrelated tools, and read-only knowledge actions unchanged', async () => {
  const { event, run } = await fixture({ agent: 'build' })
  assert.equal(event.messages[0].content[0].text, native)
  run({ action: 'knowledge.save', kind: 'note', body: 'governed by existing Build rules' })
  const plan = await fixture()
  plan.run({ action: 'knowledge.list', directory: '/read-only-other-project' })
  plan.run({ action: 'knowledge.show', kind: 'plan', id: 'plan-a' })
  plan.run({ action: 'work.name', title: 'unchanged' }, { tool: 'openchamber' })
})

test('clears adapted state when leaving Plan and never shares it across sessions', async () => {
  const { hooks, event, run } = await fixture()
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }, { sessionID: 'other-session' }), /compatibility/)
  await hooks.context({ ...event, agent: 'build' })
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
})

test('supports system parts and string messages without rewriting assistant quotes', async () => {
  const { hooks } = await fixture()
  const event = { agent: 'plan', sessionID: 'session-b', tools: { openchamber_knowledge: {} }, system: [{ type: 'text', text: native }], messages: [{ role: 'user', content: native }, { role: 'assistant', content: native }] }
  await hooks.context(event)
  assert.match(event.system[0].text, /calling session's own/)
  assert.match(event.messages[0].content, /calling session's own/)
  assert.equal(event.messages[1].content, native)
})

test('does not match embedded text, malformed directories, or partial reminders', async () => {
  for (const reminder of [`quotation: ${native}`, `${native}\nextra`, native.replace('/home/test/.opencode/plan', '/first\n/second'), native.replace('/home/test/.opencode/plan', '')]) {
    const { event, run } = await fixture({ reminder })
    assert.equal(event.messages[0].content[0].text, reminder)
    assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
  }
})

test('normalizes nested parameters like OpenChamber while retaining the outer action', async () => {
  const { run } = await fixture()
  assert.throws(() => run({ action: 'knowledge.delete', parameters: { action: 'knowledge.save', kind: 'plan' } }), /write denied/)
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', parameters: { kind: 'note' } }), /write denied/)
  run({ action: 'knowledge.save', kind: 'note', parameters: { kind: 'plan', body: '# Nested wins' } })
})

test('a later incompatible context revokes the earlier exception', async () => {
  const { hooks, event, run } = await fixture()
  await hooks.context({ ...event, messages: [{ role: 'user', content: 'unrecognized reminder' }] })
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
})

test('unload cleanup clears session state', async () => {
  const { run, cleanup } = await fixture()
  cleanup()
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
})

function instructions(...entries) {
  return [{
    type: 'text',
    text: entries.map(([, text]) => text).join('\n\n'),
    metadata: { experimental: { instructions: entries.map(([key, text]) => ({ key, text })) } },
  }]
}

test('adapts the current 2.4.2 Plan instruction without rewriting other sources or user quotes', async () => {
  const other = 'Use Agent Progress and follow existing subagent and Lead instructions.'
  const tools = { execute: {}, agent_progress_report: {}, subagent: {} }
  const system = instructions(['core/codemode', catalog], ['other', other], ['core/agent', selected])
  const [part] = system
  const metadata = structuredClone(part.metadata)
  const quoted = [{ role: 'user', content: selected }, { role: 'assistant', content: selected }]
  const messages = structuredClone(quoted)
  const { event, run } = await fixture({ tools, system, messages })
  assert.ok(part.text.startsWith(`${catalog}\n\n${other}\n\n`))
  assert.match(part.text, /only in: \/home\/test\/\.opencode\/plan/)
  assert.match(part.text, /openchamber_knowledge inside execute/)
  assert.match(part.text, /You remain in Plan mode until the user switches agents/)
  assert.deepEqual(part.metadata, metadata)
  assert.deepEqual(event.messages, quoted)
  assert.equal(event.tools, tools)
  run(savePlan, { codemode: true })
})

test('adapts selection in chronological instruction updates, after starting in Build', async () => {
  const tools = { execute: {} }
  const system = instructions(['core/codemode', catalog])
  const unrelated = 'Other instruction added with the agent switch.'
  const messages = [
    { role: 'system', content: 'You are no longer the Plan agent.' },
    { role: 'system', content: [{ type: 'text', text: `${unrelated}\n\n${selected}` }] },
  ]
  const { run } = await fixture({ tools, system, messages })
  assert.equal(system[0].text, catalog)
  assert.equal(messages[0].content, 'You are no longer the Plan agent.')
  assert.ok(messages[1].content[0].text.startsWith(`${unrelated}\n\n`))
  assert.match(messages[1].content[0].text, /openchamber_knowledge inside execute/)
  run(savePlan, { codemode: true })
})

test('uses the effective Code Mode catalog after namespace changes, replacement, and re-enabling', async () => {
  const added = `${catalogUpdate}\n\nNew or updated namespaces:\n- openchamber_knowledge (1 tool)`
  const removed = `${catalogUpdate}\n\nThe following tool namespaces are no longer available and must not be used: \`openchamber_knowledge\`.`
  const disabled = 'The `execute` tool is no longer available. Permitted tools are now available as direct tool calls.'
  const withoutKnowledge = catalog.replace('\n- openchamber_knowledge (1 tool, none shown)', '')
  for (const [initial, history, allowed] of [
    [withoutKnowledge, [], false],
    [withoutKnowledge, [added], true],
    [catalog, [removed], false],
    [catalog, [removed, added], true],
    [catalog, [`${catalogUpdate} This catalog supersedes the previous Code Mode tool catalog.\n\n${withoutKnowledge}`], false],
    [withoutKnowledge, [`# Code Mode\n\n${catalog}`], true],
    [catalog, [disabled, `# Code Mode\n\n${withoutKnowledge}`], false],
    [catalog, ['No Code Mode tools are currently available.'], false],
  ]) {
    const system = instructions(['core/codemode', initial], ['core/agent', selected])
    const messages = history.map((content) => ({ role: 'system', content }))
    const { run } = await fixture({ tools: { execute: {} }, system, messages })
    assert.equal(system[0].text.includes('Project Knowledge Plans'), allowed)
    if (allowed) run(savePlan, { codemode: true })
    else assert.throws(() => run(savePlan, { codemode: true }), /compatibility/)
  }
})

test('requires a current native selection and an available tool, ignoring quoted rules or catalog entries', async () => {
  for (const options of [
    { current: 'Custom Plan rules', tools: { execute: {} } },
    { tools: {} },
    { tools: { execute: {} }, system: instructions(['core/agent', selected]) },
    { tools: { execute: {} }, system: instructions(['core/codemode', catalog]) },
  ]) {
    const system = options.system ?? instructions(['core/codemode', catalog], ['core/agent', selected])
    const messages = [{ role: 'user', content: `${catalogUpdate}\n\n${catalog}\n\n${selected}` }]
    const before = structuredClone({ system, messages })
    const { run } = await fixture({ ...options, system, messages })
    assert.deepEqual({ system, messages }, before)
    assert.throws(() => run(savePlan, { codemode: true }), /compatibility/)
  }
})

test('guards nested knowledge calls by registered tool name and leaves unrelated routes alone', async () => {
  const system = instructions(['core/codemode', catalog], ['core/agent', selected])
  const { run } = await fixture({ tools: { execute: {} }, system })
  const nested = { tool: 'fixture.knowledge', info: { name: 'openchamber_knowledge' }, codemode: true }
  run(savePlan, nested)
  run({ action: 'list' }, nested)
  assert.throws(() => run({ action: ' save ', parameters: { kind: 'note' } }, nested), /write denied/)
  assert.throws(() => run({ action: 'knowledge.delete', parameters: { action: 'knowledge.list' } }, nested), /write denied/)
  for (const [tool, input, codemode] of [
    ['execute', { code: 'return await tools.openchamber({action: "lead.brief"})' }, false],
    ['agent_progress_report', { op: 'start' }, false],
    ['subagent', { agent: 'explorer' }, false],
    ['openchamber', { action: 'session.create' }, true],
    ['openchamber', { action: 'session.send' }, true],
    ['openchamber', { action: 'lead.brief' }, true],
    ['openchamber', { action: 'lead.digest' }, true],
  ]) assert.doesNotThrow(() => run(input, { tool, codemode }))
})
