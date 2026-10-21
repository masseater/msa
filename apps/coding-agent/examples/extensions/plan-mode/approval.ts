import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import type stateTypes from "./state.types.ts";
import utils from "./utils.ts";
import type utilsTypes from "./utils.types.ts";

const { extractTodoItems } = utils;

const PLAN_CHOICES = ["Execute the plan (track progress)", "Stay in plan mode", "Refine the plan"];

const isAssistantMessage = (m: agentTypes.AgentMessage): m is aiTypes.AssistantMessage =>
  m.role === "assistant" && Array.isArray(m.content);

const getTextContent = (message: aiTypes.AssistantMessage): string =>
  message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const planMessage = (todos: utilsTypes.TodoItem[]) => {
  const todoListText = todos.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
  return {
    content: `**Plan Steps (${todos.length}):**\n\n${todoListText}`,
    customType: "plan-todo-list",
    display: true,
  };
};

const startExecution = (
  msa: codingAgentTypes.ExtensionAPI,
  store: stateTypes.PlanStore,
  ctx: codingAgentTypes.ExtensionContext,
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
    { content: execMessage, customType: "plan-mode-execute", display: true },
    { deliverAs: "followUp", triggerTurn: true },
  );
};

const completeExecution = (
  msa: codingAgentTypes.ExtensionAPI,
  store: stateTypes.PlanStore,
  ctx: codingAgentTypes.ExtensionContext,
): boolean => {
  const { runtime } = store;
  if (!runtime.executing || runtime.todos.length === 0) return false;
  if (!runtime.todos.every((t) => t.completed)) return true;

  const completedList = runtime.todos.map((t) => `~~${t.text}~~`).join("\n");
  msa.sendMessage(
    {
      content: `**Plan Complete!** ✓\n\n${completedList}`,
      customType: "plan-complete",
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

const extractPlan = (
  store: stateTypes.PlanStore,
  ctx: codingAgentTypes.ExtensionContext,
  messages: agentTypes.AgentMessage[],
): void => {
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

const handleAgentEnd = (request: {
  readonly msa: codingAgentTypes.ExtensionAPI;
  readonly store: stateTypes.PlanStore;
  readonly event: { messages: agentTypes.AgentMessage[] };
  readonly ctx: codingAgentTypes.ExtensionContext;
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

const approval = {
  handleAgentEnd,
};

export default approval;
