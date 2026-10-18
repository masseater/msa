import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";

import type { TodoItem } from "./utils.ts";

export const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
export const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

export interface PlanModeEntry {
  enabled: boolean;
  todos?: TodoItem[];
  executing?: boolean;
  toolsBeforePlanMode?: string[];
}

export interface PlanRuntime {
  enabled: boolean;
  executing: boolean;
  todos: TodoItem[];
  toolsBeforePlanMode: string[] | undefined;
}

export interface PlanStore {
  readonly runtime: PlanRuntime;
  updateStatus(ctx: ExtensionContext): void;
  enableTools(): void;
  restoreTools(): void;
  persist(): void;
  toggle(ctx: ExtensionContext): void;
  restore(entry: PlanModeEntry | undefined, ctx: ExtensionContext): void;
}

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

const todoWidgetLines = (ctx: ExtensionContext, todos: TodoItem[]): string[] =>
  todos.map((item) =>
    item.completed
      ? ctx.ui.theme.fg("success", "☑ ") +
        ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
      : `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`,
  );

const updateStatus = (ctx: ExtensionContext, runtime: PlanRuntime): void => {
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

const enableTools = (msa: ExtensionAPI, runtime: PlanRuntime): void => {
  if (runtime.toolsBeforePlanMode === undefined) {
    runtime.toolsBeforePlanMode = msa.getActiveTools();
  }
  msa.setActiveTools(getPlanModeTools(runtime.toolsBeforePlanMode));
};

const restoreTools = (msa: ExtensionAPI, runtime: PlanRuntime): void => {
  msa.setActiveTools(runtime.toolsBeforePlanMode ?? getNormalModeTools(msa.getActiveTools()));
  runtime.toolsBeforePlanMode = undefined;
};

const persist = (msa: ExtensionAPI, runtime: PlanRuntime): void => {
  msa.appendEntry("plan-mode", {
    enabled: runtime.enabled,
    todos: runtime.todos,
    executing: runtime.executing,
    ...(runtime.toolsBeforePlanMode === undefined
      ? {}
      : { toolsBeforePlanMode: runtime.toolsBeforePlanMode }),
  } satisfies PlanModeEntry);
};

const toggle = (msa: ExtensionAPI, runtime: PlanRuntime, ctx: ExtensionContext): void => {
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
  msa: ExtensionAPI,
  runtime: PlanRuntime,
  entry: PlanModeEntry | undefined,
  ctx: ExtensionContext,
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

export const createPlanStore = (msa: ExtensionAPI): PlanStore => {
  const runtime: PlanRuntime = {
    enabled: false,
    executing: false,
    todos: [],
    toolsBeforePlanMode: undefined,
  };

  return {
    runtime,
    updateStatus: (ctx) => updateStatus(ctx, runtime),
    enableTools: () => enableTools(msa, runtime),
    restoreTools: () => restoreTools(msa, runtime),
    persist: () => persist(msa, runtime),
    toggle: (ctx) => toggle(msa, runtime, ctx),
    restore: (entry, ctx) => restore(msa, runtime, entry, ctx),
  };
};
