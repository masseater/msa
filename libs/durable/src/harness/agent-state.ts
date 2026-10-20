import type { Draft } from "@msa/chord";
import { copyJson } from "@msa/chord/json";
import { Effect, Function } from "effect";

import documents from "../documents.ts";
import sessionState from "../session/session-state.ts";
import type typesModule from "./types.types.ts";

const { defineDoc } = documents;
const { documentRetention } = sessionState;

const DEFAULT_RETRY_POLICY: typesModule.ConversationRetryPolicy = {
  baseDelayMs: 2000,
  enabled: true,
  maxAgentDelayMs: 60000,
  maxRetries: 3,
};

const DEFAULT_COMPACTION_POLICY: typesModule.CompactionPolicy = {
  backgroundTokens: 32768,
  enabled: true,
  keepRecentTokens: 20000,
  reserveTokens: 16384,
};

const DEFAULT_PROGRESS_POLICY: typesModule.ProgressPolicy = {
  outputIntervalMs: 100,
  partialIntervalMs: 100,
};

const INSTRUCTIONS_KEY = "instructions";

const AgentDoc = defineDoc<typesModule.AgentState>({
  checkpointWhen: () => true,
  fork: "asOf",
  history: "rewindable",
  initial: () => ({}),
  kind: "msa.agent",
  scope: "conversation",
  version: 1,
});

const DEFAULT_CONTEXT_RETENTION_MS = 600_000;

function resolveSettings(settings: typesModule.HarnessSettings | undefined): typesModule.Settings {
  const extensions = settings?.extensions;
  return {
    ...(extensions === undefined ? {} : { extensions }),
    compaction: { ...DEFAULT_COMPACTION_POLICY, ...settings?.compaction },
    contextRetentionMs: settings?.contextRetentionMs ?? DEFAULT_CONTEXT_RETENTION_MS,
    documentRetentionMs: documentRetention(settings?.documentRetentionMs),
    followUpMode: settings?.followUpMode ?? "one-at-a-time",
    progress: {
      outputIntervalMs:
        settings?.progress?.outputIntervalMs ?? DEFAULT_PROGRESS_POLICY.outputIntervalMs,
      partialIntervalMs:
        settings?.progress?.partialIntervalMs ?? DEFAULT_PROGRESS_POLICY.partialIntervalMs,
    },
    retry: { ...DEFAULT_RETRY_POLICY, ...settings?.retry },
    steeringMode: settings?.steeringMode ?? "one-at-a-time",
    stream: { ...settings?.stream },
    toolExecution: settings?.toolExecution ?? "parallel",
  };
}

const configureDoc = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  change: typesModule.AgentChange,
) {
  const state = yield* Effect.promise(() => tx.doc(AgentDoc, conversationId));
  applyChange(state, change);
});

const configure: typesModule.Dual3<
  typesModule.Tx,
  typesModule.ConversationId,
  typesModule.AgentChange,
  Promise<void>
> = Function.dual(
  3,
  (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    change: typesModule.AgentChange,
  ): Promise<void> => Effect.runPromise(configureDoc(tx, conversationId, change)),
);

const addModelTools = (state: Draft<typesModule.AgentState>, added: readonly string[]): void => {
  const modelTools = state.modelTools;
  if (Array.isArray(modelTools)) {
    for (const name of added) if (!modelTools.includes(name)) modelTools.push(name);
    return;
  }
  const remove = (modelTools?.remove ?? []).filter((name) => !added.includes(name));
  const add = [...(modelTools?.add ?? [])];
  for (const name of added) if (!add.includes(name)) add.push(name);
  state.modelTools = { ...(remove.length === 0 ? {} : { remove }), add };
};

const addTools: typesModule.Dual3<
  typesModule.Tx,
  typesModule.ConversationId,
  readonly string[],
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    added: readonly string[],
  ) {
    const state = yield* Effect.promise(() => tx.doc(AgentDoc, conversationId));
    const tools = state.tools;
    if (Array.isArray(tools)) {
      for (const name of added) if (!tools.includes(name)) tools.push(name);
    } else if (tools?.remove.some((name) => added.includes(name)) === true) {
      state.tools = { remove: tools.remove.filter((name) => !added.includes(name)) };
    }
    addModelTools(state, added);
  }),
);

function applyChange(state: Draft<typesModule.AgentState>, change: typesModule.AgentChange): void {
  const set = <K extends keyof typesModule.AgentState>(
    key: K,
    value: typesModule.AgentState[K] | null | undefined,
  ) => {
    if (value === undefined) return;
    if (value === null) delete state[key];
    else state[key] = value as Draft<typesModule.AgentState>[K];
  };
  set(
    "model",
    change.model === undefined || change.model === null ? change.model : { ...change.model },
  );
  set("thinkingLevel", change.thinkingLevel);
  const extensions = change.extensions;
  set(
    "extensions",
    extensions === undefined || extensions === null
      ? extensions
      : isList(extensions)
        ? names(extensions)
        : {
            ...(extensions.add === undefined ? {} : { add: names(extensions.add) }),
            ...(extensions.remove === undefined ? {} : { remove: names(extensions.remove) }),
          },
  );
  const tools = change.tools;
  set(
    "tools",
    tools === undefined || tools === null
      ? tools
      : isList(tools)
        ? names(tools)
        : { remove: names(tools.remove) },
  );
  const modelTools = change.modelTools;
  set(
    "modelTools",
    modelTools === undefined || modelTools === null
      ? modelTools
      : isList(modelTools)
        ? names(modelTools)
        : {
            ...(modelTools.remove === undefined ? {} : { remove: names(modelTools.remove) }),
            ...(modelTools.add === undefined ? {} : { add: names(modelTools.add) }),
          },
  );
  set("instructions", change.instructions);
  set("cwd", change.cwd);
}

function isList<T>(value: readonly T[] | object): value is readonly T[] {
  return Array.isArray(value);
}

function names(items: readonly { readonly name: string }[]): string[] {
  return items.map((item) => item.name);
}

const createAgent: typesModule.Dual2<
  typesModule.Tx,
  typesModule.ConversationRecord,
  Effect.Effect<void>
> = Function.dual(
  2,
  Effect.fnUntraced(function* (tx: typesModule.Tx, conversation: typesModule.ConversationRecord) {
    if (conversation.parent !== undefined) return;
    const agent = yield* Effect.promise(() => tx.doc(AgentDoc, conversation.id));
    if (conversation.owner === undefined) return;
    const owner = yield* Effect.promise(() => tx.doc(AgentDoc, conversation.owner!.conversationId));
    Object.assign(agent, copyJson(owner) as typesModule.AgentState);
  }),
);

const agentState = {
  AgentDoc,
  DEFAULT_COMPACTION_POLICY,
  DEFAULT_PROGRESS_POLICY,
  DEFAULT_RETRY_POLICY,
  INSTRUCTIONS_KEY,
  addTools,
  configure,
  createAgent,
  resolveSettings,
};

export default agentState;
