import conversationViewContent from "./conversation-view-content.ts";
import type conversationViewTypes from "./conversation-view-types.types.ts";

const { payloadText } = conversationViewContent;

const configDocument = (): conversationViewTypes.ConfigDoc => {
  const sections = Array.from({ length: 32 }, (_, index) => ({
    id: `section-${index}`,
    instructions: payloadText(1_850 + (index % 5) * 80, 10_000 + index),
    title: `Configuration section ${index}`,
  }));
  const tools = Array.from({ length: 24 }, (_, index) => ({
    description: payloadText(320 + (index % 4) * 40, 20_000 + index),
    inputSchema: {
      properties: {
        path: { description: payloadText(120, 30_000 + index), type: "string" },
        query: { description: payloadText(120, 31_000 + index), type: "string" },
      },
      required: ["path"],
      type: "object",
    },
    name: `tool_${index}`,
  }));
  return {
    model: { modelId: "claude-sonnet-provisional", provider: "anthropic-api" },
    revision: 0,
    schema: "pico5.doc.config.provisional.v0",
    sections,
    selectedTools: tools.slice(0, 12).map((tool) => tool.name),
    temperature: 0.2,
    thinkingLevel: "medium",
    tools,
  };
};

const inboxDocument = (): conversationViewTypes.InboxDoc => ({
  items: Array.from({ length: 16 }, (_, index): conversationViewTypes.InboxItem => ({
    id: index + 1,
    mode: index % 3 === 0 ? "steer" : "followUp",
    text: payloadText(960 + (index % 4) * 48, 40_000 + index),
  })),
  revision: 0,
  schema: "pico5.doc.inbox.provisional.v0",
});

const turnDocument = (): conversationViewTypes.TurnDoc => ({
  message: payloadText(640, 60_000),
  revision: 0,
  schema: "pico5.doc.turn.provisional.v0",
  stage: "streaming",
  toolSlots: [{ callId: "initial-call-0", name: "read", preview: "reading", status: "running" }],
});

const preferencesDocument = (): conversationViewTypes.PreferencesDoc => ({
  compactTools: false,
  editorProfile: payloadText(2_400, 70_000),
  fontScale: 1,
  keymap: "default",
  revision: 0,
  schema: "pico5.doc.preferences.provisional.v0",
  shortcuts: Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => [
      `command.${index}`,
      `ctrl+${String.fromCharCode(97 + index)}`,
    ]),
  ),
  theme: "dark",
});

const liveDocument = (): conversationViewTypes.LiveDoc => ({
  cost: 0.024,
  generation: { attempt: 1, partial: payloadText(8_192, 80_000), stage: "streaming" },
  heartbeat: 0,
  schema: "pico5.doc.live.provisional.v0",
  status: "streaming",
  tokens: 8_192,
  tools: Array.from({ length: 8 }, (_, index) => ({
    callId: `initial-call-${index}`,
    name: index % 2 === 0 ? "read" : "bash",
    output: payloadText(640 + index * 96, 50_000 + index),
    progress: index < 2 ? 0.25 : 0,
    status: index < 2 ? "running" : "waiting",
  })),
});

const auditDocument = (): conversationViewTypes.AuditDoc => ({
  commits: 0,
  note: "",
  schema: "pico5.doc.audit.unmounted.provisional.v0",
});

const initialDocuments = (): Record<
  conversationViewTypes.DocumentKey,
  conversationViewTypes.JsonObject
> => ({
  audit: auditDocument(),
  config: configDocument(),
  inbox: inboxDocument(),
  live: liveDocument(),
  preferences: preferencesDocument(),
  turn: turnDocument(),
});

export default initialDocuments;
