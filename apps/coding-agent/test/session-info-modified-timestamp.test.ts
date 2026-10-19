import { writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  awaited,
  runTest,
  currentTimeMillis,
  joinPath,
  dirnameOf,
  isoFromMillis,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { SessionHeader } from "../src/core/session-manager.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createSessionFile(path: string): void {
  const header: SessionHeader = {
    type: "session" as const,
    id: "test-session",
    version: 3,
    timestamp: isoFromMillis(0),
    cwd: "/tmp",
  };
  writeFileSync(path, `${JSON.stringify(header)}\n`, "utf8");

  const mgr = SessionManager.open(path);
  mgr.appendMessage({
    role: "assistant",
    content: [{ type: "text" as const, text: "hi" }],
    api: "openai-completions" as const,
    provider: "openai",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: currentTimeMillis(),
  });
}

describe("SessionInfo.modified", () => {
  beforeAll(() => initTheme("dark"));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses last user/assistant message timestamp instead of file mtime", () =>
    runTest(
      Effect.gen(function* () {
        const filePath = joinPath(tmpdir(), `msa-session-${currentTimeMillis()}-modified.jsonl`);
        createSessionFile(filePath);

        const before = yield* awaited(stat(filePath));

        yield* Effect.sleep(10);

        const mgr = SessionManager.open(filePath);
        const msgTime = currentTimeMillis();
        mgr.appendMessage({
          role: "assistant",
          content: [{ type: "text" as const, text: "later" }],
          api: "openai-completions" as const,
          provider: "openai",
          model: "test",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: msgTime,
        });

        const sessions = yield* awaited(SessionManager.list("/tmp", dirnameOf(filePath)));
        const s = sessions.find((x) => x.path === filePath);
        expect(s).toBeDefined();
        expect(s!.modified.getTime()).toBe(msgTime);
        expect(s!.modified.getTime()).not.toBe(before.mtime.getTime());
      }),
    ));
});
