import { payloadText } from "./conversation-view-content.ts";
import type {
  AuditDoc,
  ConfigDoc,
  DocumentKey,
  InboxDoc,
  InboxItem,
  JsonObject,
  LiveDoc,
  PreferencesDoc,
  TurnDoc,
} from "./conversation-view-types.ts";

const configDocument = (): ConfigDoc => {
  const sections = Array.from({ length: 32 }, (_, index) => ({
    id: `section-${index}`,
    title: `Configuration section ${index}`,
    instructions: payloadText(1_850 + (index % 5) * 80, 10_000 + index),
  }));
  const tools = Array.from({ length: 24 }, (_, index) => ({
    name: `tool_${index}`,
    description: payloadText(320 + (index % 4) * 40, 20_000 + index),
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: payloadText(120, 30_000 + index) },
        query: { type: "string", description: payloadText(120, 31_000 + index) },
      },
      required: ["path"],
    },
  }));
  return {
    schema: "pico5.doc.config.provisional.v0",
    model: { provider: "anthropic", modelId: "claude-sonnet-provisional" },
    thinkingLevel: "medium",
    selectedTools: tools.slice(0, 12).map((tool) => tool.name),
    sections,
    tools,
    temperature: 0.2,
    revision: 0,
  };
};

const inboxDocument = (): InboxDoc => ({
  schema: "pico5.doc.inbox.provisional.v0",
  items: Array.from({ length: 16 }, (_, index): InboxItem => ({
    id: index + 1,
    mode: index % 3 === 0 ? "steer" : "followUp",
    text: payloadText(960 + (index % 4) * 48, 40_000 + index),
  })),
  revision: 0,
});

const turnDocument = (): TurnDoc => ({
  schema: "pico5.doc.turn.provisional.v0",
  stage: "streaming",
  message: payloadText(640, 60_000),
  toolSlots: [{ callId: "initial-call-0", name: "read", status: "running", preview: "reading" }],
  revision: 0,
});

const preferencesDocument = (): PreferencesDoc => ({
  schema: "pico5.doc.preferences.provisional.v0",
  theme: "dark",
  keymap: "default",
  compactTools: false,
  fontScale: 1,
  editorProfile: payloadText(2_400, 70_000),
  shortcuts: Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => [
      `command.${index}`,
      `ctrl+${String.fromCharCode(97 + index)}`,
    ]),
  ),
  revision: 0,
});

const liveDocument = (): LiveDoc => ({
  schema: "pico5.doc.live.provisional.v0",
  status: "streaming",
  tokens: 8_192,
  cost: 0.024,
  heartbeat: 0,
  generation: { stage: "streaming", attempt: 1, partial: payloadText(8_192, 80_000) },
  tools: Array.from({ length: 8 }, (_, index) => ({
    callId: `initial-call-${index}`,
    name: index % 2 === 0 ? "read" : "bash",
    status: index < 2 ? "running" : "waiting",
    progress: index < 2 ? 0.25 : 0,
    output: payloadText(640 + index * 96, 50_000 + index),
  })),
});

const auditDocument = (): AuditDoc => ({
  schema: "pico5.doc.audit.unmounted.provisional.v0",
  commits: 0,
  note: "",
});

export const initialDocuments = (): Record<DocumentKey, JsonObject> => ({
  config: configDocument(),
  inbox: inboxDocument(),
  turn: turnDocument(),
  preferences: preferencesDocument(),
  live: liveDocument(),
  audit: auditDocument(),
});
