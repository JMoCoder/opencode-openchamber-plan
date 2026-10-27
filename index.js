// OpenCode V2 / OpenChamber: a Plan-only exception through the managed
// knowledge API. File permissions and the user's AGENTS.md stay unchanged.
const nativePrefix = '<system-reminder>\nYou are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:\n'
const nativeSuffix = '\n\nDo not modify any other files or ask a subagent to do so.\n\nYou remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.\n</system-reminder>'

function adaptReminder(text) {
  if (!text.startsWith(nativePrefix) || !text.endsWith(nativeSuffix)) return undefined
  const directory = text.slice(nativePrefix.length, -nativeSuffix.length)
  if (!directory || /[\r\n]/.test(directory)) return undefined
  return `<system-reminder>
You are in Plan mode. Discuss the plan with the user directly in the conversation.
Follow the existing global and project instructions about saving plans and waiting for the user to switch to Build.

The permitted plan-writing routes are:
- Native OpenCode plan files, when explicitly requested, only in: ${directory}
- The calling session's own Project Knowledge Plans, through openchamber_knowledge with action knowledge.save and kind plan. This narrow exception permits creating or updating the plan required by the existing instructions; it does not permit implementing the plan.

For Project Knowledge, use knowledge.list before creating a plan. Read the returned plan path with read; save subsequent revisions through knowledge.save with the same id, the whole Markdown body, and expected containing the exact text just read. Do not use edit, write, patch or shell to modify Project Knowledge files or its context.json index. OpenChamber owns the index and resolves the calling session's project automatically; omit projectId and directory. Do not create a duplicate plan for a revision.
Do not save Notes or Todos, delete knowledge, change other projects, or link the plan to another session while in Plan mode. knowledge.list and knowledge.show remain available.
Do not modify source code, configuration, or any other files, including through shell or a subagent.

You remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.
</system-reminder>`
}

function replaceReminder(parts) {
  let replacements = 0
  for (const part of parts) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue
    const replacement = adaptReminder(part.text)
    if (replacement !== undefined) {
      part.text = replacement
      replacements++
    }
  }
  return replacements
}

function knowledgeArgs(event) {
  if (event.tool !== 'openchamber_knowledge' && event.tool !== 'openchamber') return undefined
  const { action, parameters, ...flat } = event.input ?? {}
  if (typeof action !== 'string' || !action.startsWith('knowledge.')) return undefined
  // Match OpenChamber's own normalization: nested parameters win, but the
  // action always comes from the outer envelope.
  return { ...flat, ...(parameters ?? {}), action }
}

export default {
  id: 'openchamber.plan-knowledge',
  async setup(ctx) {
    const adaptedSessions = new Set()

    await ctx.session.hook('context', (event) => {
      if (event.agent !== 'plan' || !event.tools.openchamber_knowledge) {
        adaptedSessions.delete(event.sessionID)
        return
      }
      let replacements = replaceReminder(event.system)
      for (const message of event.messages) {
        if (message.role !== 'user' && message.role !== 'system') continue
        if (typeof message.content === 'string') {
          const replacement = adaptReminder(message.content)
          if (replacement !== undefined) {
            message.content = replacement
            replacements++
          }
        } else if (Array.isArray(message.content)) {
          replacements += replaceReminder(message.content)
        }
      }
      // Never silently enable writes under an unrecognized native reminder.
      if (replacements) adaptedSessions.add(event.sessionID)
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
