# dsh-configurable-subagents

Choose the LLM provider, model, and reasoning effort used by in-process DeepSeek Harness sub-agents. The plugin keeps the existing `subagent` and `subagent_fork` tool contracts intact and adds three optional arguments:

- `provider`
- `model`
- `reasoning_effort`

It also adds **Settings > Sub-agents**, where you can save defaults for those fields.

## Install

```bash
dsh plugin --profile web add /path/to/deepseek-harness-plugins/configurable-subagents
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

Open **Settings > Sub-agents** after restarting the GUI.

- Leave provider and model blank to inherit the parent route.
- Set both fields to give new sub-agents a different default route.
- Leave reasoning effort blank to use the adapter default.
- Per-call fields override saved defaults.

The defaults also apply to fresh in-process sub-agents started through other Harness paths, including workflows. A resumed sub-agent keeps the route recorded in its request history instead of adopting newly changed defaults.

## Compatibility

The plugin shadows the existing `subagent` and `subagent_fork` definitions inside each agent scope, then delegates execution to the original tool body. Existing skills do not need payload changes. Existing foreground, background, continuation, cancellation, result rendering, and concurrency behavior stays with the shipped tools.

Native out-of-process products such as Codex and Claude Code manage their own model route and are not rewritten by this plugin.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

`lib/index.js` is the host bundle. `lib/client.js` is the Web client bundle.
