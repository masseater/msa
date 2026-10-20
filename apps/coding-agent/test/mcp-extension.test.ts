import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadMcpConfig, updateMcpServerConfig } from "../src/extensions/mcp/config.ts";
import mcpExtensionSupport from "./mcp-extension-support.ts";

const { fromJsonText, joinPath, readTextFile, removeDirs, runTest, toJsonText, writeTextFile } =
  testing;

const { dirs, setup } = mcpExtensionSupport;

const TOKEN_HEADER = "Bearer ${TOKEN}";

const mergesGlobalAndTrustedProjectServersAnd = Effect.gen(function* () {
  const paths = yield* setup(
    {
      mcpServers: Object.fromEntries([
        ["shared", { command: "global-cmd" }],
        ["remote", { headers: { Authorization: TOKEN_HEADER }, url: "https://example.com/mcp" }],
        ["off", { command: "x", enabled: false }],
        ["bad", { args: ["no command"] }],
        ["legacy", { type: "sse", url: "https://example.com/sse" }],
        ["badUrl", { url: "example.com/mcp" }],
        ["bad name", { command: "x" }],
      ]),
    },
    { mcpServers: { shared: { command: "project-cmd", exposure: "direct" } } },
  );

  const trusted = loadMcpConfig({ ...paths, projectTrusted: true });

  expect(trusted.servers.map((server) => [server.name, server.scope, server.config])).toEqual([
    ["shared", "project", { command: "project-cmd", exposure: "direct" }],
    [
      "remote",
      "global",
      { headers: { Authorization: TOKEN_HEADER }, url: "https://example.com/mcp" },
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

const rejectsServerNamesThatDifferOnlyIn = Effect.gen(function* () {
  const paths = yield* setup(
    { mcpServers: { "work-files": { command: "a" }, work_files: { command: "b" } } },
    {},
  );
  const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
  expect(servers.map((server) => server.name)).toEqual(["work-files"]);
  expect(errors).toEqual([
    expect.stringContaining('server "work_files" conflicts with "work-files"'),
  ]);
});

describe("MCP config", () => {
  afterEach(() => runTest(removeDirs(dirs.splice(0))));

  it("merges global and trusted project servers and validates entries", () =>
    runTest(mergesGlobalAndTrustedProjectServersAnd));
});

const letsProjectEntriesOverrideEnabledAndExposure = () =>
  runTest(
    Effect.gen(function* () {
      const paths = yield* setup(
        { mcpServers: { tools: { command: "x", env: { TOKEN: "secret" } } } },

        {
          mcpServers: Object.fromEntries([
            ["tools", { args: ["y"], enabled: false }],
            ["missing", { enabled: false }],
          ]),
        },
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

      yield* writeTextFile(
        project,
        yield* toJsonText({ mcpServers: { tools: { enabled: false } } }),
      );
      const [tools] = loadMcpConfig({ ...paths, projectTrusted: true }).servers;
      expect([tools?.override, tools?.config]).toEqual([
        project,
        { command: "x", enabled: false, env: { TOKEN: "secret" } },
      ]);

      updateMcpServerConfig(project, "tools", { enabled: true });
      const updated = (yield* fromJsonText(yield* readTextFile(project))) as {
        mcpServers: { tools: unknown };
      };
      expect(updated.mcpServers.tools).toEqual({ enabled: true });
    }),
  );

describe("MCP config", () => {
  afterEach(() => runTest(removeDirs(dirs.splice(0))));

  it(
    "lets project entries override enabled and exposure of global servers",
    letsProjectEntriesOverrideEnabledAndExposure,
  );

  it("rejects server names that differ only in - and _", () =>
    runTest(rejectsServerNamesThatDifferOnlyIn));
});
