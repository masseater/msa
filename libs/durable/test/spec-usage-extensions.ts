import { Type } from "@msa/ai";
import {
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type EntryId,
  type Extension,
  hook,
  section,
  wrapTool,
} from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";

import { currentTimeMillis } from "../src/clock.ts";
import { createBashTool } from "../src/tools/index.ts";
import { awaited } from "./effect-support.ts";
import type { SpecNames } from "./spec-usage-names.ts";

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
        execute: (args, api, context) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const start = currentTimeMillis();
              return yield* Effect.suspend(() => awaited(tool.execute(args, api, context))).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    metrics.record("bash", currentTimeMillis() - start);
                  }),
                ),
              );
            }),
          ),
      })),
    ],
  });
  const Venv = defineExtension({
    name: "venv",
    tools: [createBashTool({ commandPrefix: "source .venv/bin/activate" })],
  });
  return { Timing, Venv };
}

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
        beforeTool: (call, api, context) =>
          Effect.runPromise(
            Effect.gen(function* () {
              return (yield* awaited(api.snapshot(PlanModeDoc, api.conversationId, context)))
                ?.enabled && writes(call)
                ? { block: "Plan mode: read-only" }
                : undefined;
            }),
          ),
      }),
    ],
  });
  return { PlanModeDoc, PlanMode };
}

export function subagentExtension({ answerText }: SpecNames) {
  const Subagent: Extension = defineExtension({
    name: "subagent",
    tools: [
      defineTool({
        name: "subagent",
        description: "Delegate a self-contained task to a subagent and get its answer back.",
        parameters: Type.Object({ task: Type.String() }),
        replay: "safe",
        execute: (args, api, context) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

              const { task } = args;
              const child = yield* awaited(
                api.commit(
                  (tx) =>
                    runPromise(
                      Effect.gen(function* () {
                        const existing = (yield* awaited(
                          tx.scanConversations({ ownerTaskId: api.taskId }, 1),
                        )).items[0];
                        if (existing !== undefined) return existing.id;
                        const created = yield* awaited(
                          tx.createConversation({
                            ownership: { kind: "task", taskId: api.taskId },
                          }),
                        );
                        yield* awaited(
                          configure(tx, created.id, { extensions: { remove: [Subagent] } }),
                        );
                        return created.id;
                      }),
                    ),
                  context,
                ),
              );
              yield* awaited(api.details({ conversationId: child }, context));
              const handle = (yield* awaited(api.conversation(child, context)))!;
              const request = {
                type: "input",
                content: task,
                requestId: `subagent:${api.taskId}`,
              } as const;
              const settled = yield* awaited(
                (yield* awaited(handle.submit(request, context))).wait(context),
              );
              if (settled.status !== "done" || settled.type !== "input")
                throw new Error(`Subagent failed: ${settled.status}`);
              return {
                output: [
                  { type: "text", text: yield* awaited(answerText(api, settled.answer, context)) },
                ],
              };
            }),
          ),
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

export function chatExtension() {
  return defineExtension({
    name: "chat",
    sections: [section("preamble", () => "You are a helpful assistant.", { tag: false })],
  });
}

type Charge = { phase: "prepare" } | { phase: "charge"; key: string };

export function paymentTask({ newKey, payments, receiptEntry }: SpecNames) {
  return defineTask<null, Charge, { entryId: EntryId }>({
    name: "app.payment",
    version: 1,
    initial: () => ({ phase: "prepare" }),
    phases: {
      prepare: (_task, runtime, context) =>
        Effect.runPromise(
          Effect.asVoid(
            Effect.suspend(() =>
              awaited(
                runtime.commit(
                  () => ({ status: "running", checkpoint: { phase: "charge", key: newKey() } }),
                  context,
                ),
              ),
            ),
          ),
        ),
      charge: (task, runtime, context) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const receipt = yield* awaited(payments.charge(task.state.checkpoint.key));
            yield* awaited(
              runtime.commit(
                (tx, current) =>
                  runPromise(
                    Effect.gen(function* () {
                      const entry = yield* awaited(
                        tx.appendEntry(current.conversationId, receiptEntry(receipt)),
                      );
                      return {
                        status: "terminal",
                        outcome: { status: "completed", result: { entryId: entry.id } },
                      };
                    }),
                  ),
                context,
              ),
            );
          }),
        ),
    },
    abort: (task, runtime, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(payments.cancel(task.state.checkpoint));
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted", reason: "user" } }),
              context,
            ),
          );
        }),
      ),
  });
}

export function followTask() {
  return defineTask<object, { phase: "follow" }, null>({
    name: "app.follow",
    version: 1,
    initial: () => ({ phase: "follow" }),
    phases: { follow: () => Promise.resolve() },
    abort: () => Promise.resolve(),
  });
}
