import { type HarnessSettings, type TaskId, type Tx, configure, defineDoc } from "@msa/durable";
import { Harness, createRegistry } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { CodingTools } from "../src/tools/index.ts";
import effectSupport from "./effect-support.ts";
import type specUsageNamesTypes from "./spec-usage-names.ts";
import type specUsageSequencesTypes from "./spec-usage-sequences.types.ts";

const { awaited } = effectSupport;

function setupSequencesImpl(
  { haiku, worktree, manager }: specUsageNamesTypes.SpecNames,
  readTool: specUsageSequencesTypes.SpecTools["readTool"],
) {
  return {
    childInToolCommit: (tx: Tx, api: { readonly taskId: TaskId }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const child = yield* awaited(
            tx.createConversation({
              ownership: { kind: "task", taskId: api.taskId },
            }),
          );
          yield* awaited(
            configure(tx, child.id, { cwd: worktree, model: haiku, tools: [readTool] }),
          );
        }),
      ),

    liveSettings: () => {
      class UserSettings implements HarnessSettings {
        readonly manager: specUsageNamesTypes.SettingsManager;
        constructor(managerInner: specUsageNamesTypes.SettingsManager) {
          this.manager = managerInner;
        }
        get stream() {
          return { timeoutMs: this.manager.get("timeoutMs") };
        }
        get compaction() {
          return { enabled: this.manager.get("autoCompact") };
        }
      }
      manager.set("autoCompact", false);
      return new UserSettings(manager);
    },
  };
}

const setupSequences: {
  (
    readTool: specUsageSequencesTypes.SpecTools["readTool"],
  ): (arg0: specUsageNamesTypes.SpecNames) => ReturnType<typeof setupSequencesImpl>;
  (
    arg0: specUsageNamesTypes.SpecNames,
    readTool: specUsageSequencesTypes.SpecTools["readTool"],
  ): ReturnType<typeof setupSequencesImpl>;
} = dual(2, setupSequencesImpl);

function containerSequence({
  storage,
  models,
  localEnv,
  containers,
  context,
}: specUsageNamesTypes.SpecNames) {
  return {
    containerEnv: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const registry = createRegistry();
          const ContainerDoc = defineDoc<{ image: string }>({
            fork: "current",
            history: "latest",
            initial: () => ({ image: "node:22" }),
            kind: "app.container",
            scope: "conversation",
            version: 1,
          });
          const harness = yield* awaited(
            Harness.open(
              storage,
              {
                env: ({ conversationId, cwd, read }, contextInner) =>
                  runPromise(
                    Effect.gen(function* () {
                      const container = yield* awaited(
                        read.snapshot(ContainerDoc, conversationId, contextInner),
                      );
                      return yield* awaited(
                        container === undefined
                          ? localEnv(cwd ?? process.cwd())
                          : containers.env(container.image, cwd ?? "/work", contextInner),
                      );
                    }),
                  ),
                models,
                registry,
              },
              context,
            ),
          );
          return harness;
        }),
      ),
  };
}

const openHost = Effect.fn("openHost")(function* (
  { storage, models, localEnv, sonnet, context }: specUsageNamesTypes.SpecNames,
  { Coding, ContextFiles, Skills, Permissions, Reviewer }: specUsageSequencesTypes.SpecExtensions,
) {
  const registry = createRegistry();
  for (const extension of [CodingTools, Coding, ContextFiles, Skills, Permissions, Reviewer]) {
    registry.install(extension);
  }
  const harness = yield* awaited(
    Harness.open(
      storage,
      {
        env: ({ cwd }) => localEnv(cwd ?? process.cwd()),
        models,
        registry,
        settings: { extensions: [CodingTools, Coding, ContextFiles, Skills, Permissions] },
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, { agent: { cwd: process.cwd(), model: sonnet } }),
  );
  return { harness, registry, root };
});

const reloadHost = Effect.fn("reloadHost")(function* (
  { context }: specUsageNamesTypes.SpecNames,
  { editTool, bashTool }: specUsageSequencesTypes.SpecTools,
  {
    Timing,
    Venv,
    PlanMode,
    PlanModeDoc,
    Subagent,
    Chat,
    SkillsV2,
    Skills,
  }: specUsageSequencesTypes.SpecExtensions,
  { registry, root }: Effect.Success<ReturnType<typeof openHost>>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* awaited(root.configure({ tools: { remove: [editTool] } }, context));
  yield* awaited(root.configure({ tools: { remove: [bashTool] } }, context));
  yield* awaited(root.configure({ tools: null }, context));

  registry.install(Timing);
  registry.install(Venv);
  const conversation = root;
  yield* awaited(conversation.configure({ extensions: { add: [Venv] } }, context));

  registry.install(PlanMode);
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(PlanModeDoc, root.id))).enabled = true;
          }),
        ),
      context,
    ),
  );

  registry.install(Subagent);
  registry.install(Chat);
  registry.install(SkillsV2);
  registry.uninstall(Skills);
});

function hostSequenceImpl(
  names: specUsageNamesTypes.SpecNames,
  tools: specUsageSequencesTypes.SpecTools,
  extensions: specUsageSequencesTypes.SpecExtensions,
) {
  return {
    host: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const opened = yield* openHost(names, extensions);
          yield* reloadHost(names, tools, extensions, opened);
          return opened.harness;
        }),
      ),
  };
}

const hostSequence: {
  (
    tools: specUsageSequencesTypes.SpecTools,
    extensions: specUsageSequencesTypes.SpecExtensions,
  ): (names: specUsageNamesTypes.SpecNames) => ReturnType<typeof hostSequenceImpl>;
  (
    names: specUsageNamesTypes.SpecNames,
    tools: specUsageSequencesTypes.SpecTools,
    extensions: specUsageSequencesTypes.SpecExtensions,
  ): ReturnType<typeof hostSequenceImpl>;
} = dual(3, hostSequenceImpl);

const specUsageSequences = {
  containerSequence,
  hostSequence,
  setupSequences,
};

export default specUsageSequences;
