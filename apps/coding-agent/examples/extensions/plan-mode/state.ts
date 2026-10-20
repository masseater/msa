import type codingAgentTypes from "@msa/coding-agent/index.types";

import type stateTypes from "./state.types.ts";
import type utilsTypes from "./utils.types.ts";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

const uniqueToolNames = (toolNames: string[]): string[] => [...new Set(toolNames)];

const getPlanModeTools = (activeToolNames: string[]): string[] =>
  uniqueToolNames([
    ...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
    ...PLAN_MODE_TOOLS,
  ]);

const getNormalModeTools = (activeToolNames: string[]): string[] =>
  uniqueToolNames([
    ...NORMAL_MODE_TOOLS,
    ...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
  ]);

const todoWidgetLines = (
  ctx: codingAgentTypes.ExtensionContext,
  todos: utilsTypes.TodoItem[],
): string[] =>
  todos.map((item) =>
    item.completed
      ? ctx.ui.theme.fg("success", "☑ ") +
        ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
      : `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`,
  );

const updateStatus = (
  ctx: codingAgentTypes.ExtensionContext,
  runtime: stateTypes.PlanRuntime,
): void => {
  const showTodos = runtime.executing && runtime.todos.length > 0;
  if (showTodos) {
    const completed = runtime.todos.filter((t) => t.completed).length;
    ctx.ui.setStatus(
      "plan-mode",
      ctx.ui.theme.fg("accent", `📋 ${completed}/${runtime.todos.length}`),
    );
  } else if (runtime.enabled) {
    ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
  } else {
    ctx.ui.setStatus("plan-mode", undefined);
  }

  ctx.ui.setWidget("plan-todos", showTodos ? todoWidgetLines(ctx, runtime.todos) : undefined);
};

const enableTools = (msa: codingAgentTypes.ExtensionAPI, runtime: stateTypes.PlanRuntime): void => {
  if (runtime.toolsBeforePlanMode === undefined) {
    runtime.toolsBeforePlanMode = msa.getActiveTools();
  }
  msa.setActiveTools(getPlanModeTools(runtime.toolsBeforePlanMode));
};

const restoreTools = (
  msa: codingAgentTypes.ExtensionAPI,
  runtime: stateTypes.PlanRuntime,
): void => {
  msa.setActiveTools(runtime.toolsBeforePlanMode ?? getNormalModeTools(msa.getActiveTools()));
  runtime.toolsBeforePlanMode = undefined;
};

const persist = (msa: codingAgentTypes.ExtensionAPI, runtime: stateTypes.PlanRuntime): void => {
  msa.appendEntry("plan-mode", {
    enabled: runtime.enabled,
    executing: runtime.executing,
    todos: runtime.todos,
    ...(runtime.toolsBeforePlanMode === undefined
      ? {}
      : { toolsBeforePlanMode: runtime.toolsBeforePlanMode }),
  } satisfies stateTypes.PlanModeEntry);
};

const toggle = (
  msa: codingAgentTypes.ExtensionAPI,
  runtime: stateTypes.PlanRuntime,
  ctx: codingAgentTypes.ExtensionContext,
): void => {
  runtime.enabled = !runtime.enabled;
  runtime.executing = false;
  runtime.todos = [];

  if (runtime.enabled) {
    enableTools(msa, runtime);
    ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
  } else {
    restoreTools(msa, runtime);
    ctx.ui.notify("Plan mode disabled. Full access restored.");
  }
  updateStatus(ctx, runtime);
  persist(msa, runtime);
};

const restore = (
  msa: codingAgentTypes.ExtensionAPI,
  runtime: stateTypes.PlanRuntime,
  entry: stateTypes.PlanModeEntry | undefined,
  ctx: codingAgentTypes.ExtensionContext,
): void => {
  if (entry !== undefined) {
    runtime.enabled = entry.enabled;
    runtime.todos = entry.todos ?? runtime.todos;
    runtime.executing = entry.executing ?? runtime.executing;
    runtime.toolsBeforePlanMode = entry.toolsBeforePlanMode ?? runtime.toolsBeforePlanMode;
  }
  if (runtime.enabled) {
    enableTools(msa, runtime);
  }
  updateStatus(ctx, runtime);
};

const createPlanStore = (msa: codingAgentTypes.ExtensionAPI): stateTypes.PlanStore => {
  const runtime: stateTypes.PlanRuntime = {
    enabled: false,
    executing: false,
    todos: [],
    toolsBeforePlanMode: undefined,
  };

  return {
    enableTools: () => enableTools(msa, runtime),
    persist: () => persist(msa, runtime),
    restore: (entry, ctx) => restore(msa, runtime, entry, ctx),
    restoreTools: () => restoreTools(msa, runtime),
    runtime,
    toggle: (ctx) => toggle(msa, runtime, ctx),
    updateStatus: (ctx) => updateStatus(ctx, runtime),
  };
};

const state = {
  NORMAL_MODE_TOOLS,
  PLAN_MODE_TOOLS,
  createPlanStore,
};

export default state;
