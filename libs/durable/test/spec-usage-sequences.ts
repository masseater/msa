import {
  configure,
  defineDoc,
  type HarnessSettings,
  LiveDoc,
  type TaskId,
  type Tx,
} from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { CodingTools, type createEditTool, type createReadTool } from "../src/tools/index.ts";
import { awaited } from "./effect-support.ts";
import type {
  bashExtensions,
  chatExtension,
  followTask,
  planMode,
  promptExtensions,
  subagentExtension,
  subagentTools,
} from "./spec-usage-extensions.ts";
import type { SettingsManager, SpecNames } from "./spec-usage-names.ts";

export type SpecTools = {
  readonly readTool: ReturnType<typeof createReadTool>;
  readonly editTool: ReturnType<typeof createEditTool>;
  readonly bashTool: SpecBashTool;
};
type SpecBashTool = Parameters<typeof bashExtensions>[1];
export type SpecExtensions = ReturnType<typeof promptExtensions> &
  ReturnType<typeof bashExtensions> &
  ReturnType<typeof planMode> & {
    readonly Subagent: ReturnType<typeof subagentExtension>;
    readonly SubagentTools: ReturnType<typeof subagentTools>;
    readonly Chat: ReturnType<typeof chatExtension>;
  };

function setupSequencesImpl(
  { haiku, worktree, manager }: SpecNames,
  readTool: SpecTools["readTool"],
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
            configure(tx, child.id, { model: haiku, tools: [readTool], cwd: worktree }),
          );
        }),
      ),

    liveSettings: () => {
      class UserSettings implements HarnessSettings {
        readonly manager: SettingsManager;
        constructor(manager: SettingsManager) {
          this.manager = manager;
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

export const setupSequences: {
  (readTool: SpecTools["readTool"]): (arg0: SpecNames) => ReturnType<typeof setupSequencesImpl>;
  (arg0: SpecNames, readTool: SpecTools["readTool"]): ReturnType<typeof setupSequencesImpl>;
} = dual(2, setupSequencesImpl);

export function containerSequence({ storage, models, localEnv, containers, context }: SpecNames) {
  return {
    containerEnv: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const registry = createRegistry();
          const ContainerDoc = defineDoc<{ image: string }>({
            kind: "app.container",
            version: 1,
            scope: "conversation",
            history: "latest",
            fork: "current",
            initial: () => ({ image: "node:22" }),
          });
          const harness = yield* awaited(
            Harness.open(
              storage,
              {
                models,
                registry,
                env: ({ conversationId, cwd, read }, context) =>
                  runPromise(
                    Effect.gen(function* () {
                      const container = yield* awaited(
                        read.snapshot(ContainerDoc, conversationId, context),
                      );
                      return yield* awaited(
                        container === undefined
                          ? localEnv(cwd ?? process.cwd())
                          : containers.env(container.image, cwd ?? "/work", context),
                      );
                    }),
                  ),
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
  { storage, models, localEnv, sonnet, context }: SpecNames,
  { Coding, ContextFiles, Skills, Permissions, Reviewer }: SpecExtensions,
) {
  const registry = createRegistry();
  for (const extension of [CodingTools, Coding, ContextFiles, Skills, Permissions, Reviewer]) {
    registry.install(extension);
  }
  const harness = yield* awaited(
    Harness.open(
      storage,
      {
        models,
        registry,
        settings: { extensions: [CodingTools, Coding, ContextFiles, Skills, Permissions] },
        env: ({ cwd }) => localEnv(cwd ?? process.cwd()),
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, { agent: { model: sonnet, cwd: process.cwd() } }),
  );
  return { registry, harness, root };
});

const reloadHost = Effect.fn("reloadHost")(function* (
  { context }: SpecNames,
  { editTool, bashTool }: SpecTools,
  { Timing, Venv, PlanMode, PlanModeDoc, Subagent, Chat, SkillsV2, Skills }: SpecExtensions,
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

function hostSequenceImpl(names: SpecNames, tools: SpecTools, extensions: SpecExtensions) {
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

export const hostSequence: {
  (
    tools: SpecTools,
    extensions: SpecExtensions,
  ): (names: SpecNames) => ReturnType<typeof hostSequenceImpl>;
  (
    names: SpecNames,
    tools: SpecTools,
    extensions: SpecExtensions,
  ): ReturnType<typeof hostSequenceImpl>;
} = dual(3, hostSequenceImpl);

function taskSequencesImpl(
  { Anchor, name, session, conversationId, message, context }: SpecNames,
  SubagentTools: SpecExtensions["SubagentTools"],
  Follow: ReturnType<typeof followTask>,
) {
  return {
    spawn: (tx: Tx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const anchor = yield* awaited(
            tx.createTask(Anchor, null, {
              ownership: { kind: "conversation" },
              background: true,
            }),
          );
          const child = yield* awaited(
            tx.createConversation({ ownership: { kind: "task", taskId: anchor } }),
          );
          yield* awaited(
            configure(tx, child.id, {
              extensions: { remove: [SubagentTools] },
              instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
            }),
          );
        }),
      ),

    tableRules: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            session.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const conversation = yield* awaited(tx.conversation(conversationId));
                    const live = yield* awaited(tx.doc(LiveDoc, conversationId));

                    yield* awaited(tx.appendEntry(conversationId, message));
                    delete live.generation;
                    yield* awaited(
                      tx.createTask(
                        Follow,
                        {},
                        { ownership: { kind: "conversation" }, conversationId },
                      ),
                    );
                    void conversation;
                  }),
                ),
              context,
            ),
          );
        }),
      ),

    revokedDraft: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const escaped = yield* awaited(
            session.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const escaped = yield* awaited(tx.doc(LiveDoc, conversationId));
                    return escaped;
                  }),
                ),
              context,
            ),
          );
          escaped!.generation = { attempt: 1 };
        }),
      ),
  };
}

export const taskSequences: {
  (
    SubagentTools: SpecExtensions["SubagentTools"],
    Follow: ReturnType<typeof followTask>,
  ): (arg0: SpecNames) => ReturnType<typeof taskSequencesImpl>;
  (
    arg0: SpecNames,
    SubagentTools: SpecExtensions["SubagentTools"],
    Follow: ReturnType<typeof followTask>,
  ): ReturnType<typeof taskSequencesImpl>;
} = dual(3, taskSequencesImpl);
