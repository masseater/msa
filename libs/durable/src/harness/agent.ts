import { Function } from "effect";

import { INSTRUCTIONS_KEY } from "./agent-state.ts";
import { applyWrap, filterTools, offeredTools, selectExtensions } from "./agent-tools.ts";
import type {
  Agent,
  AgentState,
  Dual2,
  Extension,
  PromptSection,
  RegistrySnapshot,
  Settings,
  ToolRegistration,
} from "./types.ts";

export {
  AgentDoc,
  addTools,
  configure,
  createAgent,
  DEFAULT_COMPACTION_POLICY,
  DEFAULT_PROGRESS_POLICY,
  DEFAULT_RETRY_POLICY,
  INSTRUCTIONS_KEY,
  resolveSettings,
} from "./agent-state.ts";

export const agentHooks: Dual2<Agent, string, object[]> = Function.dual(
  2,
  (agent: Agent, taskName: string): object[] => {
    const handlers: object[] = [];
    for (const extension of agent.extensions) {
      for (const hook of extension.hooks ?? [])
        if (hook.task === taskName) handlers.push(hook.handlers);
    }
    return handlers;
  },
);

type Composed<Tool extends ToolRegistration> = {
  readonly tools: Map<string, Tool>;
  readonly sections: Map<string, PromptSection<Tool>>;
};

const compose = <Tool extends ToolRegistration>(
  extensions: readonly Extension<Tool>[],
  report: (error: unknown) => void,
): Composed<Tool> => {
  const tools = new Map<string, Tool>();
  for (const extension of extensions)
    for (const tool of extension.tools ?? []) tools.set(tool.name, tool);
  const sections = new Map<string, PromptSection<Tool>>();
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
  return { tools, sections };
};

const callableBy =
  <Tool extends ToolRegistration>(caller: "model" | "tools") =>
  (tool: Tool): boolean =>
    tool.callers === undefined || tool.callers.includes(caller);

export const resolveAgent: {
  <Tool extends ToolRegistration>(
    snapshot: RegistrySnapshot<Tool>,
    settings: Settings,
    report: (error: unknown) => void,
  ): (state: Readonly<AgentState> | undefined) => Agent<Tool>;
  <Tool extends ToolRegistration>(
    state: Readonly<AgentState> | undefined,
    snapshot: RegistrySnapshot<Tool>,
    settings: Settings,
    report: (error: unknown) => void,
  ): Agent<Tool>;
} = Function.dual(
  4,
  <Tool extends ToolRegistration>(
    state: Readonly<AgentState> | undefined,
    snapshot: RegistrySnapshot<Tool>,
    settings: Settings,
    report: (error: unknown) => void,
  ): Agent<Tool> => {
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
      thinkingLevel: state?.thinkingLevel ?? "off",
      extensions,
      tools,
      callable,
      deferred,
      sections,
      ...(instructions === undefined ? {} : { instructions }),
      ...(state?.cwd === undefined ? {} : { cwd: state.cwd }),
    };
  },
);

const filterEnabled = <Tool extends ToolRegistration>(
  tools: Tool[],
  state: Readonly<AgentState> | undefined,
): Tool[] => filterTools(tools, state?.tools);
