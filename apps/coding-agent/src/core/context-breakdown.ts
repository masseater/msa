import type { AgentMessage } from "@msa/agent-core";
import {
  contentText,
  getCurrentTools,
  getInitialSystemMessage,
  renderSystemMessageUpdate,
  type Message,
  type SystemMessage,
} from "@msa/ai";
import { Effect } from "effect";

import { estimateTokens } from "./compaction/compaction.ts";
import { MEMORY_RECALL_MESSAGE_TYPE } from "./memory/memory.ts";
import { ORCHESTRATOR_PREAMBLE } from "./system-prompt.ts";

/** Where an element of the request sits. */
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

/**
 * The request the model would receive next, split into its elements. `tokens` is the whole
 * request; entries sum to it. `exact` when the provider counted the request, otherwise the
 * total is the context usage and entries are shares of it.
 */
export interface ContextBreakdown {
  method: "exact" | "estimated";
  tokens: number;
  entries: ContextBreakdownEntry[];
}

/** One element with its approximate size, before apportioning to the total. */
export interface ContextElement {
  part: ContextPart;
  name: string;
  estimate: number;
}

/** The pipeline the agent loop sends a request through, and the counts known for it. */
export interface ContextBreakdownSource {
  /** The transcript the latest response's usage covers, plus messages appended since. */
  messages: AgentMessage[];
  /** Messages the next request adds before it is sent: prompt updates and tool declarations. */
  pending: AgentMessage[];
  transformContext: ((messages: AgentMessage[]) => Promise<AgentMessage[]>) | undefined;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** Provider count of the converted request, or undefined when the provider cannot count. */
  countTokens: (messages: Message[]) => Promise<number | undefined>;
  /** Context usage from the latest response, or null when unknown. */
  usageTokens: number | null;
  /**
   * The provider when it runs another agent that adds its own prompt and tools to the request,
   * so its usage holds context msa does not send.
   */
  addingProvider: string | undefined;
}

const systemOnly = (fields: Omit<SystemMessage, "role" | "content" | "timestamp">): number =>
  estimateTokens({ role: "system", content: "", timestamp: 0, ...fields });

function systemElements(system: SystemMessage): ContextElement[] {
  const elements: ContextElement[] = [];
  const content = contentText(system.content);
  if (content.length > 0) {
    elements.push({
      part: "system",
      name: "prompt",
      estimate: estimateTokens({ role: "system", content, timestamp: 0 }),
    });
  }
  for (const [name, text] of Object.entries(system.sections ?? {})) {
    if (text === null) continue;
    elements.push({
      part: "system",
      name: name === "preamble" && text === ORCHESTRATOR_PREAMBLE ? "orchestrator" : name,
      estimate: systemOnly({ sections: { [name]: text } }),
    });
  }
  return elements;
}

function conversationElement(source: AgentMessage, sent: Message): ContextElement {
  const estimate = estimateTokens(sent);
  switch (source.role) {
    case "user":
    case "assistant":
      return { part: "conversation", name: source.role, estimate };
    case "toolResult":
      return { part: "toolResults", name: source.toolName, estimate };
    case "compactionSummary":
      return { part: "compaction", name: "summary", estimate };
    case "custom":
      return source.customType === MEMORY_RECALL_MESSAGE_TYPE
        ? { part: "system", name: "memory", estimate }
        : { part: "other", name: source.customType, estimate };
    default:
      return { part: "other", name: source.role, estimate };
  }
}

/**
 * Split a request into elements. `sent` is each transformed message converted for the
 * provider (empty when the conversion drops it). The leading system message splits into its
 * prompt sections and the tools it declares; later system messages count as prompt updates.
 */
function splitContext(
  transformed: readonly AgentMessage[],
  sent: readonly (readonly Message[])[],
): ContextElement[] {
  const llmMessages = sent.flat();
  const elements: ContextElement[] = [];
  const initial = getInitialSystemMessage(llmMessages);
  if (initial) elements.push(...systemElements(initial));
  for (const tool of getCurrentTools(llmMessages)) {
    elements.push({ part: "tools", name: tool.name, estimate: systemOnly({ toolsAdded: [tool] }) });
  }
  transformed.forEach((source, index) => {
    for (const message of sent[index] ?? []) {
      if (message === initial) continue;
      if (message.role === "system") {
        elements.push({
          part: "system",
          name: "updates",
          estimate: estimateTokens({
            role: "user",
            content: renderSystemMessageUpdate(message),
            timestamp: 0,
          }),
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

/**
 * Apportion `total` across elements by their estimates, rounding with the largest remainders
 * so the integer shares sum to `total` exactly.
 */
export function apportion(
  elements: readonly ContextElement[],
  total: number,
): ContextBreakdownEntry[] {
  const estimated = elements.reduce((sum, element) => sum + element.estimate, 0);
  if (estimated === 0) return elements.map(({ part, name }) => ({ part, name, tokens: 0 }));
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
  return elements.map(({ part, name }, index) => ({ part, name, tokens: tokens[index] ?? 0 }));
}

/** Build the breakdown of the request the agent loop would send for `source.messages`. */
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
      method: counted === undefined ? "estimated" : "exact",
      tokens,
      entries:
        added > 0
          ? [
              ...apportion(elements, estimated),
              { part: "other", name: source.addingProvider!, tokens: added },
            ]
          : apportion(elements, tokens),
    };
  });
