# dsh-configurable-subagents

Choose the LLM provider, model, and reasoning effort used by in-process DeepSeek Harness sub-agents. The plugin keeps the existing `subagent` and `subagent_fork` tool contracts intact and adds three optional arguments:

- `provider`
- `model`
- `reasoning_effort`

It also adds **Settings > Sub-agents**, where you can save defaults for those fields, cap how many sub-agents run at once, restrict which models they may use, and keep delegation one level deep.

## Install

```bash
dsh plugin --profile web add /path/to/deepseek-harness/plugins/configurable-subagents
```

Restart `dsh web` after installation. The host must load the node plugin and serve the new browser bundle.

## Per-delegation selection

The installed tool accepts the old payload unchanged:

```json
{
  "description": "Review the parser",
  "prompt": "Find edge cases in the parser.",
  "run_in_background": true
}
```

A delegation can select its own route:

```json
{
  "description": "Deep parser review",
  "prompt": "Find edge cases in the parser.",
  "provider": "deepseek-official",
  "model": "deepseek-v4-pro",
  "reasoning_effort": "max",
  "run_in_background": true
}
```

`provider` and `model` must be supplied together. Reasoning effort identifiers belong to the selected adapter. Unsupported values fail through Harness model validation before provider I/O.

Set `reasoning_effort` to `provider-default` when a delegation should ignore the saved sub-agent effort and use the selected adapter's default.

## Saved defaults

Open **Settings > Sub-agents**.

- Leave provider and model blank to inherit the parent route.
- Set both fields to give new sub-agents a different default route.
- Leave reasoning effort blank to use the adapter default.
- Per-call fields override saved defaults.
- The rest of the panel — concurrency, the model allowlist, and the one-level switch — is described under [Limits](#limits).

The defaults also apply to fresh in-process sub-agents started through other Harness paths, including workflows. A resumed sub-agent keeps the route recorded in its request history instead of adopting newly changed defaults.

## Limits

The same panel enforces three limits, all of which the host applies and the model is told about in its tool guidance:

| Setting | Default | Effect |
|---|---|---|
| Max concurrent sub-agents | 4 (range 1–8) | A delegation that would exceed the cap is refused with an explanation and the current count, rather than queued. |
| Allowed sub-agent models | starts as the saved default model, when one is set | When non-empty, a delegation naming any other model is refused, and a delegation naming none runs on the first allowed model. |
| One level deep | on | A sub-agent may not start its own sub-agents; the refusal says how to allow nesting. |

The model picker searches the live host catalog (`llm.models`) and offers matches only while you search: type, then click a tag to allow that model. Allowed models stay listed as tags with an `×` to remove them, and **Clear all** returns to "any model". Until you save a list of your own, the list starts as the saved default model alone — a panel that opened on "any model" while a default is configured would say the opposite of what the deployment does. Clearing the list is remembered: an empty saved list means any model.

The setting is a draft until you press **Save settings**, as with the route defaults above.

The concurrency count is fed by the Harness `subagent/start` / `subagent/end` lifecycle pair, so a background child keeps its slot until it truly settles, and children started by other paths (workflows, continuations) are counted too. A call that passes the gate reserves its slot before the child is published, so two delegations dispatched in one step cannot overshoot the cap.

## Tool guidance

The plugin registers one system-prompt section, `tool:subagent-routing` at order 117 — inside the tool-guidance band (orders 100–199) the Harness documents for per-tool prose, just after the shipped `tool:subagent` section. It tells the model:

- that `subagent` and `subagent_fork` accept `provider`, `model`, and `reasoning_effort`, and that provider and model travel together;
- which route a delegation with no selection runs on, or that it inherits the parent's;
- the allowed models, when an allowlist is set;
- the concurrency cap, and that a sub-agent may not delegate further.

The text is resolved at each assembly from the live settings, so a saved change reaches the next step, and it is omitted entirely for a scope where no sub-agent tool is visible.

## Compatibility

The plugin shadows the existing `subagent` and `subagent_fork` definitions inside each agent scope, then delegates execution to the original tool body. Existing skills do not need payload changes. Existing foreground, background, continuation, cancellation, and result rendering stay with the shipped tools; the plugin adds only its routing arguments and the limits above.

The limits apply to delegations made through the two wrapped tools, whose parent agent the plugin can see. Workflow and other in-process paths still contribute to the concurrency count, but they are not subject to the allowlist or a route override.

Native out-of-process products such as Codex and Claude Code manage their own model route and are not rewritten by this plugin.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

`lib/index.js` is the host bundle. `lib/client.js` is the Web client bundle. A rebuilt client bundle is picked up by a page reload (or the `/reload` command); a change to the host half needs `dsh web` to be restarted.
