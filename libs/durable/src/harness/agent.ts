import { Function } from "effect";

import agentState from "./agent-state.ts";
import agentTools from "./agent-tools.ts";
import type typesModule from "./types.types.ts";

const { applyWrap, filterTools, offeredTools, selectExtensions } = agentTools;
const { INSTRUCTIONS_KEY } = agentState;

const agentHooks: typesModule.Dual2<typesModule.Agent, string, object[]> = Function.dual(
  2,
  (agent: typesModule.Agent, taskName: string): object[] => {
    const handlers: object[] = [];
    for (const extension of agent.extensions) {
      for (const hook of extension.hooks ?? [])
        if (hook.task === taskName) handlers.push(hook.handlers);
    }
    return handlers;
  },
);

type Composed<Tool extends typesModule.ToolRegistration> = {
  readonly tools: Map<string, Tool>;
  readonly sections: Map<string, typesModule.PromptSection<Tool>>;
};

const compose = <Tool extends typesModule.ToolRegistration>(
  extensions: readonly typesModule.Extension<Tool>[],
  report: (error: unknown) => void,
): Composed<Tool> => {
  const tools = new Map<string, Tool>();
  for (const extension of extensions)
    for (const tool of extension.tools ?? []) tools.set(tool.name, tool);
  const sections = new Map<string, typesModule.PromptSection<Tool>>();
  for (const extension of extensions)
    for (const section of extension.sections ?? []) sections.set(section.key, section);
  for (const extension of extensions) {
    for (const wrap of extension.wraps ?? []) {
      if ("tool" in wrap)
        applyWrap(
          tools,
          wrap.tool,
          (tool) => wrap.wrap(tool),
          (tool) => tool.name,
          report,
        );
      else
        applyWrap(
          sections,
          wrap.section,
          (section) => wrap.wrap(section),
          (section) => section.key,
          report,
        );
    }
  }
  return { sections, tools };
};

const callableBy =
  <Tool extends typesModule.ToolRegistration>(caller: "model" | "tools") =>
  (tool: Tool): boolean =>
    tool.callers === undefined || tool.callers.includes(caller);

const resolveAgent: {
  <Tool extends typesModule.ToolRegistration>(
    snapshot: typesModule.RegistrySnapshot<Tool>,
    settings: typesModule.Settings,
    report: (error: unknown) => void,
  ): (state: Readonly<typesModule.AgentState> | undefined) => typesModule.Agent<Tool>;
  <Tool extends typesModule.ToolRegistration>(
    state: Readonly<typesModule.AgentState> | undefined,
    snapshot: typesModule.RegistrySnapshot<Tool>,
    settings: typesModule.Settings,
    report: (error: unknown) => void,
  ): typesModule.Agent<Tool>;
} = Function.dual(
  4,
  <Tool extends typesModule.ToolRegistration>(
    state: Readonly<typesModule.AgentState> | undefined,
    snapshot: typesModule.RegistrySnapshot<Tool>,
    settings: typesModule.Settings,
    report: (error: unknown) => void,
  ): typesModule.Agent<Tool> => {
    const extensions = selectExtensions(state?.extensions, snapshot, settings);
    const composed = compose(extensions, report);
    const enabled = filterEnabled([...composed.tools.values()], state);
    const modelCallable = enabled.filter(callableBy<Tool>("model"));
    const tools = offeredTools(modelCallable, state?.modelTools);
    const offered = new Set(tools);
    const deferred = modelCallable.filter((tool) => tool.deferred === true && !offered.has(tool));
    const callable = enabled.filter(callableBy<Tool>("tools"));
    const instructions = state?.instructions;
    const sections = [...composed.sections.values()];
    if (instructions !== undefined)
      sections.push({ key: INSTRUCTIONS_KEY, render: () => instructions });
    return {
      ...(state?.model === undefined ? {} : { model: state.model }),
      callable,
      deferred,
      extensions,
      sections,
      thinkingLevel: state?.thinkingLevel ?? "off",
      tools,
      ...(instructions === undefined ? {} : { instructions }),
      ...(state?.cwd === undefined ? {} : { cwd: state.cwd }),
    };
  },
);

const filterEnabled = <Tool extends typesModule.ToolRegistration>(
  tools: Tool[],
  state: Readonly<typesModule.AgentState> | undefined,
): Tool[] => filterTools(tools, state?.tools);

const agentModule = {
  AgentDoc: agentState.AgentDoc,
  DEFAULT_COMPACTION_POLICY: agentState.DEFAULT_COMPACTION_POLICY,
  DEFAULT_PROGRESS_POLICY: agentState.DEFAULT_PROGRESS_POLICY,
  DEFAULT_RETRY_POLICY: agentState.DEFAULT_RETRY_POLICY,
  INSTRUCTIONS_KEY: agentState.INSTRUCTIONS_KEY,
  addTools: agentState.addTools,
  agentHooks,
  configure: agentState.configure,
  createAgent: agentState.createAgent,
  resolveAgent,
  resolveSettings: agentState.resolveSettings,
};

export default agentModule;
