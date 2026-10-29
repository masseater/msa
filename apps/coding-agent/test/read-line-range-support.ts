import testing from "@msa/testing";
import { Effect } from "effect";

import exportHtml from "../src/core/export-html/index.ts";
import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import sessionFormat from "../src/core/session-manager/session-format.ts";

const { CURRENT_SESSION_VERSION } = sessionFormat;
const { exportFromFile } = exportHtml;

const { awaited, isoFromMillis, joinPath, readTextFile, toJsonText, writeTextFile } = testing;

const RANGE_CASES: [unknown, unknown, string][] = [
  [25, 13, ":25-37"],
  ["25", "13", ":25-37"],
  [null, "13", ":1-13"],
  ["25", null, ":25"],
  [undefined, undefined, ""],
  ["abc", 13, ""],
  [25, "", ""],
  [25, "Infinity", ""],
];

const READ_ARGS = { limit: "13", offset: "25", path: "notes.txt" };

const assistantEntry = (): sessionManagerTypes.SessionMessageEntry => ({
  id: "assistant",
  message: {
    api: "anthropic-messages",
    content: [{ arguments: READ_ARGS, id: "call", name: "read", type: "toolCall" }],
    model: "test-model",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  },
  parentId: null,
  timestamp: isoFromMillis(0),
  type: "message",
});

const resultEntry = (
  assistant: sessionManagerTypes.SessionMessageEntry,
): sessionManagerTypes.SessionMessageEntry => ({
  id: "result",
  message: {
    content: [],
    isError: false,
    role: "toolResult",
    timestamp: 0,
    toolCallId: "call",
    toolName: "read",
  },
  parentId: assistant.id,
  timestamp: assistant.timestamp,
  type: "message",
});

const writeReadSession = Effect.fn("writeReadSession")(function* (tempDir: string) {
  const assistant = assistantEntry();
  const result = resultEntry(assistant);
  const header = {
    cwd: tempDir,
    id: "range-test",
    timestamp: assistant.timestamp,
    type: "session" as const,
    version: CURRENT_SESSION_VERSION,
  } satisfies sessionManagerTypes.SessionHeader;
  const sessionPath = joinPath(tempDir, "session.jsonl");
  const lines = yield* Effect.forEach([header, assistant, result], toJsonText);
  yield* writeTextFile(sessionPath, `${lines.join("\n")}\n`);
  return { assistant, result, sessionPath };
});

const exportedHtml = Effect.fn("exportedHtml")(function* (sessionPath: string, tempDir: string) {
  return yield* readTextFile(
    yield* awaited(exportFromFile(sessionPath, joinPath(tempDir, "out.html"))),
  );
});

const openTree = (sessionPath: string) =>
  SessionManager.open(sessionPath).then((sessionManager) => sessionManager.getTree());

const readLineRangeSupport = {
  RANGE_CASES,
  READ_ARGS,
  exportedHtml,
  openTree,
  writeReadSession,
};

export default readLineRangeSupport;
