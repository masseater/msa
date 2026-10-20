import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadMcpConfig } from "../src/extensions/mcp/config.ts";
import mcpExtensionSupport from "./mcp-extension-support.ts";

const { removeDirs, runTest } = testing;

const { dirs, setup } = mcpExtensionSupport;

const validatesExposureAndReadsAutoenablecodemodeWithProject = Effect.gen(function* () {
  const paths = yield* setup(
    {
      autoEnableCodemode: false,
      mcpServers: Object.fromEntries([
        ["later", { command: "x", exposure: "deferred" }],
        [
          "scripts",
          {
            command: "x",
            exposure: "codemode-deferred",
            toolExposure: { a: "codemode-deferred" },
          },
        ],
        ["off", { command: "x", exposure: "hidden" }],
        ["wrong", { command: "x", exposure: "model-only" }],
        ["described", { command: "x", description: "Docs search" }],
        ["badDescription", { command: "x", description: 1 }],
      ]),
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

const OAUTH_SERVERS = Object.fromEntries([
  [
    "ok",
    {
      oauth: { callbackUrl: "http://localhost:8080/callback", scope: "a b" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "ipv6",
    {
      oauth: { callbackPort: 9000, callbackUrl: "http://[::1]/cb" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "same",
    {
      oauth: { callbackPort: 2, callbackUrl: "http://127.0.0.1:2/cb" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "remote",
    {
      oauth: { callbackUrl: "https://example.com/callback" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "both",
    {
      oauth: { callbackPort: 2, callbackUrl: "http://127.0.0.1:1/cb" },
      url: "https://a.example/mcp",
    },
  ],
  ["scope", { oauth: { scope: ["a"] }, url: "https://a.example/mcp" }],
  ["named", { oauth: { clientName: "Claude Code" }, url: "https://a.example/mcp" }],
  ["unnamed", { oauth: { clientName: " " }, url: "https://a.example/mcp" }],
  [
    "metadata",
    {
      oauth: { authServerMetadataUrl: "https://idp.example/m" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "plainMetadata",
    {
      oauth: { authServerMetadataUrl: "http://idp.example/m" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "cimd",
    {
      oauth: { callbackUrl: "http://localhost/callback", clientRegistration: "cimd" },
      url: "https://a.example/mcp",
    },
  ],
  ["badRegistration", { oauth: { clientRegistration: "auto" }, url: "https://a.example/mcp" }],
  [
    "cimdClient",
    {
      oauth: { clientId: "x", clientRegistration: "cimd" },
      url: "https://a.example/mcp",
    },
  ],
  [
    "cimdPath",
    {
      oauth: { callbackUrl: "http://127.0.0.1/cb", clientRegistration: "cimd" },
      url: "https://a.example/mcp",
    },
  ],
]);

const EXPECTED_OAUTH_ERRORS = [
  'server "remote": oauth.callbackUrl must be an http URI on localhost',
  'server "both": oauth.callbackUrl and oauth.callbackPort name different ports',
  'server "scope": oauth.scope must be a string',
  'server "unnamed": oauth.clientName must be a non-empty string',
  'server "plainMetadata": oauth.authServerMetadataUrl must be an https URL',
  'server "badRegistration": oauth.clientRegistration must be "dcr" or "cimd"',
  'server "cimdClient": oauth.clientRegistration "cimd" cannot be combined',
  'server "cimdPath": oauth.clientRegistration "cimd" requires oauth.callbackUrl',
];

const validatesTheOauthCallbackUrlScopeAnd = Effect.gen(function* () {
  const paths = yield* setup({ mcpServers: OAUTH_SERVERS }, {});
  const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
  expect(servers.map((server) => server.name)).toEqual([
    "ok",
    "ipv6",
    "same",
    "named",
    "metadata",
    "cimd",
  ]);
  expect(errors).toEqual(EXPECTED_OAUTH_ERRORS.map((message) => expect.stringContaining(message)));
});

describe("MCP config", () => {
  afterEach(() => runTest(removeDirs(dirs.splice(0))));

  it("validates exposure and reads autoEnableCodemode with project precedence", () =>
    runTest(validatesExposureAndReadsAutoenablecodemodeWithProject));

  it("validates the OAuth callback URL, scope, and client name", () =>
    runTest(validatesTheOauthCallbackUrlScopeAnd));
});
