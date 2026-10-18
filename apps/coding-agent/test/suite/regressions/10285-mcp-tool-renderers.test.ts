import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { ToolRenderContext } from "../../../src/core/extensions/types.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { createMcpExtension } from "../../../src/extensions/mcp/index.ts";
import { initTheme, theme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { parseJson } from "../../test-json.ts";
import { join } from "../../test-path.ts";
import { createHarness } from "../harness.ts";
import type { Harness } from "../harness.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const mcpExtension = createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) });

const rendersCallsToMcpToolsThat = Effect.gen(function* () {
  initTheme("dark");
  const harness = yield* Effect.promise(() =>
    createHarness({ extensionFactories: [mcpExtension] }),
  );
  try {
    const resolve = (toolName: string) =>
      harness.session.extensionRunner.resolveToolRenderers(toolName, () =>
        harness.session.getToolDefinition(toolName),
      );

    const call = resolve("mcp__my_docs__search")?.renderCall?.({ query: "msa" }, theme, {
      expanded: false,
    } as unknown as ToolRenderContext);
    expect(stripAnsi(call?.render(100).join("\n") ?? "")).toContain('my_docs/search query="msa"');
    expect(resolve("not_mcp")).toBeUndefined();

    expect(resolve("read")?.renderCall).toBe(harness.session.getToolDefinition("read")?.renderCall);
  } finally {
    harness.cleanup();
  }
});

const rendersThemInHtmlExportsToo = Effect.gen(function* () {
  initTheme("dark");
  const dir = yield* fs.makeTempDirectory({ prefix: "msa-10285-" });
  const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
  const harness = yield* Effect.promise(() =>
    createHarness({ extensionFactories: [mcpExtension], sessionManager }),
  );
  return yield* rendersThemInHtmlExportsTooPart2(dir, sessionManager, harness);
});

const rendersThemInHtmlExportsTooPart2 = (
  dir: string,
  sessionManager: SessionManager,
  harness: Harness,
) =>
  Effect.gen(function* () {
    try {
      sessionManager.appendMessage({ role: "user", content: "search", timestamp: 1 });
      sessionManager.appendMessage({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "mcp__my_docs__search",
            arguments: { query: "msa" },
          },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2,
      });

      const html = yield* fs.readFileString(
        yield* Effect.promise(() => harness.session.exportToHtml(join(dir, "export.html"))),
      );
      const data =
        /<script id="session-data" type="application\/json">([^<]*)<\/script>/u.exec(html)?.[1] ??
        "";
      const session = parseJson(Buffer.from(data, "base64").toString("utf8")) as {
        renderedTools?: Record<string, { callHtml?: string }>;
      };
      expect(stripAnsi(session.renderedTools?.["call-1"]?.callHtml ?? "")).toContain(
        "my_docs/search",
      );
    } finally {
      harness.cleanup();
      yield* fs.remove(dir, { recursive: true, force: true });
    }
  });

describe("MCP tool renderers", () => {
  it("renders calls to MCP tools that are not registered", () =>
    Effect.runPromise(rendersCallsToMcpToolsThat));
  it("renders them in HTML exports too", () => Effect.runPromise(rendersThemInHtmlExportsToo));
});
