import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";

import { renderToolOutputType } from "@msa/codemode/declarations";
import {
  type JsonRpcMessage,
  LATEST_PROTOCOL_VERSION,
  McpAuthRequiredError,
  McpHttpError,
  McpSessionExpiredError,
} from "@msa/mcp";
import { createInMemoryTransportPair, type InMemoryTransport } from "@msa/mcp/testing";
import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  makeDirectory,
  removePath,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { truncateMiddle } from "../src/core/tools/truncate.ts";
import {
  getMcpToolExposure,
  loadMcpConfig,
  type McpServerEntry,
  updateMcpServerConfig,
} from "../src/extensions/mcp/config.ts";
import { MAX_SERVERS_SECTION_CHARS, renderServersSection } from "../src/extensions/mcp/index.ts";
import {
  createDefaultTransport,
  McpOAuthCredentialStore,
  McpServerConnection,
  McpServerLog,
} from "../src/extensions/mcp/runtime.ts";
import {
  convertMcpResult,
  createMcpResultSchema,
  createMcpToolName,
} from "../src/extensions/mcp/tools.ts";

const TOKEN_HEADER = "Bearer ${TOKEN}";

describe("MCP config", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function setup(global: unknown, project: unknown) {
    const root = mkdtempSync(joinPath(tmpdir(), "msa-mcp-config-"));
    dirs.push(root);
    const agentDir = joinPath(root, "agent");
    const cwd = joinPath(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(joinPath(cwd, ".msa"), { recursive: true });
    writeFileSync(joinPath(agentDir, "mcp.json"), JSON.stringify(global));
    writeFileSync(joinPath(cwd, ".msa", "mcp.json"), JSON.stringify(project));
    return { agentDir, cwd };
  }

  it("merges global and trusted project servers and validates entries", () => {
    const paths = setup(
      {
        mcpServers: {
          shared: { command: "global-cmd" },
          remote: { url: "https://example.com/mcp", headers: { Authorization: TOKEN_HEADER } },
          off: { command: "x", enabled: false },
          bad: { args: ["no command"] },
          legacy: { type: "sse" as const, url: "https://example.com/sse" },
          badUrl: { url: "example.com/mcp" },
          "bad name": { command: "x" },
        },
      },
      { mcpServers: { shared: { command: "project-cmd", exposure: "direct" } } },
    );

    const trusted = loadMcpConfig({ ...paths, projectTrusted: true });

    expect(trusted.servers.map((server) => [server.name, server.scope, server.config])).toEqual([
      ["shared", "project", { command: "project-cmd", exposure: "direct" }],
      [
        "remote",
        "global",
        { url: "https://example.com/mcp", headers: { Authorization: TOKEN_HEADER } },
      ],
      ["off", "global", { command: "x", enabled: false }],
    ]);
    expect(trusted.errors).toHaveLength(4);
    expect(trusted.errors[0]).toContain('server "bad" needs either "command"');
    expect(trusted.errors[1]).toContain("legacy SSE transport is not supported");
    expect(trusted.errors[2]).toContain('server "badUrl": url must be an http or https URL');
    expect(trusted.errors[3]).toContain('invalid server name "bad name"');

    const untrusted = loadMcpConfig({ ...paths, projectTrusted: false });
    expect(untrusted.servers.find((server) => server.name === "shared")?.config).toEqual({
      command: "global-cmd",
    });
  });

  it("lets project entries override enabled and exposure of global servers", () => {
    const paths = setup(
      { mcpServers: { tools: { command: "x", env: { TOKEN: "secret" } } } },

      { mcpServers: { tools: { enabled: false, args: ["y"] }, missing: { enabled: false } } },
    );
    const project = joinPath(paths.cwd, ".msa", "mcp.json");
    const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: true });
    expect(servers.map((server) => [server.name, server.override, server.config])).toEqual([
      ["tools", undefined, { command: "x", env: { TOKEN: "secret" } }],
    ]);
    expect(errors).toEqual([
      expect.stringContaining(
        'server "tools": an override can only set enabled, exposure, toolExposure',
      ),
      expect.stringContaining(
        'server "missing" needs "command" or "url", or a global server to override',
      ),
    ]);

    writeFileSync(project, JSON.stringify({ mcpServers: { tools: { enabled: false } } }));
    const [tools] = loadMcpConfig({ ...paths, projectTrusted: true }).servers;
    expect([tools?.override, tools?.config]).toEqual([
      project,
      { command: "x", env: { TOKEN: "secret" }, enabled: false },
    ]);

    updateMcpServerConfig(project, "tools", { enabled: true });
    expect(JSON.parse(readFileSync(project, "utf8")).mcpServers.tools).toEqual({ enabled: true });
  });

  it("rejects server names that differ only in - and _", () => {
    const paths = setup(
      { mcpServers: { "work-files": { command: "a" }, work_files: { command: "b" } } },
      {},
    );
    const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
    expect(servers.map((server) => server.name)).toEqual(["work-files"]);
    expect(errors).toEqual([
      expect.stringContaining('server "work_files" conflicts with "work-files"'),
    ]);
  });

  it("validates exposure and reads autoEnableCodemode with project precedence", () => {
    const paths = setup(
      {
        autoEnableCodemode: false,
        mcpServers: {
          later: { command: "x", exposure: "deferred" },

          scripts: {
            command: "x",
            exposure: "codemode-deferred",
            toolExposure: { a: "codemode-deferred" },
          },
          off: { command: "x", exposure: "hidden" },
          wrong: { command: "x", exposure: "model-only" },
          described: { command: "x", description: "Docs search" },
          badDescription: { command: "x", description: 1 },
        },
      },
      { autoEnableCodemode: "yes", mcpServers: {} },
    );

    const untrusted = loadMcpConfig({ ...paths, projectTrusted: false });
    expect(untrusted.autoEnableCodemode).toBe(false);
    expect(untrusted.servers.map((server) => [server.name, server.config.exposure])).toEqual([
      ["later", "deferred"],
      ["scripts", "codemode"],
      ["off", "hidden"],
      ["described", undefined],
    ]);
    expect(untrusted.servers[1]?.config.toolExposure).toEqual({ a: "codemode" });
    expect(untrusted.servers[3]?.config.description).toBe("Docs search");
    expect(untrusted.errors).toEqual([
      expect.stringContaining('server "wrong": exposure must be one of'),
      expect.stringContaining('server "badDescription": description must be a string'),
    ]);

    const trusted = loadMcpConfig({ ...paths, projectTrusted: true });
    expect(trusted.autoEnableCodemode).toBe(false);
    expect(trusted.errors).toContainEqual(
      expect.stringContaining("autoEnableCodemode must be a boolean"),
    );
  });

  it("validates the OAuth callback URL, scope, and client name", () => {
    const paths = setup(
      {
        mcpServers: {
          ok: {
            url: "https://a.example/mcp",
            oauth: { callbackUrl: "http://localhost:8080/callback", scope: "a b" },
          },
          ipv6: {
            url: "https://a.example/mcp",
            oauth: { callbackUrl: "http://[::1]/cb", callbackPort: 9000 },
          },
          same: {
            url: "https://a.example/mcp",
            oauth: { callbackUrl: "http://127.0.0.1:2/cb", callbackPort: 2 },
          },
          remote: {
            url: "https://a.example/mcp",
            oauth: { callbackUrl: "https://example.com/callback" },
          },
          both: {
            url: "https://a.example/mcp",
            oauth: { callbackUrl: "http://127.0.0.1:1/cb", callbackPort: 2 },
          },
          scope: { url: "https://a.example/mcp", oauth: { scope: ["a"] } },
          named: { url: "https://a.example/mcp", oauth: { clientName: "Claude Code" } },
          unnamed: { url: "https://a.example/mcp", oauth: { clientName: " " } },
          metadata: {
            url: "https://a.example/mcp",
            oauth: { authServerMetadataUrl: "https://idp.example/m" },
          },
          plainMetadata: {
            url: "https://a.example/mcp",
            oauth: { authServerMetadataUrl: "http://idp.example/m" },
          },

          cimd: {
            url: "https://a.example/mcp",
            oauth: { clientRegistration: "cimd", callbackUrl: "http://localhost/callback" },
          },
          badRegistration: { url: "https://a.example/mcp", oauth: { clientRegistration: "auto" } },
          cimdClient: {
            url: "https://a.example/mcp",
            oauth: { clientRegistration: "cimd", clientId: "x" },
          },
          cimdPath: {
            url: "https://a.example/mcp",
            oauth: { clientRegistration: "cimd", callbackUrl: "http://127.0.0.1/cb" },
          },
        },
      },
      {},
    );
    const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
    expect(servers.map((server) => server.name)).toEqual([
      "ok",
      "ipv6",
      "same",
      "named",
      "metadata",
      "cimd",
    ]);
    expect(errors).toEqual([
      expect.stringContaining(
        'server "remote": oauth.callbackUrl must be an http URI on localhost',
      ),
      expect.stringContaining(
        'server "both": oauth.callbackUrl and oauth.callbackPort name different ports',
      ),
      expect.stringContaining('server "scope": oauth.scope must be a string'),
      expect.stringContaining('server "unnamed": oauth.clientName must be a non-empty string'),
      expect.stringContaining(
        'server "plainMetadata": oauth.authServerMetadataUrl must be an https URL',
      ),
      expect.stringContaining(
        'server "badRegistration": oauth.clientRegistration must be "dcr" or "cimd"',
      ),
      expect.stringContaining(
        'server "cimdClient": oauth.clientRegistration "cimd" cannot be combined',
      ),
      expect.stringContaining(
        'server "cimdPath": oauth.clientRegistration "cimd" requires oauth.callbackUrl',
      ),
    ]);
  });

  it("resolves per-tool exposure from exact names, then patterns in order", () => {
    const paths = setup(
      {
        mcpServers: {
          gh: {
            command: "x",
            exposure: "deferred",
            toolExposure: {
              "get_*": "codemode",
              get_me: "direct",
              "*delete*": "hidden",
              "get_file.*": "direct",
            },
          },
          bad: { command: "x", toolExposure: { a: "visible" } },
        },
      },
      {},
    );
    const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
    expect(errors).toEqual([
      expect.stringContaining('server "bad": toolExposure "a" must be one of'),
    ]);
    const [server] = servers;
    if (server === undefined) throw new Error("expected a loaded server");
    const config = server.config;
    expect(getMcpToolExposure(config, "get_me")).toBe("direct");
    expect(getMcpToolExposure(config, "get_issue")).toBe("codemode");
    expect(getMcpToolExposure(config, "get_delete_hint")).toBe("codemode");
    expect(getMcpToolExposure(config, "delete_repo")).toBe("hidden");
    expect(getMcpToolExposure(config, "list_issues")).toBe("deferred");

    expect(
      getMcpToolExposure({ command: "x", toolExposure: { "get_file.*": "direct" } }, "get_file_x"),
    ).toBe("codemode");
  });

  it("validates provider auth and accepts it only in the global mcp.json", () => {
    const paths = setup(
      {
        mcpServers: {
          openrouter: { url: "https://mcp.example/mcp", auth: { provider: "openrouter" } },
          local: { url: "http://localhost:8788/mcp", auth: { provider: "openrouter-dev" } },
          plain: { url: "http://mcp.example/mcp", auth: { provider: "openrouter" } },
          empty: { url: "https://mcp.example/mcp", auth: { provider: "" } },
        },
      },
      {
        mcpServers: {
          openrouter: { url: "https://evil.example/mcp", auth: { provider: "openrouter" } },
        },
      },
    );
    const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: true });

    expect(
      servers.map((server) => [
        server.name,
        server.scope,
        "url" in server.config && server.config.url,
      ]),
    ).toEqual([
      ["openrouter", "global", "https://mcp.example/mcp"],
      ["local", "global", "http://localhost:8788/mcp"],
    ]);
    expect(errors).toEqual([
      expect.stringContaining('server "plain": auth requires an https URL'),
      expect.stringContaining('server "empty": auth.provider must be a provider name'),
      expect.stringContaining('server "openrouter": auth is only allowed in the global mcp.json'),
    ]);
  });
});

describe("MCP tools", () => {
  it("creates provider-safe tool names", () => {
    expect(createMcpToolName("docs", "search")).toBe("mcp__docs__search");
    expect(createMcpToolName("my-server", "get.item/v2")).toBe("mcp__my_server__get_item_v2");
    const long = createMcpToolName("server", "x".repeat(100));
    expect(long).toHaveLength(64);
    expect(long).toMatch(/^mcp__server__x+_[0-9a-f]{8}$/u);
    expect(createMcpToolName("server", `${"x".repeat(100)}y`)).not.toBe(long);

    const taken = createMcpToolName("s", "a_b");
    const second = createMcpToolName("s", "a-b", (name) => name === taken);
    expect(second).toMatch(/^mcp__s__a_b_[0-9a-f]{8}$/u);
  });

  it("declares the CallToolResult scripts receive, keeping references in the server's output schema", () => {
    const content =
      'content: Array<{ data?: string; mimeType?: string; text?: string; type: "text" | "image" | "audio" | "resource_link" | "resource"; [key: string]: unknown; }>; isError?: boolean;';

    expect(renderToolOutputType(createMcpResultSchema(undefined) as never)).toBe(
      `{ ${content} structuredContent?: unknown; [key: string]: unknown; }`,
    );

    const hit = {
      type: "object" as const,
      properties: { id: { type: "string" as const } },
      required: ["id"],
    };
    const schema = createMcpResultSchema({
      type: "object" as const,
      properties: {
        hits: { type: "array" as const, items: { $ref: "#/$defs/Hit~1v1" } },
        again: { $ref: "#/properties/hits" },
        children: { type: "array" as const, items: { $ref: "#" } },

        default: { $ref: "#/definitions/Hit" },
        remote: { $ref: "https://example.com/schema.json" },
      },
      required: ["hits"],
      $defs: { "Hit/v1": { ...hit, default: { $ref: "#/stays" } } },
      definitions: { Hit: hit },
    }) as unknown as {
      properties: { structuredContent: { $defs: Record<string, { default: unknown }> } };
    };

    expect(schema.properties.structuredContent.$defs["Hit/v1"]?.default).toEqual({
      $ref: "#/stays",
    });
    expect(renderToolOutputType(schema as never)).toBe(
      `{ ${content} structuredContent?: { again?: Array<{ id: string; }>; children?: Array<{ again?: Array<{ id: string; }>; children?: Array<unknown>; default?: { id: string; }; hits: Array<{ id: string; }>; remote?: unknown; }>; default?: { id: string; }; hits: Array<{ id: string; }>; remote?: unknown; }; [key: string]: unknown; }`,
    );
  });

  it("converts results, passing the CallToolResult to scripts and flagging errors", () =>
    runTest(
      Effect.gen(function* () {
        const blocks = [
          { type: "resource_link" as const, uri: "file:///a", name: "a" },
          { type: "resource" as const, resource: { uri: "file:///b", text: "b text" } },
          { type: "audio" as const, data: "", mimeType: "audio/wav" },
        ];
        expect(
          yield* awaited(
            convertMcpResult("docs", "t", {
              content: blocks,
              structuredContent: { ok: true },
              _meta: { trace: "x" },
            }),
          ),
        ).toEqual({
          content: [
            { type: "text" as const, text: '[Resource file:///a "a"]' },
            { type: "text" as const, text: "b text" },
            { type: "text" as const, text: "[audio audio/wav omitted]" },
          ],
          details: { server: "docs", tool: "t" },

          structuredContent: { content: blocks, structuredContent: { ok: true } },
        });
        expect(
          (yield* awaited(
            convertMcpResult("docs", "t", { content: [], structuredContent: { n: 1 } }),
          )).content,
        ).toEqual([{ type: "text" as const, text: '{\n  "n": 1\n}' }]);

        expect(
          yield* awaited(
            convertMcpResult("docs", "t", { content: [], structuredContent: [{ id: 1 }] }),
          ),
        ).toEqual({
          content: [{ type: "text" as const, text: '[\n  {\n    "id": 1\n  }\n]' }],
          details: { server: "docs", tool: "t" },
          structuredContent: { content: [], structuredContent: [{ id: 1 }] },
        });
        expect(
          yield* awaited(
            convertMcpResult("docs", "t", {
              content: [{ type: "text" as const, text: "nope" }],
              isError: true,
            }),
          ),
        ).toEqual({
          content: [{ type: "text" as const, text: "nope" }],
          details: { server: "docs", tool: "t" },
          structuredContent: { content: [{ type: "text" as const, text: "nope" }], isError: true },
          isError: true,
        });
        expect(
          (yield* awaited(convertMcpResult("docs", "t", { content: [], isError: true }))).content,
        ).toEqual([{ type: "text" as const, text: "MCP tool docs/t returned an error" }]);
      }),
    ));

  it("points resource links to read_mcp_resource and saves binary resources", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const saved: [string | Uint8Array, string][] = [];
        const saveOutput = (data: string | Uint8Array, extension: string) =>
          effectRunPromise(
            Effect.gen(function* () {
              saved.push([data, extension]);
              return yield* awaited(`/tmp/saved${extension}`);
            }),
          );
        const converted = yield* awaited(
          convertMcpResult(
            "docs",
            "t",
            {
              content: [
                {
                  type: "resource_link" as const,
                  uri: "docs://guide",
                  name: "guide",
                  title: "The Guide",
                  mimeType: "text/markdown",
                  size: 2048,
                  description: "How to use it",
                },
                {
                  type: "resource" as const,
                  resource: {
                    uri: "file:///r/report.pdf",
                    mimeType: "application/pdf",
                    blob: "JVBERg==",
                  },
                },
                {
                  type: "resource" as const,
                  resource: { uri: "docs://logo", mimeType: "image/png", blob: "AAAA" },
                },
              ],
            },
            { saveOutput, readableResources: true },
          ),
        );
        expect(converted.content).toEqual([
          {
            type: "text" as const,
            text: '[Resource docs://guide "The Guide" (text/markdown, 2.0KB): How to use it. Read it with read_mcp_resource (server "docs")]',
          },
          {
            type: "text" as const,
            text: "[Binary resource file:///r/report.pdf (application/pdf, 4B) saved to /tmp/saved.pdf]",
          },
          { type: "image" as const, data: "AAAA", mimeType: "image/png" },
        ]);
        expect(saved).toEqual([[Buffer.from("%PDF"), ".pdf"]]);
      }),
    ));

  it("cuts the middle of model-facing text over 20KB and keeps the full result for scripts", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const saved: (string | Uint8Array)[] = [];
        const saveOutput = (data: string | Uint8Array) =>
          effectRunPromise(
            Effect.gen(function* () {
              saved.push(data);
              return yield* awaited("/tmp/full.txt");
            }),
          );
        const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`);
        const full = lines.join("\n");
        const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
        const result = { content: [{ type: "text" as const, text: full }, image] };
        const converted = yield* awaited(
          convertMcpResult("docs", "snapshot", result, { saveOutput }),
        );
        expect(converted.content).toHaveLength(2);
        const text = (converted.content[0] as { text: string }).text;

        expect(text).toMatch(
          new RegExp(
            `^Warning: truncated output \\(original token count: ${Math.ceil(full.length / 4)}\\)\nTotal output lines: 3000\n\nline 1\nline 2\n`,
          ),
        );
        expect(text).toMatch(/…\d+ chars truncated…/u);
        expect(
          text.endsWith("line 3000\n\n[Full output: /tmp/full.txt (read it with offset/limit)]"),
        ).toBe(true);
        expect(Buffer.byteLength(text)).toBeLessThan(21 * 1024);
        expect(converted.content[1]).toEqual(image);
        expect(converted.details).toEqual({
          server: "docs",
          tool: "snapshot",
          fullOutputPath: "/tmp/full.txt",
        });
        expect(saved).toEqual([full]);
        expect(converted.structuredContent).toEqual(result);

        yield* awaited(
          convertMcpResult(
            "docs",
            "small",
            { content: [{ type: "text" as const, text: "ok" }] },
            { saveOutput },
          ),
        );
        expect(saved).toHaveLength(1);
      }),
    ));

  it("cuts multi-byte text only at character boundaries", () => {
    const text = `${"é".repeat(20_000)}end`;
    const result = truncateMiddle(text, 1001);
    expect(result.truncated).toBe(true);
    expect(result.content).not.toContain("\uFFFD");
    expect(result.content.endsWith("end")).toBe(true);
    const [head, tail] = result.content.split(/…\d+ chars truncated…/u);
    if (head === undefined || tail === undefined) throw new Error("expected a truncation marker");
    expect(Buffer.byteLength(head)).toBeLessThanOrEqual(500);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(501);
    expect(Array.from(head).length + Array.from(tail).length + result.removedChars).toBe(
      Array.from(text).length,
    );
  });
});

describe("MCP connections", () => {
  const servers: InMemoryTransport[] = [];

  function createTransport(
    options: {
      expireFirstCall?: boolean;
      methods?: string[];
      noTools?: boolean;
      resources?: boolean;
    } = {},
  ) {
    const pair = createInMemoryTransportPair();
    servers.push(pair.server);
    pair.server.onMessage((message) => {
      if (!("id" in message) || !("method" in message)) return;
      options.methods?.push(message.method);
      const response: JsonRpcMessage =
        message.method === "initialize"
          ? {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: LATEST_PROTOCOL_VERSION,
                capabilities: {
                  ...(options.noTools ? { prompts: {} } : { tools: {} }),
                  ...(options.resources ? { resources: {} } : {}),
                },
                serverInfo: { name: "fake", version: "1.0.0" },
              },
            }
          : message.method === "tools/list"
            ? options.noTools
              ? {
                  jsonrpc: "2.0",
                  id: message.id,
                  error: { code: -32601, message: "Method not found" },
                }
              : { jsonrpc: "2.0", id: message.id, result: { tools: [] } }
            : message.method === "resources/read"
              ? {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: { contents: [{ uri: "docs://a", text: "ok" }] },
                }
              : {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: { content: [{ type: "text" as const, text: "ok" }] },
                };
      queueMicrotask(() => void pair.server.send(response));
    });
    void pair.server.start();
    if (options.expireFirstCall) {
      const send = pair.client.send.bind(pair.client);

      pair.client.send = (message: JsonRpcMessage) =>
        runTest(
          Effect.gen(function* () {
            if ("method" in message && message.method === "tools/call")
              throw new McpSessionExpiredError("gone");
            return yield* awaited(send(message));
          }),
        );
    }
    return pair.client;
  }

  function connect(
    entry: McpServerEntry,
    transports: (() => ReturnType<typeof createTransport>)[],
    log?: McpServerLog,
  ) {
    let opened = 0;
    const connection = new McpServerConnection({
      entry,
      cwd: process.cwd(),
      createTransport: () => {
        const transport = transports[opened++];
        if (transport === undefined) throw new Error(`no transport for connection ${opened}`);
        return transport();
      },
      credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
      ...(log === undefined ? {} : { log }),
      onTools: () => {},
    });
    return { connection, opened: () => opened };
  }

  it("starts a new session and retries once when the session expired", () =>
    runTest(
      Effect.gen(function* () {
        const { connection, opened } = connect(
          { name: "fake", config: { command: "unused" }, source: "test" },
          [() => createTransport({ expireFirstCall: true }), () => createTransport()],
        );
        const results = yield* awaited(
          Promise.all([connection.callTool("echo", {}, {}), connection.callTool("echo", {}, {})]),
        );
        expect(results).toEqual([
          { content: [{ type: "text" as const, text: "ok" }] },
          { content: [{ type: "text" as const, text: "ok" }] },
        ]);
        expect(opened()).toBe(2);
        yield* awaited(connection.close());
      }),
    ));

  it.skipIf(process.platform === "win32")(
    "expands ~ in the command, arguments, and cwd of stdio servers",
    () =>
      runTest(
        Effect.gen(function* () {
          const home = mkdtempSync(joinPath(tmpdir(), "msa-mcp-home-"));
          const previousHome = readEnv("HOME");
          writeEnv("HOME", home);
          yield* makeDirectory(joinPath(home, "work"));

          yield* writeTextFile(
            joinPath(home, "server.mjs"),
            `import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
	const message = JSON.parse(line);
	if (!("id" in message)) continue;
	const result = message.method === "initialize"
		? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cwd", version: "1" } }
		: message.method === "tools/list"
			? { tools: [{ name: "cwd", inputSchema: { type: "object" } }] }
			: { content: [{ type: "text", text: process.cwd() }] };
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
}`,
          );
          const connection = new McpServerConnection({
            entry: {
              name: "home",
              config: { command: process.execPath, args: ["~/server.mjs"], cwd: "~/work" },
              source: "test",
            },
            cwd: tmpdir(),
            createTransport: createDefaultTransport,
            credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
            onTools: () => {},
          });
          try {
            const result = yield* awaited(connection.callTool("cwd", {}, {}));
            expect(realpathSync((result.content[0] as { text: string }).text)).toBe(
              realpathSync(joinPath(home, "work")),
            );
          } finally {
            yield* awaited(connection.close());
            if (previousHome === undefined) deleteEnv("HOME");
            else writeEnv("HOME", previousHome);
            yield* removePath(home);
          }
        }),
      ),
  );

  it("connects to servers without the tools capability without listing tools", () =>
    runTest(
      Effect.gen(function* () {
        const methods: string[] = [];
        const { connection } = connect(
          { name: "fake", config: { command: "unused" }, source: "test" },
          [() => createTransport({ noTools: true, methods })],
        );
        yield* awaited(connection.getClient());
        expect(connection.state).toBe("connected");
        expect(connection.tools).toEqual([]);
        expect(methods).toEqual(["initialize"]);
        yield* awaited(connection.close());
      }),
    ));

  it("marks a dropped connection and reconnects on the next call", () =>
    runTest(
      Effect.gen(function* () {
        const { connection, opened } = connect(
          { name: "fake", config: { command: "unused" }, source: "test" },
          [() => createTransport(), () => createTransport()],
        );
        yield* awaited(connection.getClient());
        yield* awaited(servers.at(-1)?.close());
        yield* Effect.sleep(0);
        expect(connection.state).toBe("disconnected");
        expect(connection.error).toBe("Connection closed");
        expect(yield* awaited(connection.callTool("echo", {}, {}))).toEqual({
          content: [{ type: "text" as const, text: "ok" }],
        });
        expect(connection.state).toBe("connected");
        expect(opened()).toBe(2);
        yield* awaited(connection.close());
      }),
    ));

  it("retries HTTP connections that fail with a transient error", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { connection, opened } = connect(
          {
            name: "fake",
            config: { url: "http://unused.invalid", headers: { Authorization: "x" } },
            source: "test",
          },
          [
            () => {
              const transport = createTransport();
              transport.send = () =>
                effectRunPromise(
                  Effect.sync(() => {
                    throw new McpHttpError(503, "MCP HTTP request failed with status 503");
                  }),
                );
              return transport;
            },
            () => createTransport(),
          ],
        );
        yield* awaited(connection.getClient());
        expect(connection.state).toBe("connected");
        expect(opened()).toBe(2);
        yield* awaited(connection.close());

        const failing = connect(
          {
            name: "fake",
            config: { url: "http://unused.invalid", headers: { Authorization: "x" } },
            source: "test",
          },
          [
            () => {
              const transport = createTransport();
              transport.send = () =>
                effectRunPromise(
                  Effect.sync(() => {
                    throw new McpHttpError(400, "MCP HTTP request failed with status 400: bad");
                  }),
                );
              return transport;
            },
          ],
        );
        yield* awaited(expect(failing.connection.getClient()).rejects.toThrow("status 400: bad"));
        expect(failing.connection.state).toBe("failed");
        expect(failing.opened()).toBe(1);
      }),
    ));

  it("closes a connection that is still initializing before close returns", () =>
    runTest(
      Effect.gen(function* () {
        const pair = createInMemoryTransportPair();

        const initializing = new Promise<void>((resolve) => {
          pair.server.onMessage(() => resolve());
        });
        void pair.server.start();
        let transportClosed = false;
        pair.client.onClose(() => {
          transportClosed = true;
        });
        const { connection } = connect(
          { name: "fake", config: { command: "unused" }, source: "test" },
          [() => pair.client],
        );
        let failure: unknown;
        void connection.getClient().catch((error) => {
          failure = error;
        });
        yield* awaited(initializing);
        yield* awaited(connection.close());
        expect(transportClosed).toBe(true);
        expect(String(failure)).toContain("failed to connect");
      }),
    ));

  it("stops waiting to retry a connection when closed", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { connection } = connect(
          {
            name: "fake",
            config: { url: "http://unused.invalid", headers: { Authorization: "x" } },
            source: "test",
          },
          [
            () => {
              const transport = createTransport();
              transport.send = () =>
                effectRunPromise(
                  Effect.sync(() => {
                    throw new McpHttpError(503, "MCP HTTP request failed with status 503");
                  }),
                );
              return transport;
            },
          ],
        );
        let failure: unknown;
        void connection.getClient().catch((error) => {
          failure = error;
        });

        yield* Effect.sleep(10);
        yield* awaited(connection.close());
        expect(String(failure)).toContain("status 503");
      }),
    ));

  it("retries resource reads, but not tool calls, after a transient HTTP error", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const transport = createTransport();
        const send = transport.send.bind(transport);
        const failed = new Set<string>();

        transport.send = (message) =>
          effectRunPromise(
            Effect.gen(function* () {
              const method = "method" in message ? message.method : "";
              if ((method === "resources/read" || method === "tools/call") && !failed.has(method)) {
                failed.add(method);
                throw new McpHttpError(502, "MCP HTTP request failed with status 502");
              }
              return yield* awaited(send(message));
            }),
          );
        const { connection } = connect(
          { name: "fake", config: { command: "unused" }, source: "test" },
          [() => transport],
        );
        expect(yield* awaited(connection.readResource("docs://a", {}))).toEqual({
          contents: [{ uri: "docs://a", text: "ok" }],
        });
        yield* awaited(expect(connection.callTool("echo", {}, {})).rejects.toThrow("status 502"));
        yield* awaited(connection.close());
      }),
    ));

  it("asks OAuth servers that keep rejecting requests for a new sign-in", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { connection } = connect(
          { name: "fake", config: { url: "http://unused.invalid" }, source: "test" },
          [
            () => {
              const transport = createTransport();
              transport.send = () =>
                effectRunPromise(
                  Effect.sync(() => {
                    throw new McpAuthRequiredError(new Response(null, { status: 401 }));
                  }),
                );
              return transport;
            },
          ],
        );
        yield* awaited(
          expect(connection.getClient()).rejects.toThrow(
            'MCP server "fake" requires sign-in. Run /mcp to sign in.',
          ),
        );
        expect(connection.state).toBe("needs-auth");
        yield* awaited(connection.close());
      }),
    ));

  it("sends the provider token and asks for the provider login when the server rejects it", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const authorizations: (string | undefined)[] = [];
        const server = createServer((request, response) => {
          authorizations.push(request.headers.authorization);
          request.resume();
          response.writeHead(401).end();
        });
        yield* awaited(new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)));
        const { port } = server.address() as AddressInfo;
        const connection = new McpServerConnection({
          entry: {
            name: "openrouter",
            config: { url: `http://127.0.0.1:${port}/mcp`, auth: { provider: "openrouter" } },
            source: "test",
          },
          cwd: process.cwd(),
          createTransport: createDefaultTransport,
          credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
          providerToken: (provider) =>
            effectRunPromise(awaited(provider === "openrouter" ? "tok" : undefined)),
          onTools: () => {},
        });
        try {
          expect(connection.oauthUrl).toBeUndefined();
          yield* awaited(
            expect(connection.getClient()).rejects.toThrow(
              'MCP server "openrouter" requires sign-in. Run /login openrouter to sign in.',
            ),
          );
          expect(connection.state).toBe("needs-auth");
          expect(authorizations).toEqual(["Bearer tok"]);
        } finally {
          yield* awaited(connection.close());
          yield* awaited(new Promise((resolve) => server.close(resolve)));
        }
      }),
    ));

  it("appends server log messages to the log file", () =>
    runTest(
      Effect.gen(function* () {
        const dir = mkdtempSync(joinPath(tmpdir(), "msa-mcp-log-"));
        try {
          const path = joinPath(dir, "mcp.log");
          const { connection } = connect(
            { name: "fake", config: { command: "unused" }, source: "test" },
            [() => createTransport()],
            new McpServerLog(path),
          );
          yield* awaited(connection.getClient());
          const server = servers.at(-1);
          yield* awaited(
            server?.send({
              jsonrpc: "2.0",
              method: "notifications/message",
              params: { level: "warning", logger: "db", data: "slow\nquery" },
            }),
          );
          yield* awaited(
            server?.send({
              jsonrpc: "2.0",
              method: "notifications/message",
              params: { level: "error", data: { code: 7 } },
            }),
          );
          yield* Effect.sleep(0);
          const lines = (yield* readTextFile(path)).replace(/^\S+ /gmu, "");
          expect(lines).toBe('[fake] warning db: slow\n    query\n[fake] error {"code":7}\n');
          yield* awaited(connection.close());
        } finally {
          yield* removePath(dir);
        }
      }),
    ));

  it("resolves the OAuth client secret lazily", () =>
    runTest(
      Effect.gen(function* () {
        const { connection } = connect(
          {
            name: "fake",
            config: { url: "http://unused.invalid", oauth: { clientSecret: "!exit 1" } },
            source: "test",
          },
          [() => createTransport()],
        );
        expect(yield* awaited(connection.callTool("echo", {}, {}))).toEqual({
          content: [{ type: "text" as const, text: "ok" }],
        });
        expect(() => connection.oauthSettings()).toThrow("oauth.clientSecret");
        yield* awaited(connection.close());
      }),
    ));

  it("connects to servers with resources without listing them", () =>
    runTest(
      Effect.gen(function* () {
        const methods: string[] = [];
        const { connection } = connect(
          { name: "fake", config: { command: "unused" }, source: "test" },
          [() => createTransport({ resources: true, methods })],
        );
        yield* awaited(connection.getClient());
        expect(connection.state).toBe("connected");
        expect(connection.hasResources).toBe(true);
        expect(methods).toEqual(["initialize", "tools/list"]);
        yield* awaited(connection.close());
      }),
    ));
});

describe("MCP servers section", () => {
  const server = (
    name: string,
    description?: string,
    exposure?: "codemode" | "deferred" | "direct",
  ) => ({
    entry: {
      name,
      config: {
        command: "x",
        ...(description ? { description } : {}),
        ...(exposure ? { exposure } : {}),
      },
      source: "test",
    },
  });

  it("lists servers with how their tools are reached and the first line of their description", () => {
    const section = renderServersSection([
      server("docs", "Docs search.\nMore."),
      server("later", undefined, "deferred"),
      server("direct", "Declared.", "direct"),
      { entry: server("plain").entry, connection: { instructions: "From instructions." } },
    ]);
    expect(section?.split("\n").slice(1)).toEqual([
      "- mcp__docs (codemode): Docs search.",
      "- mcp__later (tool_search)",
      "- mcp__plain (codemode): From instructions.",
    ]);
    expect(renderServersSection([server("direct", "Declared.", "direct")])).toBeUndefined();
  });

  it("shortens descriptions to fit the size limit", () => {
    const servers = Array.from({ length: 40 }, (_, index) =>
      server(`server${index}`, "x".repeat(400)),
    );
    const section = renderServersSection(servers) ?? "";
    expect(section.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
    expect(section.split("\n")).toHaveLength(41);
    expect(section).toContain("- mcp__server39 (codemode): x");
  });

  it("leaves out the last servers when their names alone do not fit", () => {
    const servers = Array.from({ length: 200 }, (_, index) =>
      server(`server-with-a-long-name-${index}`, "desc"),
    );
    const section = renderServersSection(servers) ?? "";
    expect(section.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
    const lines = section.split("\n");
    expect(lines.at(-1)).toMatch(/^- … \d+ more servers; find their tools with searchTools\(\)$/u);
    const omitted = Number(/(\d+) more/u.exec(lines.at(-1) ?? "")?.[1]);
    expect(lines.length - 2 + omitted).toBe(200);
  });
});
