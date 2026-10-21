import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import compaction from "./compaction/compaction.ts";
import type contextBreakdownTypes from "./context-breakdown.types.ts";
import memory from "./memory/memory.ts";
import systemPrompt from "./system-prompt.ts";

const { estimateTokens } = compaction;
const { ORCHESTRATOR_PREAMBLE } = systemPrompt;
const { MEMORY_RECALL_MESSAGE_TYPE } = memory;

const { contentText, getCurrentTools, getInitialSystemMessage, renderSystemMessageUpdate } = ai;

const systemOnly = (
  fields: Omit<aiTypes.SystemMessage, "role" | "content" | "timestamp">,
): number => estimateTokens({ content: "", role: "system", timestamp: 0, ...fields });

function systemElements(system: aiTypes.SystemMessage): contextBreakdownTypes.ContextElement[] {
  const elements: contextBreakdownTypes.ContextElement[] = [];
  const content = contentText(system.content, "\n");
  if (content.length > 0) {
    elements.push({
      estimate: estimateTokens({ content, role: "system", timestamp: 0 }),
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
): contextBreakdownTypes.ContextElement {
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
): contextBreakdownTypes.ContextElement[] {
  const llmMessages = sent.flat();
  const elements: contextBreakdownTypes.ContextElement[] = [];
  const initial = getInitialSystemMessage(llmMessages);
  if (initial !== undefined) elements.push(...systemElements(initial));
  for (const tool of getCurrentTools(llmMessages)) {
    elements.push({ estimate: systemOnly({ toolsAdded: [tool] }), name: tool.name, part: "tools" });
  }
  transformed.forEach((source, index) => {
    for (const message of sent[index] ?? []) {
      if (message === initial) continue;
      if (message.role === "system") {
        elements.push({
          estimate: estimateTokens({
            content: renderSystemMessageUpdate(message),
            role: "user",
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

function mergeElements(
  elements: readonly contextBreakdownTypes.ContextElement[],
): contextBreakdownTypes.ContextElement[] {
  const merged = new Map<string, contextBreakdownTypes.ContextElement>();
  for (const element of elements) {
    const key = `${element.part}\u0000${element.name}`;
    const existing = merged.get(key);
    if (existing === undefined) merged.set(key, { ...element });
    else existing.estimate += element.estimate;
  }
  return [...merged.values()];
}

function apportion(
  elements: readonly contextBreakdownTypes.ContextElement[],
  total: number,
): contextBreakdownTypes.ContextBreakdownEntry[] {
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

const measureContextBreakdown = (
  source: contextBreakdownTypes.ContextBreakdownSource,
): Effect.Effect<contextBreakdownTypes.ContextBreakdown> =>
  Effect.gen(function* () {
    const messages = [...source.messages, ...source.pending];
    const transformed =
      source.transformContext === undefined
        ? messages
        : yield* Effect.promise(() => source.transformContext!(messages));
    const sent = yield* Effect.forEach(transformed, (message) =>
      Effect.promise(() => Promise.resolve(source.convertToLlm([message]))),
    );
    const elements = splitContext(transformed, sent);
    const counted = yield* Effect.tryPromise(() => source.countTokens(sent.flat())).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const estimated = elements.reduce((sum, element) => sum + element.estimate, 0);
    const pending = yield* Effect.promise(() =>
      Promise.resolve(source.convertToLlm(source.pending)),
    );
    const pendingEstimate = pending.reduce((sum, message) => sum + estimateTokens(message), 0);
    const tokens =
      counted ?? (source.usageTokens === null ? estimated : source.usageTokens + pendingEstimate);
    const added =
      counted === undefined && source.addingProvider !== undefined && source.addingProvider !== ""
        ? tokens - estimated
        : 0;
    return {
      entries:
        added > 0
          ? [
              ...apportion(elements, estimated),
              { name: source.addingProvider!, part: "other", tokens: added },
            ]
          : apportion(elements, tokens),
      method: counted === undefined ? "estimated" : "exact",
      tokens,
    };
  });

const contextBreakdown = {
  apportion,
  measureContextBreakdown,
};

export default contextBreakdown;
