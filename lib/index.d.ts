import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
declare const name = "configurable-subagents";
declare const inject: string[];
interface SettingsSection {
  provider: string;
  model: string;
  reasoningEffort: string;
}
declare function apply(ctx: Context): void;
//#endregion
export { SettingsSection, apply, inject, name };