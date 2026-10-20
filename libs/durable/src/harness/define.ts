import type { TSchema } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";
import { Function } from "effect";

import type typesModule from "./types.types.ts";

function defineExtension<Tool extends typesModule.ToolRegistration = typesModule.ToolRegistration>(
  extension: typesModule.Extension<Tool>,
): typesModule.Extension<Tool> {
  return extension;
}

function defineTool<TParameters extends TSchema, TDetails extends JsonValue = JsonValue>(
  tool: typesModule.ToolRegistration<TParameters, TDetails>,
): typesModule.ToolRegistration<TParameters, TDetails> {
  return tool;
}

type SectionOptions = { readonly tag?: boolean };

type SectionRender<Tool extends typesModule.ToolRegistration> = (
  input: typesModule.PromptInput<Tool>,
  context: Context,
) => string | undefined | Promise<string | undefined>;

type Section = {
  <Tool extends typesModule.ToolRegistration = typesModule.ToolRegistration>(
    render: SectionRender<Tool>,
    options?: SectionOptions,
  ): (key: string) => typesModule.PromptSection<Tool>;
  <Tool extends typesModule.ToolRegistration = typesModule.ToolRegistration>(
    key: string,
    render: SectionRender<Tool>,
    options?: SectionOptions,
  ): typesModule.PromptSection<Tool>;
};

const section: Section = Function.dual(
  (args: IArguments) => typeof args[0] === "string",
  <Tool extends typesModule.ToolRegistration>(
    key: string,
    render: SectionRender<Tool>,
    options?: SectionOptions,
  ): typesModule.PromptSection<Tool> =>
    options?.tag === undefined ? { key, render } : { key, render, tag: options.tag },
);

const hook: {
  <K extends typesModule.AnyTask>(
    handlers: Partial<typesModule.HooksOf<K>>,
  ): (task: K) => typesModule.HookRegistration;
  <K extends typesModule.AnyTask>(
    task: K,
    handlers: Partial<typesModule.HooksOf<K>>,
  ): typesModule.HookRegistration;
} = Function.dual(
  2,
  <K extends typesModule.AnyTask>(
    task: K,
    handlers: Partial<typesModule.HooksOf<K>>,
  ): typesModule.HookRegistration => ({
    handlers,
    task: task.definition.name,
  }),
);

const wrapTool: {
  <Tool extends typesModule.ToolRegistration>(
    wrapper: (tool: Tool) => Tool,
  ): (tool: Tool) => typesModule.Wrap<Tool>;
  <Tool extends typesModule.ToolRegistration>(
    tool: Tool,
    wrapper: (tool: Tool) => Tool,
  ): typesModule.Wrap<Tool>;
} = Function.dual(
  2,
  <Tool extends typesModule.ToolRegistration>(
    tool: Tool,
    wrapper: (tool: Tool) => Tool,
  ): typesModule.Wrap<Tool> => ({
    tool: tool.name,
    wrap: wrapper,
  }),
);

const wrapSection: {
  <Tool extends typesModule.ToolRegistration = typesModule.ToolRegistration>(
    wrapper: (section: typesModule.PromptSection<Tool>) => typesModule.PromptSection<Tool>,
  ): (key: string) => typesModule.Wrap<Tool>;
  <Tool extends typesModule.ToolRegistration = typesModule.ToolRegistration>(
    key: string,
    wrapper: (section: typesModule.PromptSection<Tool>) => typesModule.PromptSection<Tool>,
  ): typesModule.Wrap<Tool>;
} = Function.dual(
  2,
  <Tool extends typesModule.ToolRegistration>(
    key: string,
    wrapper: (section: typesModule.PromptSection<Tool>) => typesModule.PromptSection<Tool>,
  ): typesModule.Wrap<Tool> => ({ section: key, wrap: wrapper }),
);

const define = {
  defineExtension,
  defineTool,
  hook,
  section,
  wrapSection,
  wrapTool,
};

export default define;
