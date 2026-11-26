// Original test-only tool fixture, not an OpenChamber implementation.
export default {
  id: 'test.plan-knowledge-tools',
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      for (const name of ['openchamber_knowledge', 'openchamber', 'agent_progress_report']) {
        const progress = name === 'agent_progress_report'
        editor.add({
          name,
          description: 'Disposable tool fixture for plugin lifecycle tests.',
          input: {
            type: 'object',
            properties: {
              [progress ? 'op' : 'action']: { type: 'string' },
              parameters: { type: 'object', additionalProperties: true },
            },
            required: [progress ? 'op' : 'action'],
            additionalProperties: true,
          },
          options: { codemode: !progress && process.env.PLAN_TEST_DIRECT_TOOLS !== '1' },
          async execute(input, context) {
            const response = await fetch(process.env.PLAN_PLUGIN_TEST_CALLBACK, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ input, sessionID: context.sessionID, tool: name }),
              signal: context.signal,
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error)
            return { content: JSON.stringify(result) }
          },
        })
      }
    })
  },
}
