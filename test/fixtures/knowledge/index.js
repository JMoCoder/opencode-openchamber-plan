// Original test-only tool fixture, not an OpenChamber implementation.
export default {
  id: 'test.plan-knowledge-tools',
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      for (const name of ['openchamber_knowledge', 'openchamber']) {
        editor.add({
          name,
          description: 'Disposable Project Knowledge fixture for plugin lifecycle tests.',
          input: {
            type: 'object',
            properties: { action: { type: 'string' }, parameters: { type: 'object', additionalProperties: true } },
            required: ['action'],
            additionalProperties: true,
          },
          options: { codemode: false },
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
