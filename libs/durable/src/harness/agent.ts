import { copyJson, type Draft } from "@msa/chord";

import { defineDoc } from "../documents.ts";
import { documentRetention } from "../session/session.ts";
import type { ConversationId, ConversationRecord, Tx } from "../types.ts";
import type {
  Agent,
  AgentChange,
  AgentState,
  CompactionPolicy,
  ConversationRetryPolicy,
  Extension,
  HarnessSettings,
  ProgressPolicy,
  PromptSection,
  RegistrySnapshot,
  Settings,
  ToolRegistration,
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

export async function configure(
  tx: Tx,
  conversationId: ConversationId,
  change: AgentChange,
): Promise<void> {
  const state = await tx.doc(AgentDoc, conversationId);
  applyChange(state, change);
}

export async function addTools(
  tx: Tx,
  conversationId: ConversationId,
  added: readonly string[],
): Promise<void> {
  const state = await tx.doc(AgentDoc, conversationId);
  const tools = state.tools;
  if (Array.isArray(tools)) {
    for (const name of added) if (!tools.includes(name)) tools.push(name);
  } else if (tools?.remove.some((name) => added.includes(name))) {
    state.tools = { remove: tools.remove.filter((name) => !added.includes(name)) };
  }
  const modelTools = state.modelTools;
  if (Array.isArray(modelTools)) {
    for (const name of added) if (!modelTools.includes(name)) modelTools.push(name);
    return;
  }
  const remove = (modelTools?.remove ?? []).filter((name) => !added.includes(name));
  const add = [...(modelTools?.add ?? [])];
  for (const name of added) if (!add.includes(name)) add.push(name);
  state.modelTools = { ...(remove.length === 0 ? {} : { remove }), add };
}

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

export async function createAgent(tx: Tx, conversation: ConversationRecord): Promise<void> {
  if (conversation.parent !== undefined) return;
  const agent = await tx.doc(AgentDoc, conversation.id);
  if (conversation.owner === undefined) return;
  const owner = await tx.doc(AgentDoc, conversation.owner.conversationId);
  Object.assign(agent, copyJson(owner) as AgentState);
}

export function agentHooks(agent: Agent, taskName: string): object[] {
  const handlers: object[] = [];
  for (const extension of agent.extensions) {
    for (const hook of extension.hooks ?? [])
      if (hook.task === taskName) handlers.push(hook.handlers);
  }
  return handlers;
}

export function resolveAgent<Tool extends ToolRegistration>(
  state: Readonly<AgentState> | undefined,
  snapshot: RegistrySnapshot<Tool>,
  settings: Settings,
  report: (error: unknown) => void,
): Agent<Tool> {
  const extensions = selectExtensions(state?.extensions, snapshot, settings);

  const composed = new Map<string, Tool>();
  for (const extension of extensions)
    for (const tool of extension.tools ?? []) composed.set(tool.name, tool);
  const sections = new Map<string, PromptSection<Tool>>();
  for (const extension of extensions) {
    for (const section of extension.sections ?? []) sections.set(section.key, section);
  }
  for (const extension of extensions) {
    for (const wrap of extension.wraps ?? []) {
      if ("tool" in wrap)
        applyWrap(
          composed,
          wrap.tool,
          (tool) => wrap.wrap(tool),
          (tool) => tool.name,
          report,
        );
      else
        applyWrap(
          sections,
          wrap.section,
          (section) => wrap.wrap(section),
          (section) => section.key,
          report,
        );
    }
  }

  const enabled = filterTools([...composed.values()], state?.tools);
  const callableBy = (caller: "model" | "tools") => (tool: Tool) =>
    tool.callers === undefined || tool.callers.includes(caller);
  const modelCallable = enabled.filter(callableBy("model"));
  const tools = offeredTools(modelCallable, state?.modelTools);
  const offered = new Set(tools);
  const deferred = modelCallable.filter((tool) => tool.deferred === true && !offered.has(tool));
  const callable = enabled.filter(callableBy("tools"));

  const instructions = state?.instructions;
  const agentSections = [...sections.values()];
  if (instructions !== undefined)
    agentSections.push({ key: INSTRUCTIONS_KEY, render: () => instructions });

  const agent: Agent<Tool> = {
    ...(state?.model === undefined ? {} : { model: state.model }),
    thinkingLevel: state?.thinkingLevel ?? "off",
    extensions,
    tools,
    callable,
    deferred,
    sections: agentSections,
    ...(instructions === undefined ? {} : { instructions }),
    ...(state?.cwd === undefined ? {} : { cwd: state.cwd }),
  };
  return agent;
}

function offeredTools<Tool extends ToolRegistration>(
  tools: Tool[],
  filter: AgentState["modelTools"],
): Tool[] {
  if (Array.isArray(filter)) return filterTools(tools, filter);
  const removed = new Set(filter?.remove ?? []);
  const kept = tools.filter((tool) => tool.deferred !== true && !removed.has(tool.name));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const loaded = [...new Set(filter?.add ?? [])].flatMap((name) => {
    const tool = byName.get(name);
    return tool?.deferred === true && !removed.has(name) ? [tool] : [];
  });
  return [...kept, ...loaded];
}

function filterTools<Tool extends ToolRegistration>(
  tools: Tool[],
  filter: AgentState["tools"],
): Tool[] {
  if (filter === undefined) return tools;
  if (Array.isArray(filter)) {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    return [...new Set(filter)].flatMap((name) => {
      const tool = byName.get(name);
      return tool === undefined ? [] : [tool];
    });
  }
  const removed = new Set((filter as { remove: string[] }).remove);
  return tools.filter((tool) => !removed.has(tool.name));
}

function selectExtensions<Tool extends ToolRegistration>(
  stored: AgentState["extensions"],
  snapshot: RegistrySnapshot<Tool>,
  settings: Settings,
): Extension<Tool>[] {
  let selected: string[];
  if (Array.isArray(stored)) selected = stored;
  else {
    const base =
      settings.extensions?.map((extension) => extension.name) ??
      snapshot.installed().map((e) => e.name);
    const edit = stored as { add?: string[]; remove?: string[] } | undefined;
    const removed = new Set(edit?.remove ?? []);
    selected = [...base, ...(edit?.add ?? [])].filter((name) => !removed.has(name));
  }
  const extensions: Extension<Tool>[] = [];
  for (const name of new Set(selected)) {
    const extension = snapshot.extension(name);
    if (extension !== undefined) extensions.push(extension);
  }
  return extensions;
}

function applyWrap<T>(
  items: Map<string, T>,
  target: string,
  wrap: (item: T) => T,
  nameOf: (item: T) => string,
  report: (error: unknown) => void,
): void {
  const item = items.get(target);
  if (item === undefined) return;
  try {
    const wrapped = wrap(item);
    if (nameOf(wrapped) !== target)
      throw new Error(`Wrapper renamed ${target} to ${nameOf(wrapped)}`);
    items.set(target, wrapped);
  } catch (error) {
    items.delete(target);
    report(error);
  }
}
