import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import type autoCompactionQueueSupportTypes from "./agent-session-auto-compaction-queue-support.types.ts";
import sessionKit from "./session-kit.ts";

const { streamSimple } = compat;

const { awaited, currentTimeMillis, runTest } = testing;
const { createAgentSession, disposeWorkspace, prepareWorkspace } = sessionKit;

const state: {
  session: agentSessionTypes.AgentSession | undefined;
  sessionManager: sessionManagerTypes.SessionManager | undefined;
  settingsManager: settingsManagerTypes.SettingsManager | undefined;
  tempDir: string;
} = { session: undefined, sessionManager: undefined, settingsManager: undefined, tempDir: "" };

const harness = () => ({
  session: state.session!,
  sessionManager: state.sessionManager!,
  settingsManager: state.settingsManager!,
});

const prepare = (): Promise<void> =>
  runTest(
    Effect.gen(function* () {
      state.tempDir = yield* prepareWorkspace("msa-auto-compaction-queue-");
      const created = yield* createAgentSession({ cwd: state.tempDir, streamFn: streamSimple });
      state.session = created.session;
      state.sessionManager = created.sessionManager;
      state.settingsManager = created.settingsManager;
    }),
  );

const cleanUp = (): Promise<void> =>
  runTest(
    Effect.gen(function* () {
      vi.restoreAllMocks();
      yield* disposeWorkspace(state.session, state.tempDir);
      state.session = undefined;
    }),
  );

const usage = (input: number, output = 0): compatTypes.AssistantMessage["usage"] => ({
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input,
  output,
  totalTokens: input + output,
});

const modelMessage = (
  options: autoCompactionQueueSupportTypes.ModelMessageOptions,
): compatTypes.AssistantMessage => {
  const model = state.session!.model!;
  return {
    api: model.api,
    content: [{ text: options.text ?? "", type: "text" }],
    ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: options.errorMessage === undefined ? "stop" : "error",
    timestamp: options.timestamp ?? currentTimeMillis(),
    usage: usage(options.input ?? 0, options.output ?? 0),
  };
};

const overloaded = (timestamp?: number): compatTypes.AssistantMessage =>
  modelMessage({
    errorMessage: "529 overloaded",
    ...(timestamp === undefined ? {} : { timestamp }),
  });

const userMessage = (text: string, timestamp: number) => ({
  content: [{ text, type: "text" as const }],
  role: "user" as const,
  timestamp,
});

const spyAutoCompaction = () =>
  vi
    .spyOn(
      state.session as unknown as {
        runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<void>;
      },
      "runAutoCompaction",
    )
    .mockResolvedValue();

const checkCompaction = (message: compatTypes.AssistantMessage, skipAbortedCheck?: boolean) => {
  const session = state.session as unknown as {
    checkCompaction: (
      message: compatTypes.AssistantMessage,
      skipAbortedCheck?: boolean,
    ) => Promise<void>;
  };
  return awaited(session.checkCompaction(message, skipAbortedCheck));
};

const appendCompactedHistory = (
  assistant: compatTypes.AssistantMessage,
  userText: string,
): void => {
  const { sessionManager } = harness();
  sessionManager.appendMessage(userMessage(userText, assistant.timestamp - 1000));
  sessionManager.appendMessage(assistant);
  const firstKeptEntryId = sessionManager.getEntries()[0]!.id;
  sessionManager.appendCompaction(
    "summary",
    firstKeptEntryId,
    assistant.usage.totalTokens,
    undefined,
    false,
  );
};

const autoCompactionQueueSupport = {
  appendCompactedHistory,
  checkCompaction,
  cleanUp,
  harness,
  modelMessage,
  overloaded,
  prepare,
  spyAutoCompaction,
  usage,
  userMessage,
};

export default autoCompactionQueueSupport;
