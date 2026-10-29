import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import memoryStartupScripts from "./memory-startup-scripts.ts";
import memoryStartupSupport from "./memory-startup-support.ts";
import mcpOauthServer from "./suite/mcp-oauth-server.ts";

const { readTextFile, runTest } = testing;
const { SEPIACE_ENTRIES } = memoryStartupScripts;
const { LEGACY_TOKEN, toolNames, useAgents } = memoryStartupSupport;
const { startOAuthMcpServer } = mcpOauthServer;

const setUp = useAgents();

const ignoresMcpJsonEntriesForSepiace = Effect.gen(function* () {
  const agent = yield* setUp({ mcpServers: SEPIACE_ENTRIES, signedIn: true });
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toContain('MCP server "sepiace" is ignored');
  expect(result.stderr).toContain('MCP server "notes" is ignored');
  const [request = ""] = agent.model.bodies;
  expect(request).toContain("Releases go to the tap.");
  const tools = yield* toolNames(request);
  expect(tools).toContain("memory");
  expect(tools.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  const listed = yield* agent.run(["mcp", "list"]);
  expect(listed.stdout).not.toContain("sepiace");
  expect(listed.stdout).not.toContain("notes");
  const before = yield* readTextFile(agent.mcpConfig);
  for (const args of [
    ["mcp", "add", "sepiace", "--url", agent.sepiace.url],
    ["mcp", "add", "memories", "--url", "https://hi.sepiace.io/api/v1/mcp"],
  ]) {
    const added = yield* agent.run(args);
    expect(added.code).toBe(1);
    expect(added.stderr).toContain("sepiace is long-term memory, not an MCP server");
  }
  expect(yield* readTextFile(agent.mcpConfig)).toBe(before);
});

const ignoresSepiaceRegisteredByAnExtension = (registerOnSessionStart: boolean) =>
  Effect.gen(function* () {
    const agent = yield* setUp({
      extensionServers: (url) => Object.entries(SEPIACE_ENTRIES(url)),
      registerOnSessionStart,
      signedIn: true,
    });
    const result = yield* agent.prompt("where does the release go?");
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      `${agent.extension}: MCP server "sepiace" is ignored, because long-term memory connects to sepiace itself`,
    );
    expect(result.stderr).toContain(`${agent.extension}: MCP server "notes" is ignored`);
    const [request = ""] = agent.model.bodies;
    expect(request).toContain("Releases go to the tap.");
    const tools = yield* toolNames(request);
    expect(tools).toContain("memory");
    expect(tools.filter((name) => name.startsWith("mcp__"))).toEqual([]);
    const { notices, stderr } = yield* agent.rpc(["/mcp"]);
    expect(notices, stderr).toHaveLength(1);
    expect(notices[0]).not.toContain("sepiace");
    expect(notices[0]).not.toContain("notes");
  });

const SEPIACE_HOST_URL = "https://hi.sepiace.io/api/v1/mcp";

const reachableServer = (url: string) => ({
  exposure: "direct",
  headers: { Authorization: `Bearer ${LEGACY_TOKEN}` },
  url,
});

const dropsAServerReRegisteredAtSepiace = Effect.gen(function* () {
  const agent = yield* setUp({
    extensionServers: (url) => [
      ["notes", reachableServer(url)],
      ["notes", { exposure: "direct", url: SEPIACE_HOST_URL }],
    ],
    signedIn: true,
  });
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toContain(`${agent.extension}: MCP server "notes" is ignored`);
  const [request = ""] = agent.model.bodies;
  const tools = yield* toolNames(request);
  expect(tools).toContain("memory");
  expect(tools.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  const { notices, stderr } = yield* agent.rpc(["/mcp"]);
  expect(notices, stderr).toHaveLength(1);
  expect(notices[0]).not.toContain("notes");
});

const otherServer = Effect.acquireRelease(
  Effect.promise(() => startOAuthMcpServer({ memory: () => "" })),
  (server) => Effect.promise(server.close),
).pipe(Effect.tap((server) => Effect.sync(() => server.trustToken(LEGACY_TOKEN))));

const judgesSepiaceBeforeCheckingTheServer = Effect.gen(function* () {
  const other = yield* otherServer;
  const agent = yield* setUp({
    extensionServers: () => [
      ["my_notes", reachableServer(other.url)],
      ["sepiace", { exposure: "direct" }],
      ["my-notes", { exposure: "direct", url: SEPIACE_HOST_URL }],
    ],
    registerOnSessionStart: true,
    signedIn: true,
  });
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toContain(`${agent.extension}: MCP server "my-notes" is ignored`);
  expect(result.stderr).toContain(`${agent.extension}: MCP server "sepiace" is ignored`);
  expect(result.stderr).not.toContain("conflicts with registered server");
  expect(result.stderr).not.toContain("Invalid MCP server");
  const [request = ""] = agent.model.bodies;
  const tools = yield* toolNames(request);
  expect(tools).toContain("memory");
  expect(new Set(tools.filter((name) => name.startsWith("mcp__")))).toEqual(
    new Set(["mcp__my_notes__memory", "mcp__my_notes__whoami"]),
  );
}).pipe(Effect.scoped);

const proxiedThrough = (url: string) => ({
  args: ["-y", "mcp-remote", url],
  command: "npx",
  exposure: "direct",
});

const ignoresServersAtTheConfiguredMemoryHost = Effect.gen(function* () {
  const agent = yield* setUp({
    extensionServers: (url) => [
      ["recall", reachableServer(url)],
      ["recall-proxy", proxiedThrough(url)],
    ],
    mcpServers: (url) => ({
      memories: reachableServer(url),
      "memories-proxy": proxiedThrough(url),
    }),
    signedIn: true,
  });
  expect(new URL(agent.sepiace.url).host).not.toBe(new URL(SEPIACE_HOST_URL).host);
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  const [request = ""] = agent.model.bodies;
  expect(request).toContain("Releases go to the tap.");
  const tools = yield* toolNames(request);
  expect(tools).toContain("memory");
  expect(tools.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  for (const name of ["memories", "memories-proxy"])
    expect(result.stderr).toContain(`${agent.mcpConfig}: MCP server "${name}" is ignored`);
  for (const name of ["recall", "recall-proxy"])
    expect(result.stderr).toContain(`${agent.extension}: MCP server "${name}" is ignored`);
  const before = yield* readTextFile(agent.mcpConfig);
  for (const args of [
    ["mcp", "add", "memories", "--url", agent.sepiace.url],
    ["mcp", "add", "memories", "--", "npx", "-y", "mcp-remote", agent.sepiace.url],
  ]) {
    const added = yield* agent.run(args);
    expect(added.code).toBe(1);
    expect(added.stderr).toContain("sepiace is long-term memory, not an MCP server");
  }
  expect(yield* readTextFile(agent.mcpConfig)).toBe(before);
});

describe.skipIf(process.platform === "win32")("sepiace configured as an MCP server", () => {
  it(
    "warns about and ignores mcp.json entries for sepiace, and passes no mcp__ tools for it",
    () => runTest(ignoresMcpJsonEntriesForSepiace),
    90_000,
  );
  it(
    "warns about and ignores sepiace servers registered by an extension, and passes no mcp__ tools for them",
    () => runTest(ignoresSepiaceRegisteredByAnExtension(false)),
    90_000,
  );
  it(
    "warns about and ignores sepiace servers an extension registers at session_start",
    () => runTest(ignoresSepiaceRegisteredByAnExtension(true)),
    90_000,
  );
  it(
    "drops a server an extension registers again at sepiace",
    () => runTest(dropsAServerReRegisteredAtSepiace),
    90_000,
  );
  it(
    "ignores a sepiace server before checking its config and name clashes",
    () => runTest(judgesSepiaceBeforeCheckingTheServer),
    90_000,
  );
  it(
    "ignores servers at the host of memory.url, directly or through a stdio proxy, on every path",
    () => runTest(ignoresServersAtTheConfiguredMemoryHost),
    90_000,
  );
});
