import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const listeners = new Map()
const wrappers = new WeakMap()
let stored = { provider: 'default-provider', model: 'default-model', reasoningEffort: 'high' }

const listener = name => listeners.get(name)?.[0]

function wrapperFor(owner, name) {
  return wrappers.get(owner)?.get(name)
}

function agent(id, { subagent = false } = {}) {
  const value = {
    id,
    session: {
      header: { id, ...(subagent ? { origin: 'subagent' } : {}) },
      events: [],
    },
  }
  value.ctx = {
    tools: {
      register(definition) {
        const byName = wrappers.get(value) ?? new Map()
        byName.set(definition.name, definition)
        wrappers.set(value, byName)
        return () => byName.delete(definition.name)
      },
    },
    on(name, callback) {
      const values = listeners.get(name) ?? []
      values.push(callback)
      listeners.set(name, values)
      return () => {}
    },
  }
  return value
}

function originalTool(name) {
  return {
    name,
    description: 'Delegate a task.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: { type: 'string' },
        prompt: { type: 'string' },
        run_in_background: { type: 'boolean' },
      },
      required: ['description', 'prompt'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: () => [],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const child = agent(`child-${Math.random()}`, { subagent: true })
      listener('agent/created')({ agent: child })
      listener('agent/session-start')({ agent: child, source: 'startup' })
      const config = await listener('agent/request')(
        { agent: child },
        async () => ({ provider: 'parent-provider', model: 'parent-model' }),
      )
      return { args, config, exec }
    },
  }
}

const originals = new Map([
  ['subagent', originalTool('subagent')],
  ['subagent_fork', originalTool('subagent_fork')],
])

const ctx = {
  settings: {
    register() {
      return { get: () => stored }
    },
  },
  tools: {
    get(name, owner) {
      return wrapperFor(owner, name) ?? originals.get(name)
    },
  },
  on(name, callback) {
    const values = listeners.get(name) ?? []
    values.push(callback)
    listeners.set(name, values)
    return () => {}
  },
}

apply(ctx)
assert.equal(typeof listener('agent/created'), 'function')
assert.equal(typeof listener('agent/session-start'), 'function')
assert.equal(typeof listener('agent/request'), 'function')

const root = agent('root')
listener('agent/created')({ agent: root })
const wrapper = wrapperFor(root, 'subagent')
const forkWrapper = wrapperFor(root, 'subagent_fork')
assert.ok(wrapper)
assert.ok(forkWrapper)
assert.equal(wrapper.name, 'subagent')
assert.equal(forkWrapper.name, 'subagent_fork')
assert.equal(wrapper.parameters.properties.provider.type, 'string')
assert.equal(wrapper.parameters.properties.model.type, 'string')
assert.equal(wrapper.parameters.properties.reasoning_effort.type, 'string')

const perCall = await wrapper.execute({
  description: 'route check',
  prompt: 'do work',
  provider: 'selected-provider',
  model: 'selected-model',
  reasoning_effort: 'max',
  run_in_background: true,
}, { agent: root, signal: new AbortController().signal })
assert.deepEqual(perCall.args, {
  description: 'route check',
  prompt: 'do work',
  run_in_background: true,
})
assert.deepEqual(perCall.config, {
  provider: 'selected-provider',
  model: 'selected-model',
  reasoningEffort: 'max',
})

const defaults = await wrapper.execute({ description: 'defaults', prompt: 'do work' }, {})
assert.deepEqual(defaults.config, {
  provider: 'default-provider',
  model: 'default-model',
  reasoningEffort: 'high',
})

const providerDefault = await wrapper.execute({
  description: 'provider default',
  prompt: 'do work',
  reasoning_effort: 'provider-default',
}, {})
assert.deepEqual(providerDefault.config, {
  provider: 'default-provider',
  model: 'default-model',
})

await assert.rejects(
  wrapper.execute({ description: 'bad route', prompt: 'do work', provider: 'only-provider' }, {}),
  /provider and model must be supplied together/,
)

stored = { provider: '', model: '', reasoningEffort: '' }
const inherited = await wrapper.execute({ description: 'inherit', prompt: 'do work' }, {})
assert.deepEqual(inherited.config, { provider: 'parent-provider', model: 'parent-model' })

stored = { provider: 'new-default', model: 'new-model', reasoningEffort: 'max' }
const resumed = agent('resumed', { subagent: true })
listener('agent/created')({ agent: resumed })
listener('agent/session-start')({ agent: resumed, source: 'resume' })
const resumedConfig = await listener('agent/request')(
  { agent: resumed },
  async () => ({ provider: 'persisted-provider', model: 'persisted-model', reasoningEffort: 'low' }),
)
assert.deepEqual(resumedConfig, {
  provider: 'persisted-provider',
  model: 'persisted-model',
  reasoningEffort: 'low',
})

console.log('configurable-subagents smoke test passed')
