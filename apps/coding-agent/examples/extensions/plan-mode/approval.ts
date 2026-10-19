import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai";
import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { Effect } from "effect";

import type { PlanStore } from "./state.ts";
import { extractTodoItems, type TodoItem } from "./utils.ts";

const PLAN_CHOICES = ["Execute the plan (track progress)", "Stay in plan mode", "Refine the plan"];

const isAssistantMessage = (m: AgentMessage): m is AssistantMessage =>
  m.role === "assistant" && Array.isArray(m.content);

const getTextContent = (message: AssistantMessage): string =>
  message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const planMessage = (todos: TodoItem[]) => {
  const todoListText = todos.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
  return {
    customType: "plan-todo-list",
    content: `**Plan Steps (${todos.length}):**\n\n${todoListText}`,
    display: true,
  };
};

const startExecution = (
  msa: ExtensionAPI,
  store: PlanStore,
  ctx: ExtensionContext,
  planTodoListMessage: ReturnType<typeof planMessage>,
): void => {
  const { runtime } = store;
  const firstTodoItem = runtime.todos[0];
  if (firstTodoItem === undefined) return;

  runtime.enabled = false;
  runtime.executing = true;
  store.restoreTools();
  store.updateStatus(ctx);
  store.persist();

  const remainingList = runtime.todos.map((t) => `${t.step}. ${t.text}`).join("\n");
  const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
After completing a step, include a [DONE:n] tag in your response.`;

  msa.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
  msa.sendMessage(
    { customType: "plan-mode-execute", content: execMessage, display: true },
    { triggerTurn: true, deliverAs: "followUp" },
  );
};

const completeExecution = (msa: ExtensionAPI, store: PlanStore, ctx: ExtensionContext): boolean => {
  const { runtime } = store;
  if (!runtime.executing || runtime.todos.length === 0) return false;
  if (!runtime.todos.every((t) => t.completed)) return true;

  const completedList = runtime.todos.map((t) => `~~${t.text}~~`).join("\n");
  msa.sendMessage(
    {
      customType: "plan-complete",
      content: `**Plan Complete!** ✓\n\n${completedList}`,
      display: true,
    },
    { triggerTurn: false },
  );
  runtime.executing = false;
  runtime.todos = [];
  store.updateStatus(ctx);
  store.persist();
  return true;
};

const extractPlan = (store: PlanStore, ctx: ExtensionContext, messages: AgentMessage[]): void => {
  const { runtime } = store;
  if (!runtime.enabled || !ctx.hasUI) return;

  const lastAssistant = [...messages].reverse().find(isAssistantMessage);
  if (lastAssistant !== undefined) {
    const extracted = extractTodoItems(getTextContent(lastAssistant));
    if (extracted.length > 0) {
      runtime.todos = extracted;
    }
  }

  if (runtime.todos.length === 0) return;
  store.persist();
};

export const handleAgentEnd = (request: {
  readonly msa: ExtensionAPI;
  readonly store: PlanStore;
  readonly event: { messages: AgentMessage[] };
  readonly ctx: ExtensionContext;
}) =>
  Effect.gen(function* () {
    const { msa, store, event, ctx } = request;
    const { runtime } = store;

    if (completeExecution(msa, store, ctx)) return;

    extractPlan(store, ctx, event.messages);
    if (!runtime.enabled || runtime.todos.length === 0) return;

    const planTodoListMessage = planMessage(runtime.todos);
    const choice = yield* Effect.promise(() =>
      ctx.ui.select("Plan mode - what next?", PLAN_CHOICES),
    );

    if (choice?.startsWith("Execute") === true) {
      startExecution(msa, store, ctx, planTodoListMessage);
      return;
    }

    if (choice === "Refine the plan") {
      const refinement = yield* Effect.promise(() => ctx.ui.editor("Refine the plan:", ""));
      if (refinement !== undefined && refinement.trim().length > 0) {
        msa.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
        msa.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
      }
    }
  });
