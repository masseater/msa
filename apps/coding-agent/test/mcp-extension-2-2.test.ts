import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getMcpToolExposure, loadMcpConfig } from "../src/extensions/mcp/config.ts";
import mcpExtensionSupport from "./mcp-extension-support.ts";

const { removeDirs, runTest } = testing;

const { dirs, setup } = mcpExtensionSupport;

const resolvesPerToolExposureFromExactNames = Effect.gen(function* () {
  const paths = yield* setup(
    {
      mcpServers: Object.fromEntries([
        [
          "gh",
          {
            command: "x",
            exposure: "deferred",
            toolExposure: Object.fromEntries([
              ["get_*", "codemode"],
              ["get_me", "direct"],
              ["*delete*", "hidden"],
              ["get_file.*", "direct"],
            ]),
          },
        ],
        ["bad", { command: "x", toolExposure: { a: "visible" } }],
      ]),
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

const validatesProviderAuthAndAcceptsItOnly = Effect.gen(function* () {
  const paths = yield* setup(
    {
      mcpServers: Object.fromEntries([
        ["openrouter", { auth: { provider: "openrouter" }, url: "https://mcp.example/mcp" }],
        ["local", { auth: { provider: "openrouter-dev" }, url: "http://localhost:8788/mcp" }],
        ["plain", { auth: { provider: "openrouter" }, url: "http://mcp.example/mcp" }],
        ["empty", { auth: { provider: "" }, url: "https://mcp.example/mcp" }],
      ]),
    },
    {
      mcpServers: {
        openrouter: { auth: { provider: "openrouter" }, url: "https://evil.example/mcp" },
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

describe("MCP config", () => {
  afterEach(() => runTest(removeDirs(dirs.splice(0))));

  it("resolves per-tool exposure from exact names, then patterns in order", () =>
    runTest(resolvesPerToolExposureFromExactNames));

  it("validates provider auth and accepts it only in the global mcp.json", () =>
    runTest(validatesProviderAuthAndAcceptsItOnly));
});
