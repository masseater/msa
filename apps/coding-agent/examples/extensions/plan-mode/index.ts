import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import { Effect } from "effect";

import approval from "./approval.ts";
import context from "./context.ts";
import state from "./state.ts";
import type stateTypes from "./state.types.ts";
import utils from "./utils.ts";

const { createPlanStore } = state;
const { executionContextMessage, filterPlanContext, guardBash, planModeContextMessage } = context;
const { markCompletedSteps } = utils;
const { handleAgentEnd } = approval;

const { Key } = tui;

const isAssistantMessage = (m: agentTypes.AgentMessage): m is aiTypes.AssistantMessage =>
  m.role === "assistant" && Array.isArray(m.content);

const getTextContent = (message: aiTypes.AssistantMessage): string =>
  message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const registerCommands = (
  msa: codingAgentTypes.ExtensionAPI,
  store: stateTypes.PlanStore,
): void => {
  msa.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: (_args, ctx) => Effect.runPromise(Effect.sync(() => store.toggle(ctx))),
  });

  msa.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const { todos } = store.runtime;
          if (todos.length === 0) {
            ctx.ui.notify("No todos. Create a plan first with /plan", "info");
            return;
          }
          const list = todos
            .map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`)
            .join("\n");
          ctx.ui.notify(`Plan Progress:\n${list}`, "info");
        }),
      ),
  });

  msa.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: (ctx) => store.toggle(ctx),
  });
};

const registerGuards = (msa: codingAgentTypes.ExtensionAPI, store: stateTypes.PlanStore): void => {
  const { runtime } = store;
  const guard = guardBash(runtime);
  const filter = filterPlanContext(runtime);

  msa.on("tool_call", (event) =>
    guard(event.toolName, (event.input as { command: string }).command),
  );

  msa.on("context", (event) => filter(event.messages));

  msa.on("before_agent_start", (event) => {
    if (event.messageType !== "user") return;

    if (runtime.enabled) return planModeContextMessage();

    if (runtime.executing && runtime.todos.length > 0) {
      const remaining = runtime.todos.filter((t) => !t.completed);
      return executionContextMessage(remaining.map((t) => `${t.step}. ${t.text}`).join("\n"));
    }
    return undefined;
  });
};

const registerProgress = (
  msa: codingAgentTypes.ExtensionAPI,
  store: stateTypes.PlanStore,
): void => {
  const { runtime } = store;

  msa.on("turn_end", (event, ctx) => {
    if (!runtime.executing || runtime.todos.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    if (markCompletedSteps(getTextContent(event.message), runtime.todos) > 0) {
      store.updateStatus(ctx);
    }
    store.persist();
  });

  msa.on("agent_end", (event, ctx) =>
    Effect.runPromise(handleAgentEnd({ ctx, event, msa, store })),
  );
};

const completedTextSinceExecute = (entries: codingAgentTypes.SessionEntry[]): string => {
  let executeIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type: string; customType?: string };
    if (entry.customType === "plan-mode-execute") {
      executeIndex = i;
      break;
    }
  }

  const messages: aiTypes.AssistantMessage[] = [];
  for (const entry of entries.slice(executeIndex + 1)) {
    if (entry.type === "message" && isAssistantMessage(entry.message as agentTypes.AgentMessage)) {
      messages.push(entry.message as aiTypes.AssistantMessage);
    }
  }
  return messages.map(getTextContent).join("\n");
};

const restoreFromBranch = (
  msa: codingAgentTypes.ExtensionAPI,
  store: stateTypes.PlanStore,
  ctx: codingAgentTypes.ExtensionContext,
): void => {
  const { runtime } = store;
  if (msa.getFlag("plan") === true) {
    runtime.enabled = true;
  }

  const entries = ctx.sessionManager.getEntries();
  const planModeEntry = entries
    .filter(
      (e: { type: string; customType?: string }) =>
        e.type === "custom" && e.customType === "plan-mode",
    )
    .pop() as { data?: Parameters<stateTypes.PlanStore["restore"]>[0] } | undefined;

  if (planModeEntry !== undefined && runtime.executing && runtime.todos.length > 0) {
    markCompletedSteps(completedTextSinceExecute(entries), runtime.todos);
  }

  store.restore(planModeEntry?.data, ctx);
};

export default function planModeExtension(msa: codingAgentTypes.ExtensionAPI): void {
  const store = createPlanStore(msa);

  msa.registerFlag("plan", {
    default: false,
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
  });

  registerCommands(msa, store);
  registerGuards(msa, store);
  registerProgress(msa, store);

  msa.on("session_start", (_event, ctx) => {
    restoreFromBranch(msa, store, ctx);
  });
}
