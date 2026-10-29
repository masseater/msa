import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import memoryStartupScripts from "./memory-startup-scripts.ts";
import memoryStartupSupport from "./memory-startup-support.ts";

const { readTextFile, runTest } = testing;
const { SEPIACE_ENTRIES } = memoryStartupScripts;
const { LEGACY_TOKEN, toolNames, useAgents } = memoryStartupSupport;

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

const judgesSepiaceBeforeCheckingTheServer = Effect.gen(function* () {
  const agent = yield* setUp({
    extensionServers: (url) => [
      ["my_notes", reachableServer(url)],
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
});
