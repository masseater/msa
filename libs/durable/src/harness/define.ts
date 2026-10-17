import type { TSchema } from "@msa/ai";
import type { JsonValue } from "@msa/chord";

import type {
  AnyTask,
  Extension,
  HookRegistration,
  HooksOf,
  PromptSection,
  ToolRegistration,
  Wrap,
} from "./types.ts";

/**
 * Identity function that types an extension.
 * @param {Extension<Tool>} extension - The extension.
 * @returns {Extension<Tool>} The extension.
 */
export function defineExtension<Tool extends ToolRegistration = ToolRegistration>(
  extension: Extension<Tool>,
): Extension<Tool> {
  return extension;
}

/**
 * Identity function that types a tool: `args` from `parameters`, details from what it reports.
 * @param {ToolRegistration<TParameters, TDetails>} tool - The tool.
 * @returns {ToolRegistration<TParameters, TDetails>} The tool.
 */
export function defineTool<TParameters extends TSchema, TDetails extends JsonValue = JsonValue>(
  tool: ToolRegistration<TParameters, TDetails>,
): ToolRegistration<TParameters, TDetails> {
  return tool;
}

/**
 * A prompt section; tagged unless `tag` is false.
 * @param {string} key - The section key.
 * @param {PromptSection<Tool>["render"]} render - Renders it.
 * @param {{ readonly tag?: boolean }} options - Whether to tag it.
 * @returns {PromptSection<Tool>} The section.
 */
export function section<Tool extends ToolRegistration = ToolRegistration>(
  key: string,
  render: PromptSection<Tool>["render"],
  options?: { readonly tag?: boolean },
): PromptSection<Tool> {
  return options?.tag === undefined ? { key, render } : { key, render, tag: options.tag };
}

/**
 * Hook handlers for tasks with `task`'s name.
 * @param {K} task - The task.
 * @param {Partial<HooksOf<K>>} handlers - The handlers.
 * @returns {HookRegistration} The registration.
 */
export function hook<K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration {
  return { task: task.definition.name, handlers };
}

/**
 * Wrap the tool named like `tool` wherever the wrapping extension is selected.
 * @param {Tool} tool - The tool.
 * @param {(tool: Tool) => Tool} wrapper - Wraps it.
 * @returns {Wrap<Tool>} The wrap.
 */
export function wrapTool<Tool extends ToolRegistration>(
  tool: Tool,
  wrapper: (tool: Tool) => Tool,
): Wrap<Tool> {
  return { tool: tool.name, wrap: wrapper };
}

/**
 * Wrap the section `key` wherever the wrapping extension is selected.
 * @param {string} key - The section key.
 * @param {(section: PromptSection<Tool>) => PromptSection<Tool>} wrapper - Wraps it.
 * @returns {Wrap<Tool>} The wrap.
 */
export function wrapSection<Tool extends ToolRegistration = ToolRegistration>(
  key: string,
  wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>,
): Wrap<Tool> {
  return { section: key, wrap: wrapper };
}
