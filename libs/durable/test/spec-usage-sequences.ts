import type { Draft } from "@msa/chord";
import {
  configure,
  createRegistry,
  defineDoc,
  Harness,
  type HarnessSettings,
  LiveDoc,
  type LiveState,
  type TaskId,
  type Tx,
} from "@msa/durable";

import { CodingTools, type createEditTool, type createReadTool } from "../src/tools/index.ts";
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

export function setupSequences(
  { haiku, worktree, manager }: SpecNames,
  readTool: SpecTools["readTool"],
) {
  return {
    // Section 2.2: a tool's commit creates a configured child.
    childInToolCommit: async (tx: Tx, api: { readonly taskId: TaskId }) => {
      // In a tool's commit. The child starts as a copy of this conversation's agent: model, extensions, tools, cwd.
      const child = await tx.createConversation({
        ownership: { kind: "task", taskId: api.taskId },
      });
      // A cheaper model, only the read tool, and its own worktree; everything else stays as copied.
      await configure(tx, child.id, { model: haiku, tools: [readTool], cwd: worktree });
    },

    // Section 2.2: settings read live through getters.
    liveSettings: () => {
      // The user's settings, read live through getters.
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
      // no Session write; every conversation follows at its next threshold check
      manager.set("autoCompact", false);
      return new UserSettings(manager);
    },
  };
}

export function containerSequence({ storage, models, localEnv, containers, context }: SpecNames) {
  return {
    // Section 2.2: an environment per conversation.
    containerEnv: async () => {
      const registry = createRegistry();
      // Absent: the conversation runs locally. Only conversations with this document run in a container.
      // Subagents do not copy it: their creator writes it too when they should run in the container.
      const ContainerDoc = defineDoc<{ image: string }>({
        kind: "app.container",
        version: 1,
        scope: "conversation",
        history: "latest",
        fork: "current",
        initial: () => ({ image: "node:22" }),
      });
      const harness = await Harness.open(
        storage,
        {
          models,
          registry,
          env: async ({ conversationId, cwd, read }, context) => {
            const container = await read.snapshot(ContainerDoc, conversationId, context);
            // Without a container: a cached NodeExecutionEnv per directory.
            return container === undefined
              ? localEnv(cwd ?? process.cwd())
              : containers.env(container.image, cwd ?? "/work", context);
          },
        },
        context,
      );
      return harness;
    },
  };
}

// Sections 2.2 and 7.1: host setup, tool filters, extension selection, plan mode, and reload.
async function openHost(
  { storage, models, localEnv, sonnet, context }: SpecNames,
  { Coding, ContextFiles, Skills, Permissions, Reviewer }: SpecExtensions,
) {
  const registry = createRegistry();
  for (const extension of [CodingTools, Coding, ContextFiles, Skills, Permissions, Reviewer]) {
    registry.install(extension);
  }
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      // Reviewer is installed but not selected by default: only conversations that select it get its role and hooks.
      settings: { extensions: [CodingTools, Coding, ContextFiles, Skills, Permissions] },
      // cached NodeExecutionEnv per directory
      env: ({ cwd }) => localEnv(cwd ?? process.cwd()),
    },
    context,
  );
  // The conversation remembers its model and directory; a restart elsewhere keeps both.
  const root = await harness.root(context, { agent: { model: sonnet, cwd: process.cwd() } });
  return { registry, harness, root };
}

async function reloadHost(
  { context }: SpecNames,
  { editTool, bashTool }: SpecTools,
  { Timing, Venv, PlanMode, PlanModeDoc, Subagent, Chat, SkillsV2, Skills }: SpecExtensions,
  { registry, root }: Awaited<ReturnType<typeof openHost>>,
): Promise<void> {
  await root.configure({ tools: { remove: [editTool] } }, context);
  // edit is offered again
  await root.configure({ tools: { remove: [bashTool] } }, context);
  // every tool of the selected extensions again
  await root.configure({ tools: null }, context);

  registry.install(Timing);
  // installed, but not in the default selection
  registry.install(Venv);
  const conversation = root;
  await conversation.configure({ extensions: { add: [Venv] } }, context);

  registry.install(PlanMode);
  // PlanMode is in the default selection; /plan toggles this conversation's state.
  await root.commit(async (tx) => {
    (await tx.doc(PlanModeDoc, root.id)).enabled = true;
  }, context);

  registry.install(Subagent);
  registry.install(Chat);
  // same name: conversations selecting skills render v2 at their next request
  registry.install(SkillsV2);
  // selecting conversations get a system delta removing its section; nothing is rewritten
  registry.uninstall(Skills);
  // Restart: the host installs its extensions again; stored names resolve against them.
}

export function hostSequence(names: SpecNames, tools: SpecTools, extensions: SpecExtensions) {
  return {
    host: async () => {
      const opened = await openHost(names, extensions);
      await reloadHost(names, tools, extensions, opened);
      return opened.harness;
    },
  };
}

export function taskSequences(
  { Anchor, name, session, conversationId, message, context }: SpecNames,
  SubagentTools: SpecExtensions["SubagentTools"],
  Follow: ReturnType<typeof followTask>,
) {
  return {
    // Section 7.3: a named subagent's spawn commit.
    spawn: async (tx: Tx) => {
      // In subagentTool's spawn commit, after the name checks:
      const anchor = await tx.createTask(Anchor, null, {
        ownership: { kind: "conversation" },
        background: true,
      });
      // Owned by a task of the parent: starts as a copy of the parent's agent.
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
      await configure(tx, child.id, {
        extensions: { remove: [SubagentTools] },
        instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
      });
    },

    // Section 4: table reads before the first table write; documents stay usable.
    tableRules: async () => {
      await session.commit(async (tx) => {
        // table read
        const conversation = await tx.conversation(conversationId);
        const live = await tx.doc(LiveDoc, conversationId);

        // first table write
        await tx.appendEntry(conversationId, message);
        // document mutation remains valid
        delete live.generation;
        // further table writes are fine
        await tx.createTask(Follow, {}, { ownership: { kind: "conversation" }, conversationId });
        void conversation;
      }, context);
    },

    // Section 3.4: drafts are revoked after their commit.
    revokedDraft: async () => {
      let escaped: Draft<LiveState> | undefined;
      await session.commit(async (tx) => {
        escaped = await tx.doc(LiveDoc, conversationId);
      }, context);
      // throws: the draft was revoked
      escaped!.generation = { attempt: 1 };
    },
  };
}
