import type { AssistantMessage, ToolResultMessage, Usage } from "@msa/ai";
import testing from "@msa/testing";
import { Container, type TUI, Text } from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";

import type { AgentSession, AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { SessionEntry } from "../../../src/core/session-manager.ts";
import type { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import tuiKit from "../../tui-kit.ts";

const { initTheme, stripAnsi } = tuiKit;

const { currentTimeMillis, nowIso } = testing;

type AgentMessage = AgentSession["messages"][number];

const TOOL_CALL_ID = "tool-4167";
const TOOL_NAME = "slow_tool";

const EMPTY_USAGE: Usage = {
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

type RenderSessionItems = (
  this: RenderSessionContextThis,
  items: AgentMessage[],
  options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type RenderSessionContextThis = {
  pendingTools: Map<string, ToolExecutionComponent>;
  chatContainer: Container;
  footer: { invalidate(): void };
  programStatus: { handleEvent(): void };
  ui: TUI;
  settingsManager: {
    getShowImages(): boolean;
    getImageWidthCells(): number;
    getShowCacheMissNotices(): boolean;
  };
  sessionManager: { getCwd(): string; getEntries(): SessionEntry[] };
  session: {
    retryAttempt: number;
    modelRegistry: { find(provider: string, modelId: string): undefined };
  };
  toolOutputExpanded: boolean;
  isInitialized: boolean;
  updateEditorBorderColor(): void;
  getRegisteredToolDefinition(toolName: string): undefined;
  maybeShowAssistantDiagnostics(message: AssistantMessage): void;
  addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
  addToolExecution(component: ToolExecutionComponent): void;
  renderSessionItems: RenderSessionItems;
};

type RenderSessionEntries = (
  this: RenderSessionContextThis,
  entries: SessionEntry[],
  options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type HandleEvent = (this: RenderSessionContextThis, event: AgentSessionEvent) => Promise<void>;

function createFakeInteractiveModeThis(): RenderSessionContextThis {
  const chatContainer = new Container();
  return {
    addMessageToChat(message: AgentMessage) {
      chatContainer.addChild(new Text(message.role, 0, 0));
    },
    addToolExecution: Reflect.get(InteractiveMode.prototype, "addToolExecution"),
    chatContainer,
    footer: { invalidate: vi.fn() },
    getRegisteredToolDefinition: (_toolName: string) => undefined,
    isInitialized: true,
    maybeShowAssistantDiagnostics: vi.fn(),
    pendingTools: new Map<string, ToolExecutionComponent>(),
    programStatus: { handleEvent: vi.fn() },
    renderSessionItems: (
      InteractiveMode.prototype as unknown as { renderSessionItems: RenderSessionItems }
    ).renderSessionItems,
    session: { modelRegistry: { find: () => undefined }, retryAttempt: 0 },
    sessionManager: { getCwd: () => process.cwd(), getEntries: () => [] },
    settingsManager: {
      getImageWidthCells: () => 60,
      getShowCacheMissNotices: () => false,
      getShowImages: () => false,
    },
    toolOutputExpanded: false,
    ui: { requestRender: vi.fn() } as unknown as TUI,
    updateEditorBorderColor: vi.fn(),
  };
}

function createAssistantToolCallMessage(): AssistantMessage {
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

function createToolResultMessage(text: string): ToolResultMessage {
  return {
    content: [{ text, type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
  };
}

function createSessionEntries(messages: AgentMessage[]): SessionEntry[] {
  let parentId: string | null = null;
  return messages.map((message, index) => {
    const entry: SessionEntry = {
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

function renderChat(container: Container): string {
  return stripAnsi(container.render(120).join("\n"));
}

const keepsUnresolvedRenderedToolCallsRegistered = Effect.gen(function* () {
  const fakeThis = createFakeInteractiveModeThis();
  const renderSessionEntries = (
    InteractiveMode.prototype as unknown as { renderSessionEntries: RenderSessionEntries }
  ).renderSessionEntries;
  const handleEvent = (InteractiveMode.prototype as unknown as { handleEvent: HandleEvent })
    .handleEvent;

  renderSessionEntries.call(fakeThis, createSessionEntries([createAssistantToolCallMessage()]));

  expect(fakeThis.pendingTools.has(TOOL_CALL_ID)).toBe(true);

  yield* Effect.promise(() =>
    handleEvent.call(fakeThis, {
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
  const renderSessionEntries = (
    InteractiveMode.prototype as unknown as { renderSessionEntries: RenderSessionEntries }
  ).renderSessionEntries;

  renderSessionEntries.call(
    fakeThis,
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
