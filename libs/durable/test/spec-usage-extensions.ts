import { Type } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import harness from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import durableKit from "./durable-kit.ts";
import effectSupport from "./effect-support.ts";
import type specUsageNamesTypes from "./spec-usage-names.ts";

const { clock: clockModule, durable, tools: toolsModule } = durableKit;

const { configure, defineDoc, defineExtension, defineTask, defineTool, hook, section, wrapTool } =
  durable;
const { GenerationTask, ToolTask } = harness;
const { createBashTool } = toolsModule;
const { currentTimeMillis } = clockModule;

const { awaited } = effectSupport;

function promptExtensions({
  renderAgentsMd,
  renderSkills,
  isDangerous,
  requestSecondPass,
}: specUsageNamesTypes.SpecNames) {
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
    hooks: [
      hook(ToolTask, {
        beforeTool: (call) =>
          Promise.resolve(isDangerous(call) ? { block: "Needs approval" } : undefined),
      }),
    ],
    name: "permissions",
  });
  const Reviewer = defineExtension({
    hooks: [hook(GenerationTask, { onYield: requestSecondPass })],
    name: "reviewer",
    sections: [
      section("role", () => "You review diffs. Report problems as a list. Never edit files."),
    ],
  });
  return { Coding, ContextFiles, Permissions, Reviewer, Skills, SkillsV2 };
}

function bashExtensionsImpl(
  { metrics }: specUsageNamesTypes.SpecNames,
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

const bashExtensions: {
  (
    bashTool: ReturnType<typeof createBashTool>,
  ): (arg0: specUsageNamesTypes.SpecNames) => ReturnType<typeof bashExtensionsImpl>;
  (
    arg0: specUsageNamesTypes.SpecNames,
    bashTool: ReturnType<typeof createBashTool>,
  ): ReturnType<typeof bashExtensionsImpl>;
} = dual(2, bashExtensionsImpl);

function planMode({ writes }: specUsageNamesTypes.SpecNames) {
  const PlanModeDoc = defineDoc<{ enabled: boolean }>({
    fork: "current",
    history: "latest",
    initial: () => ({ enabled: false }),
    kind: "app.plan-mode",
    scope: "conversation",
    version: 1,
  });
  const PlanMode = defineExtension({
    hooks: [
      hook(ToolTask, {
        beforeTool: (call, api, context) =>
          Effect.runPromise(
            Effect.gen(function* () {
              return (yield* awaited(api.snapshot(PlanModeDoc, api.conversationId, context)))
                ?.enabled === true && writes(call)
                ? { block: "Plan mode: read-only" }
                : undefined;
            }),
          ),
      }),
    ],
    name: "plan-mode",
  });
  return { PlanMode, PlanModeDoc };
}

const childWithout = Effect.fn("childWithout")(function* (
  api: durableTypes.ToolExecutionApi,
  context: chordTypes.Context,
  removed: durableTypes.Extension,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  return yield* awaited(
    api.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const existing = (yield* awaited(tx.scanConversations({ ownerTaskId: api.taskId }, 1)))
              .items[0];
            if (existing !== undefined) return existing.id;
            const created = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } }),
            );
            yield* awaited(configure(tx, created.id, { extensions: { remove: [removed] } }));
            return created.id;
          }),
        ),
      context,
    ),
  );
});

function subagentExtension({ answerText }: specUsageNamesTypes.SpecNames) {
  const Subagent: durableTypes.Extension = defineExtension({
    name: "subagent",
    tools: [
      defineTool({
        description: "Delegate a self-contained task to a subagent and get its answer back.",
        execute: (args, api, context) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const { task } = args;
              const child = yield* childWithout(api, context, Subagent);
              yield* awaited(api.details({ conversationId: child }, context));
              const handle = (yield* awaited(api.conversation(child, context)))!;
              const request = {
                content: task,
                requestId: `subagent:${api.taskId}`,
                type: "input",
              } as const;
              const settled = yield* awaited(
                (yield* awaited(handle.submit(request, context))).wait(context),
              );
              if (settled.status !== "done" || settled.type !== "input")
                throw new Error(`Subagent failed: ${settled.status}`);
              return {
                output: [
                  { text: yield* awaited(answerText(api, settled.answer, context)), type: "text" },
                ],
              };
            }),
          ),
        name: "subagent",
        parameters: Type.Object({ task: Type.String() }),
        replay: "safe",
      }),
    ],
  });
  return Subagent;
}

function subagentTools({ Anchor, Reporter, subagentTool }: specUsageNamesTypes.SpecNames) {
  return defineExtension({
    name: "subagent-tools",
    tasks: [Anchor, Reporter],
    tools: [subagentTool],
  });
}

function chatExtension() {
  return defineExtension({
    name: "chat",
    sections: [section("preamble", () => "You are a helpful assistant.", { tag: false })],
  });
}

type Charge = { phase: "prepare" } | { phase: "charge"; key: string };

function paymentTask({ newKey, payments, receiptEntry }: specUsageNamesTypes.SpecNames) {
  return defineTask<null, Charge, { entryId: durableTypes.EntryId }>({
    abort: (task, runtime, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(payments.cancel(task.state.checkpoint));
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { reason: "user", status: "aborted" }, status: "terminal" }),
              context,
            ),
          );
        }),
      ),
    initial: () => ({ phase: "prepare" }),
    name: "app.payment",
    phases: {
      charge: (task, runtime, context) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const receipt = yield* awaited(payments.charge(task.state.checkpoint.key));
            yield* awaited(
              runtime.commit(
                (tx, current) =>
                  tx.appendEntry(current.conversationId, receiptEntry(receipt)).then((entry) => ({
                    outcome: { result: { entryId: entry.id }, status: "completed" },
                    status: "terminal",
                  })),
                context,
              ),
            );
          }),
        ),
      prepare: (_task, runtime, context) =>
        Effect.runPromise(
          Effect.asVoid(
            Effect.suspend(() =>
              awaited(
                runtime.commit(
                  () => ({ checkpoint: { key: newKey(), phase: "charge" }, status: "running" }),
                  context,
                ),
              ),
            ),
          ),
        ),
    },
    version: 1,
  });
}

function followTask() {
  return defineTask<object, { phase: "follow" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "follow" }),
    name: "app.follow",
    phases: { follow: () => Promise.resolve() },
    version: 1,
  });
}

const specUsageExtensions = {
  bashExtensions,
  chatExtension,
  followTask,
  paymentTask,
  planMode,
  promptExtensions,
  subagentExtension,
  subagentTools,
};

export default specUsageExtensions;
