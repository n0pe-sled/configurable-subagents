window.__ModuleLoader__.load({
	id: "dsh-configurable-subagents",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/SettingsPanel.tsx
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				padding: "16px 20px",
				maxWidth: "720px"
			},
			title: {
				margin: 0,
				fontSize: "15px",
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			},
			copy: {
				margin: 0,
				fontSize: "12px",
				lineHeight: 1.5,
				color: "var(--dsw-alias-label-tertiary)"
			},
			grid: {
				display: "grid",
				gridTemplateColumns: "minmax(150px, 210px) minmax(260px, 1fr)",
				gap: "12px 16px",
				alignItems: "center",
				padding: "14px",
				background: "var(--dsw-alias-bg-layer-0)",
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "10px"
			},
			label: {
				fontSize: "13px",
				fontWeight: 500,
				color: "var(--dsw-alias-label-secondary)"
			},
			input: {
				width: "100%",
				padding: "8px 10px",
				boxSizing: "border-box",
				fontSize: "13px",
				color: "var(--dsw-alias-label-primary)",
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "7px"
			},
			actions: {
				display: "flex",
				alignItems: "center",
				gap: "10px"
			},
			button: {
				padding: "7px 14px",
				fontSize: "13px",
				border: "none",
				borderRadius: "6px",
				color: "var(--dsw-alias-label-primary-foreground)",
				background: "var(--dsw-alias-button-primary-fill)",
				cursor: "pointer"
			},
			disabled: {
				opacity: .45,
				cursor: "not-allowed"
			},
			status: {
				margin: 0,
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary)"
			},
			error: {
				margin: 0,
				fontSize: "12px",
				color: "var(--dsw-alias-interactive-bg-hover-danger)"
			}
		};
		const EMPTY_VALUES = {
			provider: "",
			model: "",
			reasoningEffort: ""
		};
		function SubagentSettingsPanel(props) {
			const snapshot = props.useConfigurableSubagentSettings((value) => value);
			const stored = {
				provider: snapshot.value?.provider ?? "",
				model: snapshot.value?.model ?? "",
				reasoningEffort: snapshot.value?.reasoningEffort ?? ""
			};
			const [draft, setDraft] = (0, react.useState)(EMPTY_VALUES);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [outcome, setOutcome] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!dirty) setDraft(stored);
			}, [snapshot.value, dirty]);
			const update = (field, value) => {
				setDraft((current) => ({
					...current,
					[field]: value
				}));
				setDirty(true);
				setOutcome(null);
			};
			const save = async () => {
				setSaving(true);
				setOutcome(null);
				try {
					const result = await props.save(draft);
					setOutcome(result);
					if (result.status === "saved") setDirty(false);
				} finally {
					setSaving(false);
				}
			};
			const ready = snapshot.status === "ready";
			const disabled = !ready || saving || !dirty;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: styles.title,
						children: "Sub-agent defaults"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.copy,
						children: "These values apply when a subagent call does not select its own route. Leave provider and model blank to inherit the parent route. Leave reasoning effort blank to use the model provider's default."
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.grid,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: "configurable-subagent-provider",
								style: styles.label,
								children: "Provider"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "configurable-subagent-provider",
								style: styles.input,
								value: draft.provider,
								placeholder: "deepseek-official",
								disabled: !ready || saving,
								onChange: (event) => update("provider", event.currentTarget.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: "configurable-subagent-model",
								style: styles.label,
								children: "Model"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "configurable-subagent-model",
								style: styles.input,
								value: draft.model,
								placeholder: "deepseek-v4-flash",
								disabled: !ready || saving,
								onChange: (event) => update("model", event.currentTarget.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: "configurable-subagent-effort",
								style: styles.label,
								children: "Reasoning effort"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "configurable-subagent-effort",
								style: styles.input,
								value: draft.reasoningEffort,
								placeholder: "off, low, high, max, or another adapter value",
								disabled: !ready || saving,
								onChange: (event) => update("reasoningEffort", event.currentTarget.value)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.copy,
						children: "Per-call provider and model must be supplied together. A call can set reasoning_effort to provider-default to bypass the saved effort."
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.actions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...styles.button,
									...disabled ? styles.disabled : {}
								},
								disabled,
								onClick: () => {
									save();
								},
								children: saving ? "Saving…" : "Save defaults"
							}),
							outcome?.status === "saved" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.status,
								children: "Saved."
							}),
							outcome?.status === "not-applied" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.error,
								children: "The host did not apply all values."
							}),
							outcome?.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.error,
								children: outcome.message
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "settingsScope"];
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: "configurable-subagents" });
			const save = async (values) => {
				try {
					await scope.set("provider", values.provider);
					await scope.set("model", values.model);
					await scope.set("reasoningEffort", values.reasoningEffort);
				} catch (error) {
					return {
						status: "error",
						message: error instanceof Error ? error.message : String(error)
					};
				}
				const stored = scope.getSnapshot().value;
				return stored?.provider === values.provider && stored.model === values.model && stored.reasoningEffort === values.reasoningEffort ? { status: "saved" } : { status: "not-applied" };
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "configurable-subagents",
				order: 210,
				label: "Sub-agents",
				inject: () => ({
					hooks: { configurableSubagentSettings: scope },
					save
				})
			}, SubagentSettingsPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map