import { copyJson, type Draft } from "@msa/chord";
import { Effect, Function } from "effect";

import { defineDoc } from "../documents.ts";
import { documentRetention } from "../session/session.ts";
import type {
  AgentChange,
  AgentState,
  CompactionPolicy,
  ConversationId,
  ConversationRecord,
  ConversationRetryPolicy,
  Dual2,
  Dual3,
  HarnessSettings,
  ProgressPolicy,
  Settings,
  Tx,
} from "./types.ts";

export const DEFAULT_RETRY_POLICY: ConversationRetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  maxAgentDelayMs: 60000,
};

export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
  backgroundTokens: 32768,
};

export const DEFAULT_PROGRESS_POLICY: ProgressPolicy = {
  partialIntervalMs: 100,
  outputIntervalMs: 100,
};

export const INSTRUCTIONS_KEY = "instructions";

export const AgentDoc = defineDoc<AgentState>({
  kind: "msa.agent",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({}),
  checkpointWhen: () => true,
});

const DEFAULT_CONTEXT_RETENTION_MS = 600_000;

export function resolveSettings(settings: HarnessSettings | undefined): Settings {
  const extensions = settings?.extensions;
  return {
    ...(extensions === undefined ? {} : { extensions }),
    stream: { ...settings?.stream },
    retry: { ...DEFAULT_RETRY_POLICY, ...settings?.retry },
    compaction: { ...DEFAULT_COMPACTION_POLICY, ...settings?.compaction },
    progress: {
      partialIntervalMs:
        settings?.progress?.partialIntervalMs ?? DEFAULT_PROGRESS_POLICY.partialIntervalMs,
      outputIntervalMs:
        settings?.progress?.outputIntervalMs ?? DEFAULT_PROGRESS_POLICY.outputIntervalMs,
    },
    toolExecution: settings?.toolExecution ?? "parallel",
    steeringMode: settings?.steeringMode ?? "one-at-a-time",
    followUpMode: settings?.followUpMode ?? "one-at-a-time",
    contextRetentionMs: settings?.contextRetentionMs ?? DEFAULT_CONTEXT_RETENTION_MS,
    documentRetentionMs: documentRetention(settings?.documentRetentionMs),
  };
}

const configureDoc = Effect.fn("configure")(function* (
  tx: Tx,
  conversationId: ConversationId,
  change: AgentChange,
) {
  const state = yield* Effect.promise(() => tx.doc(AgentDoc, conversationId));
  applyChange(state, change);
});

export const configure: Dual3<Tx, ConversationId, AgentChange, Promise<void>> = Function.dual(
  3,
  (tx: Tx, conversationId: ConversationId, change: AgentChange): Promise<void> =>
    Effect.runPromise(configureDoc(tx, conversationId, change)),
);

const addModelTools = (state: Draft<AgentState>, added: readonly string[]): void => {
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

export const addTools: Dual3<
  Tx,
  ConversationId,
  readonly string[],
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fn("addTools")(function* (
    tx: Tx,
    conversationId: ConversationId,
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

function applyChange(state: Draft<AgentState>, change: AgentChange): void {
  const set = <K extends keyof AgentState>(key: K, value: AgentState[K] | null | undefined) => {
    if (value === undefined) return;
    if (value === null) delete state[key];
    else state[key] = value as Draft<AgentState>[K];
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

export const createAgent: Dual2<Tx, ConversationRecord, Effect.Effect<void>> = Function.dual(
  2,
  Effect.fn("createAgent")(function* (tx: Tx, conversation: ConversationRecord) {
    if (conversation.parent !== undefined) return;
    const agent = yield* Effect.promise(() => tx.doc(AgentDoc, conversation.id));
    if (conversation.owner === undefined) return;
    const owner = yield* Effect.promise(() => tx.doc(AgentDoc, conversation.owner!.conversationId));
    Object.assign(agent, copyJson(owner) as AgentState);
  }),
);
