import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const listeners = new Map()
const wrappers = new WeakMap()
const sections = []
let toolVisible = true
let stored = {
  provider: 'default-provider',
  model: 'default-model',
  reasoningEffort: 'high',
  maxConcurrent: 4,
  allowedModels: [],
  singleLevel: true,
}

const listener = name => listeners.get(name)?.[0]

function emit(name, payload) {
  for (const callback of listeners.get(name) ?? []) callback(payload)
}

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

const promptCtx = {
  systemPrompt: {
    section(definition) {
      sections.push(definition)
      return () => {
        const index = sections.indexOf(definition)
        if (index >= 0) sections.splice(index, 1)
      }
    },
  },
  tools: {
    get(name) {
      return toolVisible && (name === 'subagent' || name === 'subagent_fork') ? originals.get(name) : undefined
    },
  },
}

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
  inject(names, callback) {
    if (names.includes('systemPrompt')) callback(promptCtx)
    return () => {}
  },
}

apply(ctx)
assert.equal(typeof listener('agent/created'), 'function')
assert.equal(typeof listener('agent/session-start'), 'function')
assert.equal(typeof listener('agent/request'), 'function')
assert.equal(typeof listener('subagent/start'), 'function')
assert.equal(typeof listener('subagent/end'), 'function')

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

// --- Tool-guidance section (orders 100-199) --------------------------------
assert.equal(sections.length, 1)
const section = sections[0]
assert.equal(section.name, 'tool:subagent-routing')
assert.ok(section.order >= 100 && section.order <= 199, 'the section belongs to the tool-guidance band')
const guidance = section.text({})
assert.match(guidance, /provider/)
assert.match(guidance, /reasoning_effort/)
assert.match(guidance, /default-provider\/default-model/)
assert.match(guidance, /At most 4 sub-agents run at once/)
assert.match(guidance, /Delegation is one level deep/)

toolVisible = false
assert.equal(section.text({}), '', 'guidance is omitted while no sub-agent tool is visible')
toolVisible = true

// --- Per-call routing ------------------------------------------------------
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

stored = { ...stored, provider: '', model: '', reasoningEffort: '' }
const inherited = await wrapper.execute({ description: 'inherit', prompt: 'do work' }, {})
assert.deepEqual(inherited.config, { provider: 'parent-provider', model: 'parent-model' })

stored = { ...stored, provider: 'new-default', model: 'new-model', reasoningEffort: 'max' }
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

// --- Model allowlist -------------------------------------------------------
stored = {
  provider: 'not-allowed',
  model: 'not-allowed-model',
  reasoningEffort: '',
  maxConcurrent: 4,
  allowedModels: [{ provider: 'allowed-a', model: 'model-a' }, { provider: 'allowed-b', model: 'model-b' }],
  singleLevel: true,
}
const forced = await wrapper.execute({ description: 'forced', prompt: 'do work' }, {})
assert.deepEqual(forced.config, { provider: 'allowed-a', model: 'model-a' })

const allowedExplicit = await wrapper.execute({
  description: 'allowed',
  prompt: 'do work',
  provider: 'allowed-b',
  model: 'model-b',
}, {})
assert.deepEqual(allowedExplicit.config, { provider: 'allowed-b', model: 'model-b' })

await assert.rejects(
  wrapper.execute({
    description: 'blocked',
    prompt: 'do work',
    provider: 'rogue',
    model: 'rogue-model',
  }, {}),
  /not an allowed sub-agent model/,
)

stored = { ...stored, allowedModels: [] }
const unrestricted = await wrapper.execute({
  description: 'unrestricted',
  prompt: 'do work',
  provider: 'rogue',
  model: 'rogue-model',
}, {})
assert.deepEqual(unrestricted.config, { provider: 'rogue', model: 'rogue-model' })

// --- Concurrency cap -------------------------------------------------------
stored = {
  provider: '',
  model: '',
  reasoningEffort: '',
  maxConcurrent: 2,
  allowedModels: [],
  singleLevel: true,
}
emit('subagent/start', { runId: 'run-1' })
emit('subagent/start', { runId: 'run-2' })
await assert.rejects(
  wrapper.execute({ description: 'over cap', prompt: 'do work' }, {}),
  /concurrency limit reached: 2 of 2/,
)
assert.match(section.text({}), /At most 2 sub-agents run at once/)
emit('subagent/end', { runId: 'run-1' })
const afterSettle = await wrapper.execute({ description: 'under cap', prompt: 'do work' }, {})
assert.deepEqual(afterSettle.config, { provider: 'parent-provider', model: 'parent-model' })
emit('subagent/end', { runId: 'run-2' })

// --- One level deep --------------------------------------------------------
stored = { ...stored, maxConcurrent: 4, singleLevel: true }
const depthChild = agent('depth-child', { subagent: true })
listener('agent/created')({ agent: depthChild })
const childWrapper = wrapperFor(depthChild, 'subagent')
assert.ok(childWrapper)
await assert.rejects(
  childWrapper.execute({ description: 'nested', prompt: 'do work' }, { agent: depthChild }),
  /sub-agents may not delegate further/,
)
assert.match(section.text({}), /must not start its own children/)

stored = { ...stored, singleLevel: false }
const nested = await childWrapper.execute({ description: 'nested', prompt: 'do work' }, { agent: depthChild })
assert.deepEqual(nested.config, { provider: 'parent-provider', model: 'parent-model' })
assert.doesNotMatch(section.text({}), /must not start its own children/)

console.log('configurable-subagents smoke test passed')
