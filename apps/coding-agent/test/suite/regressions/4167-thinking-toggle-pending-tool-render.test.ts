import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";

import type codingAgentTypes from "../../../src/index.types.ts";
import type toolExecutionTypes from "../../../src/modes/interactive/components/tool-execution.types.ts";
import interactiveModeFake from "../../interactive-mode-fake.ts";
import tuiKit from "../../tui-kit.ts";

const { bindModeFake } = interactiveModeFake;

const { Container, Text } = tui;

const { initTheme, stripAnsi } = tuiKit;

const { currentTimeMillis, nowIso } = testing;

type AgentMessage = codingAgentTypes.AgentSession["messages"][number];

const TOOL_CALL_ID = "tool-4167";
const TOOL_NAME = "slow_tool";

const EMPTY_USAGE: aiTypes.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
    total: 0,
  },
  input: 0,
  output: 0,
  totalTokens: 0,
};
type RenderSessionContextThis = {
  pendingTools: Map<string, toolExecutionTypes.ToolExecutionComponent>;
  chatContainer: tuiTypes.Container;
  footer: { invalidate(): void };
  programStatus: { handleEvent(): void };
  ui: tuiTypes.TUI;
  settingsManager: {
    display: {
      getImageWidthCells(): number;
      getShowCacheMissNotices(): boolean;
      getShowImages(): boolean;
    };
  };
  sessionManager: { getCwd(): string; getEntries(): codingAgentTypes.SessionEntry[] };
  session: {
    modelRegistry: { find(provider: string, modelId: string): undefined };
    run: { retry: { retryAttempt: number } };
  };
  toolOutputExpanded: boolean;
  isInitialized: boolean;
  updateEditorBorderColor(): void;
  getRegisteredToolDefinition(toolName: string): undefined;
  maybeShowAssistantDiagnostics(message: aiTypes.AssistantMessage): void;
  addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
};

function createFakeInteractiveModeThis(): RenderSessionContextThis {
  const chatContainer = new Container();
  return {
    addMessageToChat(message: AgentMessage) {
      chatContainer.addChild(new Text(message.role, 0, 0));
    },
    chatContainer,
    footer: { invalidate: vi.fn() },
    getRegisteredToolDefinition: (_toolName: string) => undefined,
    isInitialized: true,
    maybeShowAssistantDiagnostics: vi.fn(),
    pendingTools: new Map<string, toolExecutionTypes.ToolExecutionComponent>(),
    programStatus: { handleEvent: vi.fn() },
    session: { modelRegistry: { find: () => undefined }, run: { retry: { retryAttempt: 0 } } },
    sessionManager: { getCwd: () => process.cwd(), getEntries: () => [] },
    settingsManager: {
      display: {
        getImageWidthCells: () => 60,
        getShowCacheMissNotices: () => false,
        getShowImages: () => false,
      },
    },
    toolOutputExpanded: false,
    ui: { requestRender: vi.fn() } as unknown as tuiTypes.TUI,
    updateEditorBorderColor: vi.fn(),
  };
}

function createAssistantToolCallMessage(): aiTypes.AssistantMessage {
  return {
    api: "test-api",
    content: [
      {
        arguments: { delayMs: 10_000 },
        id: TOOL_CALL_ID,
        name: TOOL_NAME,
        type: "toolCall",
      },
    ],
    model: "test-model",
    provider: "test-provider",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: currentTimeMillis(),
    usage: EMPTY_USAGE,
  };
}

function createToolResultMessage(text: string): aiTypes.ToolResultMessage {
  return {
    content: [{ text, type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
  };
}

function createSessionEntries(messages: AgentMessage[]): codingAgentTypes.SessionEntry[] {
  let parentId: string | null = null;
  return messages.map((message, index) => {
    const entry: codingAgentTypes.SessionEntry = {
      id: `entry-${index}`,
      message,
      parentId,
      timestamp: nowIso(),
      type: "message",
    };
    parentId = entry.id;
    return entry;
  });
}

function renderChat(container: tuiTypes.Container): string {
  return stripAnsi(container.render(120).join("\n"));
}

const keepsUnresolvedRenderedToolCallsRegistered = Effect.gen(function* () {
  const fakeThis = createFakeInteractiveModeThis();
  bindModeFake(fakeThis);
  bindModeFake(fakeThis).view.history.renderSessionEntries(
    createSessionEntries([createAssistantToolCallMessage()]),
  );

  expect(fakeThis.pendingTools.has(TOOL_CALL_ID)).toBe(true);

  bindModeFake(fakeThis);
  yield* Effect.promise(() =>
    bindModeFake(fakeThis).lifecycle.events.handleEvent({
      isError: false,
      result: { content: [{ text: "FINAL_RESULT", type: "text" }], details: undefined },
      toolCallId: TOOL_CALL_ID,
      toolName: TOOL_NAME,
      type: "tool_execution_end",
    }),
  );

  expect(fakeThis.pendingTools.has(TOOL_CALL_ID)).toBe(false);
  expect(renderChat(fakeThis.chatContainer)).toContain("FINAL_RESULT");
});

const doesNotKeepCompletedHistoricalTool = () => {
  const fakeThis = createFakeInteractiveModeThis();
  bindModeFake(fakeThis);
  bindModeFake(fakeThis).view.history.renderSessionEntries(
    createSessionEntries([
      createAssistantToolCallMessage(),
      createToolResultMessage("HISTORICAL_RESULT"),
    ]),
  );

  expect(fakeThis.pendingTools.size).toBe(0);
  expect(renderChat(fakeThis.chatContainer)).toContain("HISTORICAL_RESULT");
};

const keepsUnresolvedRenderedToolCallsRegisteredFor = () =>
  Effect.runPromise(keepsUnresolvedRenderedToolCallsRegistered);

describe("InteractiveMode.renderSessionEntries", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  test(
    "keeps unresolved rendered tool calls registered for live completion events",
    keepsUnresolvedRenderedToolCallsRegisteredFor,
  );
  test(
    "does not keep completed historical tool calls registered as pending",
    doesNotKeepCompletedHistoricalTool,
  );
});
