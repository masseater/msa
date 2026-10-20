import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import { estimateTokens } from "./compaction/compaction.ts";
import { MEMORY_RECALL_MESSAGE_TYPE } from "./memory/memory.ts";
import { ORCHESTRATOR_PREAMBLE } from "./system-prompt.ts";

const { contentText, getCurrentTools, getInitialSystemMessage, renderSystemMessageUpdate } = ai;

export type ContextPart =
  | "system"
  | "tools"
  | "conversation"
  | "toolResults"
  | "compaction"
  | "other";

export interface ContextBreakdownEntry {
  part: ContextPart;
  name: string;
  tokens: number;
}

export interface ContextBreakdown {
  method: "exact" | "estimated";
  tokens: number;
  entries: ContextBreakdownEntry[];
}

export interface ContextElement {
  part: ContextPart;
  name: string;
  estimate: number;
}

export interface ContextBreakdownSource {
  messages: agentTypes.AgentMessage[];

  pending: agentTypes.AgentMessage[];
  transformContext:
    | ((messages: agentTypes.AgentMessage[]) => Promise<agentTypes.AgentMessage[]>)
    | undefined;
  convertToLlm: (
    messages: agentTypes.AgentMessage[],
  ) => aiTypes.Message[] | Promise<aiTypes.Message[]>;

  countTokens: (messages: aiTypes.Message[]) => Promise<number | undefined>;

  usageTokens: number | null;

  addingProvider: string | undefined;
}

const systemOnly = (
  fields: Omit<aiTypes.SystemMessage, "role" | "content" | "timestamp">,
): number => estimateTokens({ content: "", role: "system", timestamp: 0, ...fields });

function systemElements(system: aiTypes.SystemMessage): ContextElement[] {
  const elements: ContextElement[] = [];
  const content = contentText(system.content, "\n");
  if (content.length > 0) {
    elements.push({
      estimate: estimateTokens({ role: "system", content, timestamp: 0 }),
      name: "prompt",
      part: "system",
    });
  }
  for (const [name, text] of Object.entries(system.sections ?? {})) {
    if (text === null) continue;
    elements.push({
      estimate: systemOnly({ sections: { [name]: text } }),
      name: name === "preamble" && text === ORCHESTRATOR_PREAMBLE ? "orchestrator" : name,
      part: "system",
    });
  }
  return elements;
}

function conversationElement(
  source: agentTypes.AgentMessage,
  sent: aiTypes.Message,
): ContextElement {
  const estimate = estimateTokens(sent);
  switch (source.role) {
    case "user":
    case "assistant":
      return { estimate, name: source.role, part: "conversation" };
    case "toolResult":
      return { estimate, name: source.toolName, part: "toolResults" };
    case "compactionSummary":
      return { estimate, name: "summary", part: "compaction" };
    case "custom":
      return source.customType === MEMORY_RECALL_MESSAGE_TYPE
        ? { estimate, name: "memory", part: "system" }
        : { estimate, name: source.customType, part: "other" };
    default:
      return { estimate, name: source.role, part: "other" };
  }
}

function splitContext(
  transformed: readonly agentTypes.AgentMessage[],
  sent: readonly (readonly aiTypes.Message[])[],
): ContextElement[] {
  const llmMessages = sent.flat();
  const elements: ContextElement[] = [];
  const initial = getInitialSystemMessage(llmMessages);
  if (initial) elements.push(...systemElements(initial));
  for (const tool of getCurrentTools(llmMessages)) {
    elements.push({ estimate: systemOnly({ toolsAdded: [tool] }), name: tool.name, part: "tools" });
  }
  transformed.forEach((source, index) => {
    for (const message of sent[index] ?? []) {
      if (message === initial) continue;
      if (message.role === "system") {
        elements.push({
          estimate: estimateTokens({
            role: "user",
            content: renderSystemMessageUpdate(message),
            timestamp: 0,
          }),
          name: "updates",
          part: "system",
        });
        continue;
      }
      elements.push(conversationElement(source, message));
    }
  });
  return mergeElements(elements);
}

function mergeElements(elements: readonly ContextElement[]): ContextElement[] {
  const merged = new Map<string, ContextElement>();
  for (const element of elements) {
    const key = `${element.part}\u0000${element.name}`;
    const existing = merged.get(key);
    if (existing) existing.estimate += element.estimate;
    else merged.set(key, { ...element });
  }
  return [...merged.values()];
}

export function apportion(
  elements: readonly ContextElement[],
  total: number,
): ContextBreakdownEntry[] {
  const estimated = elements.reduce((sum, element) => sum + element.estimate, 0);
  if (estimated === 0) return elements.map(({ part, name }) => ({ name, part, tokens: 0 }));
  const shares = elements.map((element) => (element.estimate / estimated) * total);
  const tokens = shares.map(Math.floor);
  const order = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder);
  let missing = total - tokens.reduce((sum, value) => sum + value, 0);
  for (const { index } of order) {
    if (missing <= 0) break;
    tokens[index] = (tokens[index] ?? 0) + 1;
    missing--;
  }
  return elements.map(({ part, name }, index) => ({ name, part, tokens: tokens[index] ?? 0 }));
}

export const measureContextBreakdown = (
  source: ContextBreakdownSource,
): Effect.Effect<ContextBreakdown> =>
  Effect.gen(function* () {
    const messages = [...source.messages, ...source.pending];
    const transformed = source.transformContext
      ? yield* Effect.promise(() => source.transformContext!(messages))
      : messages;
    const sent = yield* Effect.forEach(transformed, (message) =>
      Effect.promise(async () => source.convertToLlm([message])),
    );
    const elements = splitContext(transformed, sent);
    const counted = yield* Effect.tryPromise(() => source.countTokens(sent.flat())).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const estimated = elements.reduce((sum, element) => sum + element.estimate, 0);
    const pending = yield* Effect.promise(async () => source.convertToLlm(source.pending));
    const pendingEstimate = pending.reduce((sum, message) => sum + estimateTokens(message), 0);
    const tokens =
      counted ?? (source.usageTokens === null ? estimated : source.usageTokens + pendingEstimate);
    const added = counted === undefined && source.addingProvider ? tokens - estimated : 0;
    return {
      entries:
        added > 0
          ? [
              ...apportion(elements, estimated),
              { part: "other", name: source.addingProvider!, tokens: added },
            ]
          : apportion(elements, tokens),
      method: counted === undefined ? "estimated" : "exact",
      tokens,
    };
  });
