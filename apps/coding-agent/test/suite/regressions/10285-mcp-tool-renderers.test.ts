import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type extensionsTypesTypes from "../../../src/core/extensions/types.types.ts";
import extension from "../../../src/extensions/mcp/extension.ts";
import codingAgent from "../../../src/index.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { SessionManager } = codingAgent;

const { createMcpExtension } = extension;
const { initTheme, stripAnsi, theme } = tuiKit;

const { createHarness } = harnessModule;

const { awaited, joinPath } = testing;

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
      harness.session.extensions.binding.extensionRunner.resolveToolRenderers(toolName, () =>
        harness.session.tools.registry.getToolDefinition(toolName),
      );

    const call = resolve("mcp__my_docs__search")?.renderCall?.({ query: "msa" }, theme, {
      expanded: false,
    } as unknown as extensionsTypesTypes.ToolRenderContext);
    expect(stripAnsi(call?.render(100).join("\n") ?? "")).toContain('my_docs/search query="msa"');
    expect(resolve("not_mcp")).toBeUndefined();

    expect(resolve("read")?.renderCall).toBe(
      harness.session.tools.registry.getToolDefinition("read")?.renderCall,
    );
  } finally {
    yield* awaited(harness.cleanup());
  }
});

const appendMcpToolTurn = (sessionManager: ReturnType<typeof SessionManager.inMemory>) => {
  sessionManager.appendMessage({ content: "search", role: "user", timestamp: 1 });
  sessionManager.appendMessage({
    api: "anthropic-messages",
    content: [
      { arguments: { query: "msa" }, id: "call-1", name: "mcp__my_docs__search", type: "toolCall" },
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
};

const exportedToolCallHtml = (harness: harnessTypes.Harness, dir: string) =>
  Effect.gen(function* () {
    const html = yield* fs.readFileString(
      yield* Effect.promise(() =>
        harness.session.context.exports.exportToHtml(joinPath(dir, "export.html")),
      ),
    );
    return (
      /<div class="tool-header ansi-rendered">(.*?)<\/div><\/div>/u.exec(
        html.slice(html.indexOf('id="tool-call-call-1"')),
      )?.[1] ?? ""
    );
  });

const rendersThemInHtmlExportsToo = Effect.gen(function* () {
  initTheme("dark");
  const dir = yield* fs.makeTempDirectory({ prefix: "msa-10285-" });
  const sessionManager = SessionManager.create(dir, joinPath(dir, "sessions"));
  const harness = yield* Effect.promise(() =>
    createHarness({ extensionFactories: [mcpExtension], sessionManager }),
  );
  try {
    appendMcpToolTurn(sessionManager);
    expect(stripAnsi(yield* exportedToolCallHtml(harness, dir))).toContain("my_docs/search");
  } finally {
    yield* awaited(harness.cleanup());
    yield* fs.remove(dir, { force: true, recursive: true });
  }
});

const rendersCallsToMcpToolsThatAre = () => Effect.runPromise(rendersCallsToMcpToolsThat);

const rendersThemInHtmlExportsToo2 = () => Effect.runPromise(rendersThemInHtmlExportsToo);

describe("MCP tool renderers", () => {
  it("renders calls to MCP tools that are not registered", rendersCallsToMcpToolsThatAre);
  it("renders them in HTML exports too", rendersThemInHtmlExportsToo2);
});
