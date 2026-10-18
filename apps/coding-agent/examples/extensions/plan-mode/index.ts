import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@msa/coding-agent";
import { Key } from "@msa/tui";
import { Effect } from "effect";

import { handleAgentEnd } from "./approval.ts";
import {
  executionContextMessage,
  filterPlanContext,
  guardBash,
  planModeContextMessage,
} from "./context.ts";
import { createPlanStore, type PlanStore } from "./state.ts";
import { markCompletedSteps } from "./utils.ts";

const isAssistantMessage = (m: AgentMessage): m is AssistantMessage =>
  m.role === "assistant" && Array.isArray(m.content);

const getTextContent = (message: AssistantMessage): string =>
  message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const registerCommands = (msa: ExtensionAPI, store: PlanStore): void => {
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

const registerGuards = (msa: ExtensionAPI, store: PlanStore): void => {
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

const registerProgress = (msa: ExtensionAPI, store: PlanStore): void => {
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
    Effect.runPromise(handleAgentEnd({ msa, store, event, ctx })),
  );
};

const completedTextSinceExecute = (entries: SessionEntry[]): string => {
  let executeIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type: string; customType?: string };
    if (entry.customType === "plan-mode-execute") {
      executeIndex = i;
      break;
    }
  }

  const messages: AssistantMessage[] = [];
  for (const entry of entries.slice(executeIndex + 1)) {
    if (entry.type === "message" && isAssistantMessage(entry.message as AgentMessage)) {
      messages.push(entry.message as AssistantMessage);
    }
  }
  return messages.map(getTextContent).join("\n");
};

const restoreFromBranch = (msa: ExtensionAPI, store: PlanStore, ctx: ExtensionContext): void => {
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
    .pop() as { data?: Parameters<PlanStore["restore"]>[0] } | undefined;

  if (planModeEntry !== undefined && runtime.executing && runtime.todos.length > 0) {
    markCompletedSteps(completedTextSinceExecute(entries), runtime.todos);
  }

  store.restore(planModeEntry?.data, ctx);
};

export default function planModeExtension(msa: ExtensionAPI): void {
  const store = createPlanStore(msa);

  msa.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  registerCommands(msa, store);
  registerGuards(msa, store);
  registerProgress(msa, store);

  msa.on("session_start", (_event, ctx) => {
    restoreFromBranch(msa, store, ctx);
  });
}
