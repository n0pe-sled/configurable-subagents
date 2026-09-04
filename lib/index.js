import { AsyncLocalStorage } from "node:async_hooks";
import Schema from "@deepseek-ai/schemastery";
//#region src/index.ts
const name = "configurable-subagents";
const inject = ["settings", "tools"];
const NAMESPACE = "configurable-subagents";
const TOOL_NAMES = ["subagent", "subagent_fork"];
const PROVIDER_DEFAULT = "provider-default";
const settingsSchema = Schema.object({
	provider: Schema.string().default(""),
	model: Schema.string().default(""),
	reasoningEffort: Schema.string().default("")
});
function nonEmpty(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
function routingArguments(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	const record = value;
	const provider = nonEmpty(record.provider);
	const model = nonEmpty(record.model);
	const reasoningEffort = nonEmpty(record.reasoning_effort);
	return {
		...provider === void 0 ? {} : { provider },
		...model === void 0 ? {} : { model },
		...reasoningEffort === void 0 ? {} : { reasoning_effort: reasoningEffort }
	};
}
function baseArguments(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const { provider: _provider, model: _model, reasoning_effort: _reasoningEffort, ...base } = value;
	return base;
}
function defaultsOf(section) {
	const provider = nonEmpty(section?.provider);
	const model = nonEmpty(section?.model);
	if (provider === void 0 !== (model === void 0)) throw new Error("configurable subagent defaults require provider and model together");
	const effort = nonEmpty(section?.reasoningEffort);
	return {
		...provider === void 0 ? {} : { provider },
		...model === void 0 ? {} : { model },
		...effort === void 0 ? {} : { reasoningEffort: effort }
	};
}
function selectionOf(args, section) {
	const requested = routingArguments(args);
	if (requested.provider === void 0 !== (requested.model === void 0)) throw new Error("subagent provider and model must be supplied together");
	const defaults = defaultsOf(section);
	const route = requested.provider === void 0 ? defaults : {
		provider: requested.provider,
		model: requested.model
	};
	const requestedEffort = requested.reasoning_effort;
	const reasoningEffort = requestedEffort === PROVIDER_DEFAULT ? void 0 : requestedEffort ?? defaults.reasoningEffort;
	return {
		...route.provider === void 0 ? {} : { provider: route.provider },
		...route.model === void 0 ? {} : { model: route.model },
		...reasoningEffort === void 0 ? {} : { reasoningEffort }
	};
}
function hasRouting(selection) {
	return selection.provider !== void 0 || selection.model !== void 0 || selection.reasoningEffort !== void 0;
}
function extendParameters(parameters) {
	return {
		...parameters,
		additionalProperties: false,
		properties: {
			...parameters.properties,
			provider: {
				type: "string",
				description: "Optional LLM provider route for this child. Supply provider and model together."
			},
			model: {
				type: "string",
				description: "Optional model id for this child. Supply provider and model together."
			},
			reasoning_effort: {
				type: "string",
				description: `Optional adapter-owned reasoning effort for this child, such as low, high, or max. Use "${PROVIDER_DEFAULT}" to ignore the configured subagent default.`
			}
		}
	};
}
function createWrapper(original, settings, routing) {
	const toBase = (args) => baseArguments(args);
	return {
		...original,
		description: `${original.description} Optional provider, model, and reasoning_effort fields select the child's LLM route for this delegation.`,
		parameters: extendParameters(original.parameters),
		...original.isConcurrencySafe === void 0 ? {} : { isConcurrencySafe: (args) => original.isConcurrencySafe?.(toBase(args)) === true },
		async execute(args, exec) {
			const selected = selectionOf(args, settings());
			return routing.run(selected, () => original.execute(toBase(args), exec));
		}
	};
}
function apply(ctx) {
	const settings = ctx.settings.register(NAMESPACE, settingsSchema);
	const routing = new AsyncLocalStorage();
	const childRouting = /* @__PURE__ */ new WeakMap();
	const wrappers = /* @__PURE__ */ new WeakSet();
	ctx.on("agent/created", ({ agent }) => {
		for (const toolName of TOOL_NAMES) {
			let installed = false;
			let installing = false;
			const install = () => {
				if (installed || installing) return;
				const original = ctx.tools.get(toolName, agent);
				if (original === void 0 || wrappers.has(original)) return;
				installing = true;
				try {
					const wrapper = createWrapper(original, () => settings.get(), routing);
					wrappers.add(wrapper);
					agent.ctx.tools.register(wrapper);
					installed = true;
				} finally {
					installing = false;
				}
			};
			install();
			if (!installed) agent.ctx.on("tools/change", install);
		}
	});
	ctx.on("agent/session-start", ({ agent, source }) => {
		if (agent.session.header.origin !== "subagent" || source === "resume") return;
		const selected = routing.getStore() ?? defaultsOf(settings.get());
		if (hasRouting(selected)) childRouting.set(agent, selected);
	});
	ctx.on("agent/request", async ({ agent }, next) => {
		const config = await next();
		const selected = childRouting.get(agent);
		if (selected === void 0) return config;
		return {
			...config,
			...selected.provider === void 0 ? {} : { provider: selected.provider },
			...selected.model === void 0 ? {} : { model: selected.model },
			...selected.reasoningEffort === void 0 ? {} : { reasoningEffort: selected.reasoningEffort }
		};
	});
}
//#endregion
export { apply, inject, name };
