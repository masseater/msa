import type {
  Context,
  Message,
  SystemMessage,
  Tool,
  ToolReference,
  TranscriptContext,
} from "../types.ts";
import { contentText, getSystemMessageText } from "./text.ts";

export type { TranscriptContext } from "../types.ts";

/**
 * Build the leading system message for a prompt and tool set. Returns undefined when
 * both are empty, so an empty transcript stays empty.
 *
 * @param {string | undefined} systemPrompt - system prompt text
 * @param {Tool[] | undefined} tools - tools declared at the start
 * @returns {SystemMessage | undefined} the leading system message, or undefined when both are empty
 */
export function createInitialSystemMessage(
  systemPrompt: string | undefined,
  tools: Tool[] | undefined,
): SystemMessage | undefined {
  const hasSystemPrompt = systemPrompt !== undefined && systemPrompt.length > 0;
  const hasTools = tools !== undefined && tools.length > 0;
  if (!hasSystemPrompt && !hasTools) return undefined;
  return {
    role: "system",
    content: systemPrompt ?? "",
    ...(hasTools ? { toolsAdded: tools } : {}),
    timestamp: 0,
  };
}

/**
 * Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
 * This is the only entry point that produces a {@link TranscriptContext}; every
 * provider-facing function expects the result.
 *
 * @param {Context} context - caller context
 * @returns {TranscriptContext} the normalized transcript
 */
export function normalizeContext(context: Context): TranscriptContext {
  const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
  const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;
  return { messages } as TranscriptContext;
}

/**
 * Any message list. The replay helpers only read entries whose role is `"system"`, so
 * agent transcripts that carry custom message roles can be passed without filtering.
 */
export type TranscriptMessages = readonly { role: string }[];

function isSystemMessage(message: { role: string }): message is SystemMessage {
  return message.role === "system";
}

/**
 * Return the leading system message, if the transcript starts with one.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {SystemMessage | undefined} the leading system message, or undefined
 */
export function getInitialSystemMessage(messages: TranscriptMessages): SystemMessage | undefined {
  const first = messages[0];
  return first && isSystemMessage(first) ? first : undefined;
}

/**
 * Drop the leading system message for APIs that carry the prompt outside the message list.
 *
 * @param {Message[]} messages - transcript messages
 * @returns {Message[]} the messages after the leading system message
 */
export function withoutInitialSystemMessage(messages: Message[]): Message[] {
  return getInitialSystemMessage(messages) ? messages.slice(1) : messages;
}

/**
 * Resolve the tools available after applying every transcript delta in order.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {Tool[]} the tools available at the end of the transcript
 */
export function getCurrentTools(messages: TranscriptMessages): Tool[] {
  const tools = new Map<string, Tool>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
  }
  return [...tools.values()];
}

/**
 * Replay every system message into one leading system message holding the current
 * prompt and tools. Later `content` is appended to the base prompt, `sections` are
 * patched by name, and tools are resolved with {@link getCurrentTools}.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {SystemMessage | undefined} the replayed system message, or undefined when there is none
 */
export function getCurrentSystemMessage(messages: TranscriptMessages): SystemMessage | undefined {
  const content: string[] = [];
  const sections = new Map<string, string>();
  let timestamp: number | undefined;
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    timestamp ??= message.timestamp;
    const text = contentText(message.content);
    if (text.length > 0) content.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  const tools = getCurrentTools(messages);
  if (timestamp === undefined && tools.length === 0) return undefined;
  return {
    role: "system",
    content: content.join("\n\n"),
    ...(sections.size > 0 ? { sections: Object.fromEntries(sections) } : {}),
    ...(tools.length > 0 ? { toolsAdded: tools } : {}),
    timestamp: timestamp ?? 0,
  };
}

/**
 * Render the current system prompt text after replaying every system message.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {string} the current system prompt text
 */
export function getCurrentSystemPrompt(messages: TranscriptMessages): string {
  const message = getCurrentSystemMessage(messages);
  return message ? getSystemMessageText(message) : "";
}

/**
 * Rebuild the transcript for APIs without mid-conversation system messages: the replayed
 * system message leads, and every later system message is dropped.
 *
 * @param {TranscriptContext} context - normalized transcript
 * @returns {TranscriptContext} the transcript with one leading system message
 */
export function collapseSystemMessages(context: TranscriptContext): TranscriptContext {
  const head = getCurrentSystemMessage(context.messages);
  const messages = context.messages.filter((message) => message.role !== "system");
  return { messages: head ? [head, ...messages] : messages } as TranscriptContext;
}

/**
 * Keep later system messages in place when the model accepts them; otherwise collapse them.
 *
 * @param {TranscriptContext} context - normalized transcript
 * @param {boolean | undefined} supportsMidConvoSystemMessages - whether the model accepts later system messages
 * @returns {TranscriptContext} the transcript to send
 */
export function resolveTranscript(
  context: TranscriptContext,
  supportsMidConvoSystemMessages: boolean | undefined,
): TranscriptContext {
  return supportsMidConvoSystemMessages ? context : collapseSystemMessages(context);
}

/**
 * Strip executable and display-only fields from a tool before transcript comparison or persistence.
 *
 * @param {Tool} tool - tool to strip
 * @returns {Tool} the declaration the model sees
 */
export function toToolDeclaration(tool: Tool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: JSON.parse(JSON.stringify(tool.parameters)) as Tool["parameters"],
    ...(tool.constrainedSampling === undefined
      ? {}
      : { constrainedSampling: tool.constrainedSampling }),
  };
}

/**
 * Whether two tools declare the same interface to the model.
 *
 * Both sides go through {@link toToolDeclaration} first: its JSON round-trip drops the
 * typebox symbol keys and `undefined` fields that a structural comparison would see, and
 * builds both objects with the same key order, so comparing the serialized declarations
 * is exact. This avoids a deep-equal dependency in a browser-safe package.
 *
 * @param {Tool} left - first tool
 * @param {Tool} right - second tool
 * @returns {boolean} whether both tools declare the same interface
 */
export function declarationsEqual(left: Tool, right: Tool): boolean {
  return JSON.stringify(toToolDeclaration(left)) === JSON.stringify(toToolDeclaration(right));
}

export interface ToolStateChanges {
  toolsAdded: Tool[];
  toolsRemoved: ToolReference[];
}

/**
 * Compare two complete tool states. A changed definition is a removal followed by an addition.
 *
 * @param {readonly Tool[]} previous - tools before the change
 * @param {readonly Tool[]} current - tools after the change
 * @returns {ToolStateChanges} the removed and added tools
 */
export function getToolStateChanges(
  previous: readonly Tool[],
  current: readonly Tool[],
): ToolStateChanges {
  const previousTools = new Map(previous.map((tool) => [tool.name, tool]));
  const currentTools = new Map(current.map((tool) => [tool.name, tool]));
  return {
    toolsAdded: current
      .filter((tool) => {
        const previousTool = previousTools.get(tool.name);
        return previousTool === undefined || !declarationsEqual(previousTool, tool);
      })
      .map(toToolDeclaration),
    toolsRemoved: previous
      .filter((tool) => {
        const currentTool = currentTools.get(tool.name);
        return currentTool === undefined || !declarationsEqual(tool, currentTool);
      })
      .map((tool) => ({ name: tool.name })),
  };
}

/**
 * Every definition referenced by transcript tool state, in first-declaration order.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {Tool[]} every declared tool
 */
export function getDeclaredTools(messages: TranscriptMessages): Tool[] {
  const definitions = new Map<string, Tool>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    for (const tool of message.toolsAdded ?? []) definitions.set(tool.name, tool);
  }
  return [...definitions.values()];
}

/**
 * Whether a tool name was declared twice with different definitions. A transport that can
 * only reference previously declared tools by name cannot replay such a history.
 *
 * @deprecated No built-in transport needs this anymore: Anthropic expresses redefinitions with
 * inline `tool_definition` blocks. Kept for API compatibility and will be removed in a future release.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {boolean} whether a tool name was redeclared with a different definition
 */
export function hasToolRedefinitions(messages: TranscriptMessages): boolean {
  const declared = new Map<string, Tool>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    for (const tool of message.toolsAdded ?? []) {
      const previous = declared.get(tool.name);
      if (previous !== undefined && !declarationsEqual(previous, tool)) return true;
      declared.set(tool.name, tool);
    }
  }
  return false;
}

/**
 * Whether tool history contains a removal or same-name redeclaration that an addition-only transport cannot replay.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @returns {boolean} whether an addition-only transport cannot replay the tool history
 */
export function hasNonAdditiveToolChanges(messages: TranscriptMessages): boolean {
  const declared = new Set<string>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    if ((message.toolsRemoved?.length ?? 0) > 0) return true;
    for (const tool of message.toolsAdded ?? []) {
      if (declared.has(tool.name)) return true;
      declared.add(tool.name);
    }
  }
  return false;
}

export interface TranscriptTools {
  /** Tools sent in the top-level request field. */
  requestTools: Tool[];
  /**
   * Whether later system messages carry their own `toolsAdded` as in-place additions.
   * When false, `requestTools` already holds the complete current tool set.
   */
  anchorsAdditions: boolean;
}

/**
 * Split tool declarations between the top-level request field and in-place additions.
 * Transports that can anchor additions at a system message keep the initial tools at the
 * top and load later ones where they appear; that only works when no tool was removed or
 * redeclared, so everything else sends the current tool list.
 *
 * @param {TranscriptMessages} messages - transcript messages
 * @param {boolean} supportsToolAdditions - whether the transport can anchor additions at a system message
 * @returns {TranscriptTools} the top-level tools and the in-place additions
 */
export function resolveTranscriptTools(
  messages: TranscriptMessages,
  supportsToolAdditions: boolean,
): TranscriptTools {
  const anchorsAdditions = supportsToolAdditions && !hasNonAdditiveToolChanges(messages);
  return {
    requestTools: anchorsAdditions
      ? (getInitialSystemMessage(messages)?.toolsAdded ?? [])
      : getCurrentTools(messages),
    anchorsAdditions,
  };
}
