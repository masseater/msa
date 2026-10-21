import { runInNewContext } from "node:vm";

import testing from "@msa/testing";
import { Effect } from "effect";

import exportHtml from "../src/core/export-html/index.ts";
import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import sessionFormat from "../src/core/session-manager/session-format.ts";
import type renderUtils from "../src/core/tools/render-utils.ts";

const { CURRENT_SESSION_VERSION } = sessionFormat;
const { exportFromFile } = exportHtml;

const { awaited, isoFromMillis, joinPath, readTextFile, toJsonText, writeTextFile } = testing;

interface HtmlViewer {
  formatReadLineRange: typeof renderUtils.formatReadLineRange;
  getTreeNodeDisplayHtml(entry: sessionManagerTypes.SessionMessageEntry): string;
  renderEntry(entry: sessionManagerTypes.SessionMessageEntry): string;
}

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

const loadHtmlViewer = (html: string): HtmlViewer => {
  const sessionData = html.match(
    /<script id="session-data" type="application\/json">([^<]+)<\/script>/u,
  )?.[1];
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].at(-1)?.[1];
  if (sessionData === undefined || sessionData === "" || script === undefined || script === "")
    throw new Error("Missing exported session data or viewer script");
  return runInNewContext(
    script.replace(
      "marked.use({",
      "return { formatReadLineRange, getTreeNodeDisplayHtml, renderEntry }; marked.use({",
    ),
    {
      TextDecoder,
      URLSearchParams,
      atob,
      document: { getElementById: () => ({ textContent: sessionData }), querySelector: () => null },
      window: { location: { search: "" } },
    },
  );
};

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

const exportViewer = Effect.fn("exportViewer")(function* (sessionPath: string, tempDir: string) {
  const html = yield* readTextFile(
    yield* awaited(exportFromFile(sessionPath, joinPath(tempDir, "out.html"))),
  );
  return loadHtmlViewer(html);
});

const openTree = (sessionPath: string) =>
  SessionManager.open(sessionPath).then((sessionManager) => sessionManager.getTree());

const readLineRangeSupport = {
  RANGE_CASES,
  READ_ARGS,
  exportViewer,
  openTree,
  writeReadSession,
};

export default readLineRangeSupport;
