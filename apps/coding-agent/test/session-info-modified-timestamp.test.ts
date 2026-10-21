import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
const { initTheme } = themeModule;

const {
  awaited,
  currentTimeMillis,
  dirnameOf,
  fileModifiedMillis,
  isoFromMillis,
  joinPath,
  runTest,
  tempRoot,
  toJsonText,
  writeTextFile,
} = testing;

const createSessionFile = Effect.fn("createSessionFile")(function* (path: string) {
  const header: sessionManagerTypes.SessionHeader = {
    cwd: "/tmp",
    id: "test-session",
    timestamp: isoFromMillis(0),
    type: "session" as const,
    version: 3,
  };
  yield* writeTextFile(path, `${yield* toJsonText(header)}\n`);

  const mgr = yield* Effect.promise(() => SessionManager.open(path));
  mgr.appendMessage({
    api: "openai-completions" as const,
    content: [{ text: "hi", type: "text" as const }],
    model: "test",
    provider: "openai",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 1,
      output: 1,
      totalTokens: 2,
    },
  });
});

const usesLastUserAssistantMessageTimestampInstead = () =>
  runTest(
    Effect.gen(function* () {
      const filePath = joinPath(tempRoot(), `msa-session-${currentTimeMillis()}-modified.jsonl`);
      yield* createSessionFile(filePath);

      const before = yield* fileModifiedMillis(filePath);

      yield* Effect.sleep(10);

      const mgr = yield* Effect.promise(() => SessionManager.open(filePath));
      const msgTime = currentTimeMillis();
      mgr.appendMessage({
        api: "openai-completions" as const,
        content: [{ text: "later", type: "text" as const }],
        model: "test",
        provider: "openai",
        role: "assistant",
        stopReason: "stop",
        timestamp: msgTime,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 1,
          output: 1,
          totalTokens: 2,
        },
      });

      const sessions = yield* awaited(SessionManager.list("/tmp", dirnameOf(filePath)));
      const s = sessions.find((x) => x.path === filePath);
      expect(s).toBeDefined();
      expect(s!.modified.getTime()).toBe(msgTime);
      expect(s!.modified.getTime()).not.toBe(before);
    }),
  );

describe("SessionInfo.modified", () => {
  beforeAll(() => initTheme("dark"));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "uses last user/assistant message timestamp instead of file mtime",
    usesLastUserAssistantMessageTimestampInstead,
  );
});
