import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@msa/agent-core";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { EMPTY_ENTER_BURST_IDLE } from "../src/modes/interactive/empty-enter-burst.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic-api",
    model: "mock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function userTexts(messages: readonly { role: string; content: unknown }[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((part: { type: string; text?: string }) =>
      part.type === "text" && part.text !== undefined ? [part.text] : [],
    );
  });
}

type SubmitHandler = (text: string) => unknown;

describe("InteractiveMode empty Enter flush", () => {
  let tempDir: string;
  let session: AgentSession;
  let clock: number;

  beforeEach(() => {
    tempDir = join(tmpdir(), `msa-flush-queue-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ memory: { enabled: false } }));
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    session?.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function createHarness() {
    const requests: string[][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = new Agent({
      getApiKey: () => "test-key",
      initialState: {
        model: getModel("anthropic-api", "claude-sonnet-4-5")!,
        systemPrompt: "Test",
        tools: [],
      },
      streamFn: (_model, context) => {
        requests.push(userTexts(context.messages));
        const stream = createAssistantMessageEventStream();
        const finish = () =>
          stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
        if (requests.length === 1) {
          void gate.then(finish);
        } else {
          queueMicrotask(finish);
        }
        return stream;
      },
    });
    const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
    const modelRegistry = await createModelRegistry(authStorage, tempDir);
    await authStorage.modify("anthropic-api", async () => ({ type: "api_key", key: "test-key" }));
    session = new AgentSession({
      agent,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.create(tempDir, tempDir),
      cwd: tempDir,
      modelRuntime: getModelRuntime(modelRegistry),
      resourceLoader: createTestResourceLoader(),
    });

    const queueEvents: Array<{ steering: readonly string[]; followUp: readonly string[] }> = [];
    session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "queue_update") {
        queueEvents.push({ steering: event.steering, followUp: event.followUp });
      }
    });

    const statuses: string[] = [];
    const proto = InteractiveMode.prototype;
    const handleEmptyEnter = Reflect.get(proto, "handleEmptyEnter") as (this: object) => void;
    const setupEditorSubmitHandler = Reflect.get(proto, "setupEditorSubmitHandler") as (
      this: object,
    ) => void;
    const fake = {
      session,
      emptyEnterBurst: EMPTY_ENTER_BURST_IDLE,
      defaultEditor: { onSubmit: undefined as SubmitHandler | undefined },
      editor: { addToHistory: () => {}, setText: () => {} },
      ui: { requestRender: () => {} },
      showStatus: (message: string) => statuses.push(message),
      updatePendingMessagesDisplay: () => {},
      handleEmptyEnter: () => handleEmptyEnter.call(fake),
    };
    setupEditorSubmitHandler.call(fake);
    const onSubmit = fake.defaultEditor.onSubmit!;

    const firstRun = session.prompt("start");
    const startedAt = Date.now();
    while (!session.isStreaming) {
      if (Date.now() - startedAt > 5000 && clock === startedAt) {
        throw new Error("Timed out waiting for streaming");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    async function pressEnter(text: string, at: number) {
      clock = at;
      await onSubmit(text);
    }

    return { requests, release, firstRun, queueEvents, statuses, pressEnter };
  }

  test("three empty Enters send every queued message in input order and empty the queue", async () => {
    const harness = await createHarness();
    await harness.pressEnter("A", 1_000_000);
    await session.prompt("B", { streamingBehavior: "followUp" });
    await harness.pressEnter("C", 1_000_050);
    expect(session.getSteeringMessages()).toEqual(["A", "C"]);
    expect(session.getFollowUpMessages()).toEqual(["B"]);

    await harness.pressEnter("", 1_000_100);
    await harness.pressEnter("", 1_000_200);
    expect(harness.statuses).toEqual([]);
    await harness.pressEnter("", 1_000_300);

    expect(harness.statuses).toEqual(["Sent 3 queued messages"]);
    harness.release();
    await harness.firstRun;

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1]).toEqual(["start", "A", "B", "C"]);
    expect(session.pendingMessageCount).toBe(0);
    expect(harness.queueEvents.at(-1)).toEqual({ steering: [], followUp: [] });
  });

  test("a gap longer than one second between empty Enters resets the count", async () => {
    const harness = await createHarness();
    await harness.pressEnter("A", 1_000_000);
    await harness.pressEnter("", 1_000_100);
    await harness.pressEnter("", 1_000_200);
    await harness.pressEnter("", 1_001_201);
    await harness.pressEnter("", 1_001_300);

    expect(harness.statuses).toEqual([]);
    expect(session.pendingMessageCount).toBe(1);

    await harness.pressEnter("", 1_001_400);
    expect(harness.statuses).toEqual(["Sent 1 queued message"]);

    harness.release();
    await harness.firstRun;
  });

  test("an Enter with text does not count toward the three presses", async () => {
    const harness = await createHarness();
    await harness.pressEnter("A", 1_000_000);
    await harness.pressEnter("", 1_000_100);
    await harness.pressEnter("", 1_000_200);
    await harness.pressEnter("B", 1_000_300);
    await harness.pressEnter("", 1_000_400);

    expect(harness.statuses).toEqual([]);
    expect(session.getSteeringMessages()).toEqual(["A", "B"]);

    harness.release();
    await harness.firstRun;
  });

  test("three empty Enters with nothing queued do nothing", async () => {
    const harness = await createHarness();
    await harness.pressEnter("", 1_000_000);
    await harness.pressEnter("", 1_000_100);
    await harness.pressEnter("", 1_000_200);

    expect(harness.statuses).toEqual([]);
    expect(session.pendingMessageCount).toBe(0);
    expect(harness.queueEvents).toEqual([]);

    harness.release();
    await harness.firstRun;
    expect(harness.requests).toHaveLength(1);
  });
});
