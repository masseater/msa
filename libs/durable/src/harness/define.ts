import type { TSchema } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";
import { Function } from "effect";

import type {
  AnyTask,
  Extension,
  HookRegistration,
  HooksOf,
  PromptInput,
  PromptSection,
  ToolRegistration,
  Wrap,
} from "./types.ts";

export function defineExtension<Tool extends ToolRegistration = ToolRegistration>(
  extension: Extension<Tool>,
): Extension<Tool> {
  return extension;
}

export function defineTool<TParameters extends TSchema, TDetails extends JsonValue = JsonValue>(
  tool: ToolRegistration<TParameters, TDetails>,
): ToolRegistration<TParameters, TDetails> {
  return tool;
}

type SectionOptions = { readonly tag?: boolean };

type SectionRender<Tool extends ToolRegistration> = (
  input: PromptInput<Tool>,
  context: Context,
) => string | undefined | Promise<string | undefined>;

type Section = {
  <Tool extends ToolRegistration = ToolRegistration>(
    render: SectionRender<Tool>,
    options?: SectionOptions,
  ): (key: string) => PromptSection<Tool>;
  <Tool extends ToolRegistration = ToolRegistration>(
    key: string,
    render: SectionRender<Tool>,
    options?: SectionOptions,
  ): PromptSection<Tool>;
};

export const section: Section = Function.dual(
  (args: IArguments) => typeof args[0] === "string",
  <Tool extends ToolRegistration>(
    key: string,
    render: SectionRender<Tool>,
    options?: SectionOptions,
  ): PromptSection<Tool> =>
    options?.tag === undefined ? { key, render } : { key, render, tag: options.tag },
);

export const hook: {
  <K extends AnyTask>(handlers: Partial<HooksOf<K>>): (task: K) => HookRegistration;
  <K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration;
} = Function.dual(
  2,
  <K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration => ({
    task: task.definition.name,
    handlers,
  }),
);

export const wrapTool: {
  <Tool extends ToolRegistration>(wrapper: (tool: Tool) => Tool): (tool: Tool) => Wrap<Tool>;
  <Tool extends ToolRegistration>(tool: Tool, wrapper: (tool: Tool) => Tool): Wrap<Tool>;
} = Function.dual(
  2,
  <Tool extends ToolRegistration>(tool: Tool, wrapper: (tool: Tool) => Tool): Wrap<Tool> => ({
    tool: tool.name,
    wrap: wrapper,
  }),
);

export const wrapSection: {
  <Tool extends ToolRegistration = ToolRegistration>(
    wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>,
  ): (key: string) => Wrap<Tool>;
  <Tool extends ToolRegistration = ToolRegistration>(
    key: string,
    wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>,
  ): Wrap<Tool>;
} = Function.dual(
  2,
  <Tool extends ToolRegistration>(
    key: string,
    wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>,
  ): Wrap<Tool> => ({ section: key, wrap: wrapper }),
);
