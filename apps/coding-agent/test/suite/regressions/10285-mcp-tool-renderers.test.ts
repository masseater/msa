import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type extensionsTypesTypes from "../../../src/core/extensions/types.types.ts";
import extension from "../../../src/extensions/mcp/extension.ts";
import codingAgent from "../../../src/index.ts";
import type codingAgentTypes from "../../../src/index.types.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { SessionManager } = codingAgent;

const { createMcpExtension } = extension;
const { initTheme, stripAnsi, theme } = tuiKit;

const { createHarness } = harnessModule;

const { fromJsonText, joinPath } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const mcpExtension = createMcpExtension({ loadConfig: () => ({ errors: [], servers: [] }) });

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
    } as unknown as extensionsTypesTypes.ToolRenderContext);
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
  const sessionManager = SessionManager.create(dir, joinPath(dir, "sessions"));
  const harness = yield* Effect.promise(() =>
    createHarness({ extensionFactories: [mcpExtension], sessionManager }),
  );
  return yield* rendersThemInHtmlExportsTooStep1(dir, sessionManager, harness);
});

const rendersThemInHtmlExportsTooStep1 = (
  dir: string,
  sessionManager: codingAgentTypes.SessionManager,
  harness: harnessTypes.Harness,
) =>
  Effect.gen(function* () {
    try {
      sessionManager.appendMessage({ content: "search", role: "user", timestamp: 1 });
      sessionManager.appendMessage({
        api: "anthropic-messages",
        content: [
          {
            arguments: { query: "msa" },
            id: "call-1",
            name: "mcp__my_docs__search",
            type: "toolCall",
          },
        ],
        model: "test",
        provider: "anthropic-api",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 2,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      });

      const html = yield* fs.readFileString(
        yield* Effect.promise(() => harness.session.exportToHtml(joinPath(dir, "export.html"))),
      );
      const data =
        /<script id="session-data" type="application\/json">([^<]*)<\/script>/u.exec(html)?.[1] ??
        "";
      const session = (yield* fromJsonText(Buffer.from(data, "base64").toString("utf8"))) as {
        renderedTools?: Record<string, { callHtml?: string }>;
      };
      expect(stripAnsi(session.renderedTools?.["call-1"]?.callHtml ?? "")).toContain(
        "my_docs/search",
      );
    } finally {
      harness.cleanup();
      yield* fs.remove(dir, { force: true, recursive: true });
    }
  });

const rendersCallsToMcpToolsThatAre = () => Effect.runPromise(rendersCallsToMcpToolsThat);

const rendersThemInHtmlExportsToo2 = () => Effect.runPromise(rendersThemInHtmlExportsToo);

describe("MCP tool renderers", () => {
  it("renders calls to MCP tools that are not registered", rendersCallsToMcpToolsThatAre);
  it("renders them in HTML exports too", rendersThemInHtmlExportsToo2);
});
