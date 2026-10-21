import { Function } from "effect";

import type typesModule from "../types.types.ts";
import textModule from "./text.ts";
import type transcriptTypes from "./transcript.types.ts";

const { contentText, getSystemMessageText } = textModule;

const createInitialSystemMessage: {
  (
    tools: typesModule.Tool[] | undefined,
  ): (systemPrompt: string | undefined) => typesModule.SystemMessage | undefined;
  (
    systemPrompt: string | undefined,
    tools: typesModule.Tool[] | undefined,
  ): typesModule.SystemMessage | undefined;
} = Function.dual(
  2,
  function (
    systemPrompt: string | undefined,
    tools: typesModule.Tool[] | undefined,
  ): typesModule.SystemMessage | undefined {
    const hasSystemPrompt = systemPrompt !== undefined && systemPrompt.length > 0;
    const hasTools = tools !== undefined && tools.length > 0;
    if (!hasSystemPrompt && !hasTools) return undefined;
    return {
      content: systemPrompt ?? "",
      role: "system",
      timestamp: 0,
      ...(hasTools ? { toolsAdded: tools } : {}),
    };
  },
);

function normalizeContext(context: typesModule.Context): typesModule.TranscriptContext {
  const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
  const messages =
    initialMessage === undefined ? context.messages : [initialMessage, ...context.messages];
  return { messages } as typesModule.TranscriptContext;
}

function isSystemMessage(message: { role: string }): message is typesModule.SystemMessage {
  return message.role === "system";
}

function getInitialSystemMessage(
  messages: transcriptTypes.TranscriptMessages,
): typesModule.SystemMessage | undefined {
  const first = messages[0];
  return first !== undefined && isSystemMessage(first) ? first : undefined;
}

function withoutInitialSystemMessage(messages: typesModule.Message[]): typesModule.Message[] {
  return getInitialSystemMessage(messages) === undefined ? messages : messages.slice(1);
}

function getCurrentTools(messages: transcriptTypes.TranscriptMessages): typesModule.Tool[] {
  const tools = new Map<string, typesModule.Tool>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
  }
  return [...tools.values()];
}

function getCurrentSystemMessage(
  messages: transcriptTypes.TranscriptMessages,
): typesModule.SystemMessage | undefined {
  const content: string[] = [];
  const sections = new Map<string, string>();
  let timestamp: number | undefined;
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    timestamp ??= message.timestamp;
    const text = contentText(message.content, "\n");
    if (text.length > 0) content.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  const tools = getCurrentTools(messages);
  if (timestamp === undefined && tools.length === 0) return undefined;
  return {
    content: content.join("\n\n"),
    role: "system",
    timestamp: timestamp ?? 0,
    ...(sections.size > 0 ? { sections: Object.fromEntries(sections) } : {}),
    ...(tools.length > 0 ? { toolsAdded: tools } : {}),
  };
}

function getCurrentSystemPrompt(messages: transcriptTypes.TranscriptMessages): string {
  const message = getCurrentSystemMessage(messages);
  return message === undefined ? "" : getSystemMessageText(message);
}

function collapseSystemMessages(
  context: typesModule.TranscriptContext,
): typesModule.TranscriptContext {
  const head = getCurrentSystemMessage(context.messages);
  const messages = context.messages.filter((message) => message.role !== "system");
  return {
    messages: head === undefined ? messages : [head, ...messages],
  } as typesModule.TranscriptContext;
}

const resolveTranscript: {
  (
    supportsMidConvoSystemMessages: boolean | undefined,
  ): (context: typesModule.TranscriptContext) => typesModule.TranscriptContext;
  (
    context: typesModule.TranscriptContext,
    supportsMidConvoSystemMessages: boolean | undefined,
  ): typesModule.TranscriptContext;
} = Function.dual(
  2,
  function (
    context: typesModule.TranscriptContext,
    supportsMidConvoSystemMessages: boolean | undefined,
  ): typesModule.TranscriptContext {
    return supportsMidConvoSystemMessages === true ? context : collapseSystemMessages(context);
  },
);

function toToolDeclaration(tool: typesModule.Tool): typesModule.Tool {
  return {
    description: tool.description,
    name: tool.name,
    parameters: JSON.parse(JSON.stringify(tool.parameters)) as typesModule.Tool["parameters"],
    ...(tool.constrainedSampling === undefined
      ? {}
      : { constrainedSampling: tool.constrainedSampling }),
  };
}

const declarationsEqual: {
  (right: typesModule.Tool): (left: typesModule.Tool) => boolean;
  (left: typesModule.Tool, right: typesModule.Tool): boolean;
} = Function.dual(2, function (left: typesModule.Tool, right: typesModule.Tool): boolean {
  return JSON.stringify(toToolDeclaration(left)) === JSON.stringify(toToolDeclaration(right));
});

const getToolStateChanges: {
  (
    current: readonly typesModule.Tool[],
  ): (previous: readonly typesModule.Tool[]) => transcriptTypes.ToolStateChanges;
  (
    previous: readonly typesModule.Tool[],
    current: readonly typesModule.Tool[],
  ): transcriptTypes.ToolStateChanges;
} = Function.dual(
  2,
  function (
    previous: readonly typesModule.Tool[],
    current: readonly typesModule.Tool[],
  ): transcriptTypes.ToolStateChanges {
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
  },
);

function getDeclaredTools(messages: transcriptTypes.TranscriptMessages): typesModule.Tool[] {
  const definitions = new Map<string, typesModule.Tool>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    for (const tool of message.toolsAdded ?? []) definitions.set(tool.name, tool);
  }
  return [...definitions.values()];
}

function hasToolRedefinitions(messages: transcriptTypes.TranscriptMessages): boolean {
  const declared = new Map<string, typesModule.Tool>();
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

function hasNonAdditiveToolChanges(messages: transcriptTypes.TranscriptMessages): boolean {
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

const resolveTranscriptTools: {
  (
    supportsToolAdditions: boolean,
  ): (messages: transcriptTypes.TranscriptMessages) => transcriptTypes.TranscriptTools;
  (
    messages: transcriptTypes.TranscriptMessages,
    supportsToolAdditions: boolean,
  ): transcriptTypes.TranscriptTools;
} = Function.dual(
  2,
  function (
    messages: transcriptTypes.TranscriptMessages,
    supportsToolAdditions: boolean,
  ): transcriptTypes.TranscriptTools {
    const anchorsAdditions = supportsToolAdditions && !hasNonAdditiveToolChanges(messages);
    return {
      anchorsAdditions,
      requestTools: anchorsAdditions
        ? (getInitialSystemMessage(messages)?.toolsAdded ?? [])
        : getCurrentTools(messages),
    };
  },
);

const transcript = {
  collapseSystemMessages,
  createInitialSystemMessage,
  declarationsEqual,
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  getDeclaredTools,
  getInitialSystemMessage,
  getToolStateChanges,
  hasNonAdditiveToolChanges,
  hasToolRedefinitions,
  normalizeContext,
  resolveTranscript,
  resolveTranscriptTools,
  toToolDeclaration,
  withoutInitialSystemMessage,
};

export default transcript;
