import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getModel } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { EXTERNAL_SERVICES, findExternalService } from "../src/core/external-services.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { webFetchRenderers, webSearchRenderers } from "../src/core/tools/renderers/web.ts";
import { createWebFetchToolDefinition } from "../src/core/tools/web-fetch.ts";
import { createWebSearchToolDefinition } from "../src/core/tools/web-search.ts";
import { findTreg, loginTreg, logoutTreg, type TregRunner } from "../src/core/treg.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const searchResult = {
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

const fetchResult = {
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
  _treg: { served_by: "crawl4ai.web.scrape", tried: [] },
};

function fakeTreg(bin: string, loggedIn: boolean): string {
  const path = join(bin, "treg");
  writeFileSync(
    path,
    `#!/bin/sh\necho '{"base_url": "https://treg.to", "logged_in": ${loggedIn}}'\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function cli(result: unknown, status = 200, chargedMicro?: number) {
  return vi.fn<TregRunner>(async () => ({
    stdout: `${JSON.stringify({
      result,
      _treg: {
        http_status: status,
        call_id: "call-1",
        ...(chargedMicro === undefined ? {} : { charged_micro: chargedMicro }),
      },
    })}\n`,
    stderr: "",
    exitCode: status >= 400 ? 1 : 0,
  }));
}

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
  it("runs treg.web.search through the CLI, free vendor first, with a cost cap", async () => {
    const runner = cli(searchResult, 200, 0);
    const tool = createWebSearchToolDefinition({ run: runner });

    const result = await run(tool, { query: "effect 4 release", limit: 3 });

    expect(runner).toHaveBeenCalledWith(
      [
        "--json",
        "call",
        "treg.web.search",
        "--method",
        "POST",
        "--data",
        '{"q":"effect 4 release","limit":3}',
        "--header",
        "X-Treg-Route-Prefer: tinyfish",
        "--header",
        "X-Treg-Route-Max-Cost: 0.05",
      ],
      undefined,
    );
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
      run: cli({ output: { results: null }, raw: null, _treg: { served_by: null } }),
    });

    const result = await run(tool, { query: "nothing" });

    expect(text(result)).toBe("No results found.");
    expect(result.details).toEqual({ results: [] });
  });

  it("tells the model how to sign in when treg refuses the call", async () => {
    const tool = createWebSearchToolDefinition({ run: cli({ detail: "not authenticated" }, 401) });

    await expect(run(tool, { query: "anything" })).rejects.toThrow(
      "treg returned 401: not authenticated. Sign in with `treg login` or set TREG_TOKEN.",
    );
  });

  it("reports what the CLI said when it printed no result", async () => {
    const tool = createWebSearchToolDefinition({
      run: async () => ({ stdout: "", stderr: "treg: unknown command", exitCode: 2 }),
    });

    await expect(run(tool, { query: "anything" })).rejects.toThrow(
      "treg exited 2 without a result: treg: unknown command",
    );
  });

  it("passes the abort signal to the CLI", async () => {
    const runner = cli(searchResult);
    const controller = new AbortController();

    await run(createWebSearchToolDefinition({ run: runner }), { query: "q" }, controller.signal);

    expect(runner.mock.calls[0]![1]).toBe(controller.signal);
  });
});

describe("web_fetch tool", () => {
  it("runs treg.web.extract and returns the page as Markdown", async () => {
    const runner = cli(fetchResult, 200, 150);
    const tool = createWebFetchToolDefinition({ run: runner });

    const result = await run(tool, { url: "https://example.com" });

    expect(runner.mock.calls[0]![0].slice(0, 7)).toEqual([
      "--json",
      "call",
      "treg.web.extract",
      "--method",
      "POST",
      "--data",
      '{"url":"https://example.com"}',
    ]);
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
      run: cli({
        output: { pages: [{ url: "https://docs.keenable.ai/", content: "Quickstart" }] },
      }),
    });

    const result = await run(tool, { url: "https://docs.keenable.ai/" });

    expect(text(result)).toBe("https://docs.keenable.ai/\n\nQuickstart");
  });

  it("fails when no vendor could read the page", async () => {
    const tool = createWebFetchToolDefinition({
      run: cli({ output: { pages: null }, _treg: { served_by: null } }),
    });

    await expect(run(tool, { url: "https://blocked.example" })).rejects.toThrow(
      "Could not read https://blocked.example: no vendor returned its content.",
    );
  });
});

describe("findTreg", () => {
  let bin: string;

  beforeEach(() => {
    bin = join(tmpdir(), `msa-treg-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(bin);
  });

  afterEach(() => {
    rmSync(bin, { recursive: true, force: true });
  });

  it("needs the CLI on PATH", () => {
    expect(findTreg(() => null, { TREG_TOKEN: "token" })).toBeUndefined();
    expect(findTreg(() => "/usr/local/bin/treg", { TREG_TOKEN: "token" })).toBeDefined();
  });

  it("asks treg config whether the CLI is signed in", () => {
    expect(findTreg(() => fakeTreg(bin, true), {})).toBeDefined();
    expect(findTreg(() => fakeTreg(bin, false), {})).toBeUndefined();
    expect(findTreg(() => fakeTreg(bin, false), { TREG_TOKEN: " " })).toBeUndefined();
  });

  it("runs the CLI and returns its output", async () => {
    const options = findTreg(() => process.execPath, { TREG_TOKEN: "token" })!;
    const output = await options.run(["-e", "console.log('ok'); console.error('note')"]);
    expect(output).toEqual({ stdout: "ok\n", stderr: "note\n", exitCode: 0 });
  });

  it("stops the CLI when the call is aborted", async () => {
    const options = findTreg(() => process.execPath, { TREG_TOKEN: "token" })!;
    const controller = new AbortController();
    const pending = options.run(["-e", "setTimeout(() => {}, 60_000)"], controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe("treg sign-in", () => {
  let bin: string;

  beforeEach(() => {
    bin = join(tmpdir(), `msa-treg-login-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(bin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(bin, { recursive: true, force: true });
  });

  function script(name: string, body: string): string {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  it("shows the page and code treg login prints, and finishes when it does", async () => {
    const command = script(
      "treg",
      [
        `echo "Opening your browser to sign in…"`,
        `echo "If it doesn't open, visit:"`,
        `echo "  https://treg.to/login?cli=abc#code=8HPQ"`,
        `echo "  The sign-in page shows this code — check it matches:  8HPQ"`,
        `echo "Waiting for authorization…"`,
        `echo "Signed in as you@example.com"`,
      ].join("\n"),
    );
    const onPage = vi.fn();
    await loginTreg(command, onPage);
    expect(onPage).toHaveBeenCalledExactlyOnceWith({
      url: "https://treg.to/login?cli=abc#code=8HPQ",
      code: "8HPQ",
    });
  });

  it("reports why treg login failed", async () => {
    const command = script(
      "treg",
      `echo "Waiting for authorization…"\necho "Sign-in expired" >&2\nexit 1`,
    );
    await expect(loginTreg(command, () => {})).rejects.toThrow(
      "treg login failed: Sign-in expired",
    );
  });

  it("stops treg login when the dialog is cancelled", async () => {
    const command = script("treg", "sleep 60");
    const controller = new AbortController();
    const pending = loginTreg(command, () => {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("reports why treg logout failed", async () => {
    await expect(logoutTreg(script("treg", `echo "no login" >&2\nexit 2`))).rejects.toThrow(
      "treg logout failed: no login",
    );
  });

  const treg = () => findExternalService(EXTERNAL_SERVICES, "TREG")!;

  it("tells /login how to install treg when it is missing", async () => {
    vi.stubEnv("PATH", bin);
    expect(await treg().status()).toEqual({
      installed: false,
      install: "curl -fsSL https://treg.to/install.sh | sh",
    });
    expect(treg().tools?.()).toEqual([]);
  });

  it("reports whether treg is signed in and brings the web tools once it is", async () => {
    fakeTreg(bin, true);
    vi.stubEnv("PATH", `${bin}:${process.env["PATH"]}`);
    expect(await treg().status()).toEqual({ installed: true, signedIn: true });
    expect(
      treg()
        .tools?.()
        .map((tool) => tool.name),
    ).toEqual(["web_search", "web_fetch"]);
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
    mkdirSync(join(tempDir, "bin"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  async function createSession() {
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
    return session;
  }

  async function activeTools() {
    return (await createSession()).getActiveToolNames();
  }

  it("activates web_search and web_fetch by default when treg is signed in", async () => {
    fakeTreg(join(tempDir, "bin"), true);
    vi.stubEnv("PATH", `${join(tempDir, "bin")}:${process.env["PATH"]}`);
    expect(await activeTools()).toEqual(
      expect.arrayContaining(["read", "bash", "edit", "write", "web_search", "web_fetch"]),
    );
  });

  it("leaves them out when treg is not signed in", async () => {
    fakeTreg(join(tempDir, "bin"), false);
    vi.stubEnv("PATH", `${join(tempDir, "bin")}:${process.env["PATH"]}`);
    vi.stubEnv("TREG_TOKEN", "");
    const tools = await activeTools();
    expect(tools).not.toContain("web_search");
    expect(tools).not.toContain("web_fetch");
  });

  it("adds them to a running session once treg is signed in", async () => {
    fakeTreg(join(tempDir, "bin"), false);
    vi.stubEnv("PATH", `${join(tempDir, "bin")}:${process.env["PATH"]}`);
    vi.stubEnv("TREG_TOKEN", "");
    const session = await createSession();
    expect(session.getActiveToolNames()).not.toContain("web_search");
    fakeTreg(join(tempDir, "bin"), true);
    session.refreshExternalServiceTools();
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(["read", "web_search", "web_fetch"]),
    );
  });
});
