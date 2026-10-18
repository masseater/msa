import { Type } from "@msa/ai";
import {
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type EntryId,
  hook,
  section,
  wrapTool,
} from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";

import { createBashTool } from "../src/tools/index.ts";
import type { SpecNames } from "./spec-usage-names.ts";

// ─── Section 7.1: extensions and host setup ──────────────────────────────────

export function promptExtensions({
  renderAgentsMd,
  renderSkills,
  isDangerous,
  requestSecondPass,
}: SpecNames) {
  const ContextFiles = defineExtension({
    name: "context-files",
    sections: [section("agents-md", renderAgentsMd)],
  });
  const Skills = defineExtension({ name: "skills", sections: [section("skills", renderSkills)] });
  const SkillsV2 = defineExtension({ name: "skills", sections: [section("skills", renderSkills)] });
  const Coding = defineExtension({
    name: "coding",
    sections: [
      section("preamble", () => "You are an expert coding assistant.", { tag: false }),
      // The environment the host built for this conversation, in the conversation's directory.
      section("cwd", (input) => input.env && `Working directory: ${input.env.cwd}`),
    ],
  });
  const Permissions = defineExtension({
    name: "permissions",
    hooks: [
      hook(ToolTask, {
        beforeTool: (call) =>
          Promise.resolve(isDangerous(call) ? { block: "Needs approval" } : undefined),
      }),
    ],
  });
  // A role and a review loop, for conversations that select it.
  const Reviewer = defineExtension({
    name: "reviewer",
    sections: [
      section("role", () => "You review diffs. Report problems as a list. Never edit files."),
    ],
    hooks: [hook(GenerationTask, { onYield: requestSecondPass })],
  });
  return { ContextFiles, Skills, SkillsV2, Coding, Permissions, Reviewer };
}

export function bashExtensions(
  { metrics }: SpecNames,
  bashTool: ReturnType<typeof createBashTool>,
) {
  const Timing = defineExtension({
    name: "timing",
    wraps: [
      wrapTool(bashTool, (tool) => ({
        ...tool,
        execute: async (args, api, context) => {
          const start = Date.now();
          try {
            return await tool.execute(args, api, context);
          } finally {
            metrics.record("bash", Date.now() - start);
          }
        },
      })),
    ],
  });
  // A bash inside a Python virtualenv for one conversation: it replaces CodingTools' bash in place,
  // and Timing, if selected, wraps it.
  const Venv = defineExtension({
    name: "venv",
    tools: [createBashTool({ commandPrefix: "source .venv/bin/activate" })],
  });
  return { Timing, Venv };
}

// ─── Section 7.2: hooks reading extension state ──────────────────────────────

export function planMode({ writes }: SpecNames) {
  const PlanModeDoc = defineDoc<{ enabled: boolean }>({
    kind: "app.plan-mode",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ enabled: false }),
  });
  const PlanMode = defineExtension({
    name: "plan-mode",
    hooks: [
      hook(ToolTask, {
        // An absent document means plan mode is off.
        beforeTool: async (call, api, context) =>
          (await api.snapshot(PlanModeDoc, api.conversationId, context))?.enabled && writes(call)
            ? { block: "Plan mode: read-only" }
            : undefined,
      }),
    ],
  });
  return { PlanModeDoc, PlanMode };
}

// ─── Section 7.3: subagents ──────────────────────────────────────────────────

export function subagentExtension({ answerText }: SpecNames) {
  const Subagent = defineExtension({
    name: "subagent",
    tools: [
      defineTool({
        name: "subagent",
        description: "Delegate a self-contained task to a subagent and get its answer back.",
        parameters: Type.Object({ task: Type.String() }),
        replay: "safe",
        execute: async (args, api, context) => {
          const { task } = args;
          const child = await api.commit(async (tx) => {
            const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
            if (existing !== undefined) return existing.id;
            // Starts as a copy of this conversation's agent: model, thinking level, cwd, extensions, tools.
            const created = await tx.createConversation({
              ownership: { kind: "task", taskId: api.taskId },
            });
            // Without this extension, the child is not offered this tool.
            await configure(tx, created.id, { extensions: { remove: [Subagent] } });
            return created.id;
          }, context);
          await api.details({ conversationId: child }, context);
          const handle = (await api.conversation(child, context))!;
          const request = {
            type: "input",
            content: task,
            requestId: `subagent:${api.taskId}`,
          } as const;
          const settled = await (await handle.submit(request, context)).wait(context);
          if (settled.status !== "done" || settled.type !== "input")
            throw new Error(`Subagent failed: ${settled.status}`);
          return {
            output: [{ type: "text", text: await answerText(api, settled.answer, context) }],
          };
        },
      }),
    ],
  });
  return Subagent;
}

export function subagentTools({ Anchor, Reporter, subagentTool }: SpecNames) {
  return defineExtension({
    name: "subagent-tools",
    tasks: [Anchor, Reporter],
    tools: [subagentTool],
  });
}

// ─── Section 7.4 ─────────────────────────────────────────────────────────────

export function chatExtension() {
  return defineExtension({
    name: "chat",
    sections: [section("preamble", () => "You are a helpful assistant.", { tag: false })],
  });
}

// ─── Section 5.1: a task with intent, effect, outcome ────────────────────────

type Charge = { phase: "prepare" } | { phase: "charge"; key: string };

export function paymentTask({ newKey, payments, receiptEntry }: SpecNames) {
  return defineTask<null, Charge, { entryId: EntryId }>({
    name: "app.payment",
    version: 1,
    initial: () => ({ phase: "prepare" }),
    phases: {
      // Intent, effect, outcome.
      prepare: async (_task, runtime, context) => {
        await runtime.commit(
          () => ({ status: "running", checkpoint: { phase: "charge", key: newKey() } }),
          context,
        );
      },
      charge: async (task, runtime, context) => {
        // idempotent by key
        const receipt = await payments.charge(task.state.checkpoint.key);
        await runtime.commit(async (tx, current) => {
          const entry = await tx.appendEntry(current.conversationId, receiptEntry(receipt));
          return {
            status: "terminal",
            outcome: { status: "completed", result: { entryId: entry.id } },
          };
        }, context);
      },
    },
    // The abort handler decides the outcome; returning without one faults the task.
    abort: async (task, runtime, context) => {
      await payments.cancel(task.state.checkpoint);
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted", reason: "user" } }),
        context,
      );
    },
  });
}

export function followTask() {
  return defineTask<object, { phase: "follow" }, null>({
    name: "app.follow",
    version: 1,
    initial: () => ({ phase: "follow" }),
    phases: { follow: async () => {} },
    abort: async () => {},
  });
}
