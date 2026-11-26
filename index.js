// OpenCode V2 / OpenChamber: a Plan-only exception through the managed
// knowledge API. File permissions and the user's AGENTS.md stay unchanged.
const nativePrefix = 'You are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:\n'
const nativeSuffix = '\n\nDo not modify any other files or ask a subagent to do so.\n\nYou remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.'
const legacyOpen = '<system-reminder>\n'
const legacyClose = '\n</system-reminder>'
const knowledgeTool = 'openchamber_knowledge'
const catalogEntry = /^- openchamber_knowledge \(1 tool(?:, none shown)?\)(?: \/\/[^\n]*)?$/m
const catalogUpdate = 'The Code Mode tool catalog has changed.'
const catalogReplacement = `${catalogUpdate} This catalog supersedes the previous Code Mode tool catalog.`
const catalogStart = '# Code Mode\n\n'
const catalogDisabled = 'The `execute` tool is no longer available.'
const catalogEmpty = 'No Code Mode tools are currently available.'
const catalogRemoval = /^The following tool namespaces are no longer available and must not be used: [^\n]*`openchamber_knowledge`/m

function adaptReminder(text, route) {
  if (!text.startsWith(nativePrefix) || !text.endsWith(nativeSuffix)) return undefined
  const directory = text.slice(nativePrefix.length, -nativeSuffix.length)
  if (!directory || /[\r\n]/.test(directory)) return undefined
  return `You are in Plan mode. Discuss the plan with the user directly in the conversation.
Follow the existing global and project instructions about saving plans and waiting for the user to switch to Build.

The permitted plan-writing routes are:
- Native OpenCode plan files, when explicitly requested, only in: ${directory}
- The calling session's own Project Knowledge Plans, with action knowledge.save and kind plan through ${route}. Use this route to create or update the plan required by the existing instructions.

For Project Knowledge, use knowledge.list before creating a plan. Read the returned plan path with read; save subsequent revisions through knowledge.save with the same id, the whole Markdown body, and expected containing the exact text just read. Do not use edit, write, patch or shell to modify Project Knowledge files or its context.json index. OpenChamber owns the index and resolves the calling session's project automatically; omit projectId and directory. Do not create a duplicate plan for a revision.
Do not save Notes or Todos, delete knowledge, change other projects, or link the plan to another session while in Plan mode. knowledge.list and knowledge.show remain available.
Do not modify source code, configuration, or any other files, including through shell or a subagent.

You remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.`
}

function instructionSources(part) {
  return part.metadata?.experimental?.instructions ?? []
}

function knowledgeRoute(event) {
  if (Object.hasOwn(event.tools, knowledgeTool)) return 'the openchamber_knowledge tool directly'
  if (!Object.hasOwn(event.tools, 'execute')) return undefined

  // Code Mode tools are absent from event.tools. Match the namespace even
  // when its signature was omitted from the model's partial catalog.
  let available = event.system.some((part) => instructionSources(part).some(
    (source) => source.key === 'core/codemode' && catalogEntry.test(source.text),
  ))
  for (const message of event.messages) {
    if (message.role !== 'system') continue
    const text = typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => part.type === 'text' ? part.text : '').join('\n\n')
    if (text.startsWith(catalogStart) || text.startsWith(catalogReplacement)) {
      // OpenCode can reintroduce the source with a fresh catalog, not a delta.
      available = catalogEntry.test(text)
    } else if (text.startsWith(catalogDisabled) || text.startsWith(catalogEmpty)) {
      available = false
    } else if (text.startsWith(catalogUpdate)) {
      if (catalogRemoval.test(text)) available = false
      if (catalogEntry.test(text)) available = true
    }
  }
  if (available) return 'openchamber_knowledge inside execute, using the exact callable path in the Code Mode catalog (look it up with search if needed)'
}

function replaceParts(parts, adapt) {
  let replacements = 0
  for (const part of parts) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue
    const replacement = adapt(part.text)
    if (replacement !== undefined) {
      part.text = replacement
      replacements++
    }
  }
  return replacements
}

function replaceMessage(message, adapt) {
  if (Array.isArray(message.content)) return replaceParts(message.content, adapt)
  if (typeof message.content !== 'string') return 0
  const replacement = adapt(message.content)
  if (replacement === undefined) return 0
  message.content = replacement
  return 1
}

function adaptLegacyContext(event, route) {
  const adapt = (text) => {
    if (!text.startsWith(legacyOpen) || !text.endsWith(legacyClose)) return undefined
    const replacement = adaptReminder(text.slice(legacyOpen.length, -legacyClose.length), route)
    if (replacement !== undefined) return `${legacyOpen}${replacement}${legacyClose}`
  }
  let replacements = replaceParts(event.system, adapt)
  for (const message of event.messages) {
    if (message.role === 'user' || message.role === 'system') replacements += replaceMessage(message, adapt)
  }
  return replacements > 0
}

async function adaptSelectedContext(ctx, event, route) {
  // The initial instructions can predate an agent switch or configuration
  // change. Confirm the current Plan instruction before adapting the replay.
  const current = await ctx.agent.get({ agentID: event.agent }).catch(() => undefined)
  const selected = current?.data?.instructions?.selected
  if (typeof selected !== 'string') return false
  const replacement = adaptReminder(selected, route)
  if (replacement === undefined) return false

  const adapt = (text) => {
    const index = text.lastIndexOf(selected)
    if (index === -1) return undefined
    const before = text.slice(0, index)
    const after = text.slice(index + selected.length)
    if ((before && !before.endsWith('\n\n')) || (after && !after.startsWith('\n\n'))) return undefined
    return `${before}${replacement}${after}`
  }
  let replacements = 0
  for (const part of event.system) {
    if (instructionSources(part).some((source) => source.key === 'core/agent' && source.text === selected)) {
      replacements += replaceParts([part], adapt)
    }
  }
  // Re-entering Plan emits a chronological system message. The same update
  // can carry instructions from other sources, which must pass through intact.
  for (const message of event.messages) {
    if (message.role === 'system') replacements += replaceMessage(message, adapt)
  }
  return replacements > 0
}

function knowledgeArgs(event) {
  const tool = event.info?.name ?? event.tool
  if (tool !== knowledgeTool && tool !== 'openchamber') return undefined
  const { action, parameters, ...flat } = event.input ?? {}
  if (typeof action !== 'string') return undefined
  let qualified = action.trim()
  if (tool === knowledgeTool && ['list', 'show', 'save', 'delete'].includes(qualified)) qualified = `knowledge.${qualified}`
  if (!qualified.startsWith('knowledge.')) return undefined
  // Match OpenChamber's own normalization: nested parameters win, but the
  // action always comes from the outer envelope.
  return { ...flat, ...(parameters ?? {}), action: qualified }
}

export default {
  id: 'openchamber.plan-knowledge',
  async setup(ctx) {
    const adaptedSessions = new Set()

    await ctx.session.hook('context', async (event) => {
      const route = event.agent === 'plan' ? knowledgeRoute(event) : undefined
      if (route === undefined) {
        adaptedSessions.delete(event.sessionID)
        return
      }
      const selectedContext = event.system.some((part) => instructionSources(part).length > 0)
      const adapted = selectedContext
        ? await adaptSelectedContext(ctx, event, route)
        : adaptLegacyContext(event, route)
      // Never silently enable writes under an unrecognized native reminder.
      if (adapted) adaptedSessions.add(event.sessionID)
      else adaptedSessions.delete(event.sessionID)
    })

    await ctx.tool.hook('execute.before', (event) => {
      if (event.agent !== 'plan') return
      const args = knowledgeArgs(event)
      if (!args || args.action === 'knowledge.list' || args.action === 'knowledge.show') return
      const deny = (reason) => { throw new Error(`Plan Project Knowledge write denied: ${reason}`) }
      if (!adaptedSessions.has(event.sessionID)) deny('The native Plan reminder was not recognized. Check compatibility; do not bypass the restriction.')
      if (args.action !== 'knowledge.save' || args.kind !== 'plan') deny('Only creating or updating Plans is allowed, not Notes, Todos, or deletion.')
      if (args.projectId !== undefined || args.directory !== undefined) deny('Omit projectId and directory; OpenChamber resolves the calling session\'s project.')
      if (args.sessionId !== undefined && args.sessionId !== event.sessionID) deny('Cannot change another session\'s plan association.')
      if (args.id !== undefined && args.body !== undefined && typeof args.expected !== 'string') deny('Read the existing plan and supply its exact text as expected before updating it.')
    })

    return () => adaptedSessions.clear()
  },
}
