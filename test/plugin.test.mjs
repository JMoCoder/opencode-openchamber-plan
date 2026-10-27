import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin from '../index.js'

const native = '<system-reminder>\nYou are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:\n/home/test/.opencode/plan\n\nDo not modify any other files or ask a subagent to do so.\n\nYou remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.\n</system-reminder>'

async function fixture({ agent = 'plan', reminder = native, tool = true } = {}) {
  const hooks = {}
  const cleanup = await plugin.setup({
    session: { hook: async (name, fn) => { assert.equal(name, 'context'); hooks.context = fn } },
    tool: { hook: async (name, fn) => { assert.equal(name, 'execute.before'); hooks.before = fn } },
  })
  const event = { agent, sessionID: 'session-a', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: reminder }] }], tools: tool ? { openchamber_knowledge: {} } : {} }
  hooks.context(event)
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
  hooks.context({ ...event, agent: 'build' })
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
})

test('supports system parts and string messages without rewriting assistant quotes', async () => {
  const { hooks } = await fixture()
  const event = { agent: 'plan', sessionID: 'session-b', tools: { openchamber_knowledge: {} }, system: [{ type: 'text', text: native }], messages: [{ role: 'user', content: native }, { role: 'assistant', content: native }] }
  hooks.context(event)
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
  hooks.context({ ...event, messages: [{ role: 'user', content: 'unrecognized reminder' }] })
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
})

test('unload cleanup clears session state', async () => {
  const { run, cleanup } = await fixture()
  cleanup()
  assert.throws(() => run({ action: 'knowledge.save', kind: 'plan', body: '# Plan' }), /compatibility/)
})
