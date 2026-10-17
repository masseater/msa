import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getModel } from "@msa/ai/compat";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { webFetchRenderers, webSearchRenderers } from "../src/core/tools/renderers/web.ts";
import { createWebFetchToolDefinition } from "../src/core/tools/web-fetch.ts";
import { createWebSearchToolDefinition } from "../src/core/tools/web-search.ts";
import { getTregToken } from "../src/core/treg.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const searchResponse = {
  output: {
    results: [
      {
        position: 1,
        title: "Effect 4.0 released",
        url: "https://effect.website/blog/effect-4",
        snippet: "Effect 4.0 ships a smaller core.",
      },
      { link: "https://example.com/untitled" },
      { answer: 42 },
    ],
    count: 3,
  },
  raw: {},
  _treg: { served_by: "tinyfish.web.search", tried: [], charged_micro: 0 },
};

const fetchResponse = {
  output: {
    pages: [
      {
        url: "https://example.com",
        final_url: "https://example.com/",
        title: "Example Domain",
        text: "This domain is for use in documentation examples.",
      },
    ],
    count: 1,
  },
  raw: {},
  _treg: { served_by: "crawl4ai.web.scrape", tried: [], charged_micro: 150 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const token = Redacted.make("treg-test-token");

async function run(
  tool: { execute: (...args: any[]) => Promise<any> },
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return tool.execute("call-1", params, signal, undefined, undefined);
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => block.text ?? "").join("");
}

describe("web_search tool", () => {
  it("runs treg.web.search, free vendor first, with a cost cap", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(searchResponse));
    const tool = createWebSearchToolDefinition({ token, fetch });

    const result = await run(tool, { query: "effect 4 release", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://treg.to/call/treg.web.search");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-treg-token")).toBe("treg-test-token");
    expect(headers.get("x-treg-route-prefer")).toBe("tinyfish");
    expect(headers.get("x-treg-route-max-cost")).toBe("0.05");
    expect(JSON.parse(new TextDecoder().decode(init?.body as Uint8Array))).toEqual({
      q: "effect 4 release",
      limit: 3,
    });

    expect(text(result)).toBe(
      [
        "1. Effect 4.0 released\n   https://effect.website/blog/effect-4\n   Effect 4.0 ships a smaller core.",
        "2. https://example.com/untitled\n   https://example.com/untitled",
        '3. {"answer":42}',
      ].join("\n\n"),
    );
    expect(result.details).toEqual({
      results: [
        { title: "Effect 4.0 released", url: "https://effect.website/blog/effect-4" },
        { title: "https://example.com/untitled", url: "https://example.com/untitled" },
        { title: "(untitled)" },
      ],
      servedBy: "tinyfish.web.search",
      costMicro: 0,
    });
  });

  it("reports a miss, where treg leaves the results null", async () => {
    const tool = createWebSearchToolDefinition({
      token,
      fetch: async () =>
        jsonResponse({ output: { results: null }, raw: null, _treg: { served_by: null } }),
    });

    const result = await run(tool, { query: "nothing" });

    expect(text(result)).toBe("No results found.");
    expect(result.details).toEqual({ results: [] });
  });

  it("fails with treg's detail when the call is refused", async () => {
    const tool = createWebSearchToolDefinition({
      token,
      fetch: async () => jsonResponse({ detail: "not authenticated" }, 401),
    });

    await expect(run(tool, { query: "anything" })).rejects.toThrow(
      "treg returned 401: not authenticated",
    );
  });

  it("stops the request when the call is aborted", async () => {
    const tool = createWebSearchToolDefinition({
      token,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const controller = new AbortController();

    const pending = run(tool, { query: "slow" }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});

describe("web_fetch tool", () => {
  it("runs treg.web.extract and returns the page as Markdown", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(fetchResponse));
    const tool = createWebFetchToolDefinition({ token, fetch });

    const result = await run(tool, { url: "https://example.com" });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://treg.to/call/treg.web.extract");
    expect(JSON.parse(new TextDecoder().decode(init?.body as Uint8Array))).toEqual({
      url: "https://example.com",
    });
    expect(text(result)).toBe(
      "# Example Domain\nhttps://example.com/\n\nThis domain is for use in documentation examples.",
    );
    expect(result.details).toEqual({
      title: "Example Domain",
      url: "https://example.com/",
      servedBy: "crawl4ai.web.scrape",
      costMicro: 150,
    });
  });

  it("reads the content field other vendors use", async () => {
    const tool = createWebFetchToolDefinition({
      token,
      fetch: async () =>
        jsonResponse({
          output: { pages: [{ url: "https://docs.keenable.ai/", content: "Quickstart" }] },
        }),
    });

    const result = await run(tool, { url: "https://docs.keenable.ai/" });

    expect(text(result)).toBe("https://docs.keenable.ai/\n\nQuickstart");
  });

  it("fails when no vendor could read the page", async () => {
    const tool = createWebFetchToolDefinition({
      token,
      fetch: async () => jsonResponse({ output: { pages: null }, _treg: { served_by: null } }),
    });

    await expect(run(tool, { url: "https://blocked.example" })).rejects.toThrow(
      "Could not read https://blocked.example: no vendor returned its content.",
    );
  });
});

describe("getTregToken", () => {
  it("reads TREG_TOKEN and ignores a blank value", () => {
    expect(Redacted.value(getTregToken({ TREG_TOKEN: " token " })!)).toBe("token");
    expect(getTregToken({ TREG_TOKEN: " " })).toBeUndefined();
    expect(getTregToken({})).toBeUndefined();
  });
});

describe("web tool renderers", () => {
  function renderResult(
    renderers: typeof webSearchRenderers,
    result: { content: { type: "text"; text: string }[]; details: unknown },
    expanded: boolean,
    isError = false,
  ) {
    initTheme("dark");
    const component = renderers.renderResult!(result, { expanded, isPartial: false }, theme, {
      lastComponent: undefined,
      isPartial: false,
      isError,
      showImages: false,
    } as never);
    return stripAnsi(component.render(200).join("\n"));
  }

  it("shows the query and the URL on the call line", () => {
    initTheme("dark");
    const search = webSearchRenderers.renderCall!({ query: "effect 4" }, theme, {
      lastComponent: undefined,
    } as never);
    const fetch = webFetchRenderers.renderCall!({ url: "https://example.com" }, theme, {
      lastComponent: undefined,
    } as never);
    expect(stripAnsi(search.render(200).join("\n"))).toContain("web search effect 4");
    expect(stripAnsi(fetch.render(200).join("\n"))).toContain("web fetch https://example.com");
  });

  it("collapses search results to a count and expands them to titles and URLs", () => {
    const result = {
      content: [{ type: "text" as const, text: "" }],
      details: {
        results: [{ title: "Effect 4.0 released", url: "https://effect.website/blog/effect-4" }],
        servedBy: "tinyfish.web.search",
        costMicro: 0,
      },
    };
    expect(renderResult(webSearchRenderers, result, false)).toContain(
      "1 results, via tinyfish.web.search, $0",
    );
    const expanded = renderResult(webSearchRenderers, result, true);
    expect(expanded).toContain("Effect 4.0 released");
    expect(expanded).toContain("https://effect.website/blog/effect-4");
  });

  it("collapses a page to its title and expands it to the text", () => {
    const result = {
      content: [{ type: "text" as const, text: "# Example Domain\nhttps://example.com/\n\nBody" }],
      details: { title: "Example Domain", url: "https://example.com/", costMicro: 150 },
    };
    const collapsed = renderResult(webFetchRenderers, result, false);
    expect(collapsed).toContain("Example Domain");
    expect(collapsed).toContain("4 lines, $0.00015");
    expect(collapsed).not.toContain("Body");
    expect(renderResult(webFetchRenderers, result, true)).toContain("Body");
  });

  it("shows the error message", () => {
    const result = { content: [{ type: "text" as const, text: "treg returned 401" }], details: {} };
    expect(renderResult(webSearchRenderers, result, false, true)).toContain("treg returned 401");
  });
});

describe("web tool registration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `msa-web-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempDir, "agent"), { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  async function activeTools() {
    const agentDir = join(tempDir, "agent");
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: tempDir,
      agentDir,
      model: getModel("anthropic", "claude-sonnet-4-5")!,
      settingsManager,
      sessionManager: SessionManager.inMemory(tempDir),
      resourceLoader,
    });
    return session.getActiveToolNames();
  }

  it("activates web_search and web_fetch by default when TREG_TOKEN is set", async () => {
    vi.stubEnv("TREG_TOKEN", "treg-test-token");
    expect(await activeTools()).toEqual(
      expect.arrayContaining(["read", "bash", "edit", "write", "web_search", "web_fetch"]),
    );
  });

  it("leaves them out without TREG_TOKEN", async () => {
    vi.stubEnv("TREG_TOKEN", "");
    const tools = await activeTools();
    expect(tools).not.toContain("web_search");
    expect(tools).not.toContain("web_fetch");
  });
});
