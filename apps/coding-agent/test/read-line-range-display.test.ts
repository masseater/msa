import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { runInNewContext } from "node:vm";

import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  joinPath,
  isoFromMillis,
  removePath,
} from "@msa/testing";
import type { TUI } from "@msa/tui";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { exportFromFile } from "../src/core/export-html/index.ts";
import {
  CURRENT_SESSION_VERSION,
  type SessionHeader,
  SessionManager,
  type SessionMessageEntry,
} from "../src/core/session-manager.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { formatReadLineRange } from "../src/core/tools/render-utils.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

interface HtmlViewer {
  formatReadLineRange: typeof formatReadLineRange;
  getTreeNodeDisplayHtml(entry: SessionMessageEntry): string;
  renderEntry(entry: SessionMessageEntry): string;
}

function loadHtmlViewer(html: string): HtmlViewer {
  const sessionData = html.match(
    /<script id="session-data" type="application\/json">([^<]+)<\/script>/u,
  )?.[1];
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].at(-1)?.[1];
  if (
    !(sessionData !== undefined && sessionData.length > 0) ||
    !(script !== undefined && script.length > 0)
  )
    throw new Error("Missing exported session data or viewer script");
  return runInNewContext(
    script.replace(
      "marked.use({",
      "return { formatReadLineRange, getTreeNodeDisplayHtml, renderEntry }; marked.use({",
    ),
    {
      atob,
      TextDecoder,
      URLSearchParams,
      document: { getElementById: () => ({ textContent: sessionData }), querySelector: () => null },
      window: { location: { search: "" } },
    },
  );
}

describe("read line range display", () => {
  let tempDir: string;
  const cases: [unknown, unknown, string][] = [
    [25, 13, ":25-37"],
    ["25", "13", ":25-37"],
    [null, "13", ":1-13"],
    ["25", null, ":25"],
    [undefined, undefined, ""],
    ["abc", 13, ""],
    [25, "", ""],
    [25, "Infinity", ""],
  ];

  beforeAll(() =>
    runTest(
      Effect.gen(function* () {
        initTheme("dark");
        tempDir = mkdtempSync(joinPath(tmpdir(), "msa-read-range-"));
      }),
    ),
  );

  afterAll(() => runTest(removePath(tempDir)));

  it("formats raw read arguments", () => {
    for (const [offset, limit, range] of cases) {
      expect(formatReadLineRange(offset, limit), `${offset}, ${limit}`).toBe(range);
    }
  });

  it("shows string ranges in the TUI, session tree, and HTML export", () =>
    runTest(
      Effect.gen(function* () {
        const args = { path: "notes.txt", offset: "25", limit: "13" };
        const assistant: SessionMessageEntry = {
          type: "message" as const,
          id: "assistant",
          parentId: null,
          timestamp: isoFromMillis(0),
          message: {
            role: "assistant",
            content: [{ type: "toolCall" as const, id: "call", name: "read", arguments: args }],
            api: "anthropic-messages" as const,
            provider: "anthropic-api",
            model: "test-model",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: 0,
          },
        };
        const result: SessionMessageEntry = {
          type: "message" as const,
          id: "result",
          parentId: assistant.id,
          timestamp: assistant.timestamp,
          message: {
            role: "toolResult",
            toolCallId: "call",
            toolName: "read",
            content: [],
            isError: false,
            timestamp: 0,
          },
        };
        const header = {
          type: "session" as const,
          version: CURRENT_SESSION_VERSION,
          id: "range-test",
          timestamp: assistant.timestamp,
          cwd: tempDir,
        } satisfies SessionHeader;
        const sessionPath = joinPath(tempDir, "session.jsonl");
        yield* writeTextFile(
          sessionPath,
          `${[header, assistant, result].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        );

        const tool = new ToolExecutionComponent(
          "read",
          "call",
          args,
          {},
          createReadToolDefinition(tempDir),

          { requestRender() {} } as TUI,
          tempDir,
        );
        expect(stripVTControlCharacters(tool.render(120).join("\n"))).toContain(
          "read notes.txt:25-37",
        );

        const tree = new TreeSelectorComponent(
          SessionManager.open(sessionPath).getTree(),
          result.id,
          40,
          () => {},
          () => {},
        );
        expect(tree.getTreeList().render(120).map(stripVTControlCharacters).join("\n")).toContain(
          "[read: notes.txt:25-37]",
        );

        const viewer = loadHtmlViewer(
          yield* readTextFile(
            yield* awaited(exportFromFile(sessionPath, joinPath(tempDir, "out.html"))),
          ),
        );
        for (const [offset, limit, range] of cases) {
          expect(viewer.formatReadLineRange(offset, limit), `${offset}, ${limit}`).toBe(range);
        }
        expect(viewer.getTreeNodeDisplayHtml(result)).toBe(
          '<span class="tree-role-tool">[read: notes.txt:25-37]</span>',
        );
        expect(viewer.renderEntry(assistant)).toContain('<span class="line-numbers">:25-37</span>');
      }),
    ));
});
