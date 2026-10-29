import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import memoryStartupSupport from "./memory-startup-support.ts";

const { readTextFile, runTest } = testing;
const { toolNames, toolResults, useAgents } = memoryStartupSupport;

const setUp = useAgents();

const signInsAsked = (log: readonly string[]) =>
  log.filter((line) => line.startsWith("401") || line === "register" || line === "token code");

const SEPIACE_ENTRIES = (sepiaceUrl: string) => ({
  notes: { exposure: "direct", url: "https://hi.sepiace.io/api/v1/mcp" },
  sepiace: { exposure: "direct", url: sepiaceUrl },
});

const recallsWithoutMcpSupport = Effect.gen(function* () {
  const agent = yield* setUp({ signedIn: true });
  const result = yield* agent.prompt("where does the release go?", ["--no-mcp"]);
  expect(result.code, result.stderr).toBe(0);
  expect(agent.sepiace.memoryRequests.some((request) => request.includes("release"))).toBe(true);
  const [request = ""] = agent.model.bodies;
  expect(request).toContain("Releases go to the tap.");
  expect(yield* toolNames(request)).toContain("memory");
  expect(signInsAsked(agent.sepiace.log)).toEqual([]);
});

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

const survivesAnExtensionReplacingMcp = Effect.gen(function* () {
  const agent = yield* setUp({
    mcpServers: SEPIACE_ENTRIES,
    memoryToolRequest: "where does the release go?",
    replaceMcp: true,
    signedIn: true,
  });
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toContain("built-in extension `mcp` was not loaded");
  expect(result.stderr).toContain('MCP server "sepiace" is ignored');
  const [request = "", answer = ""] = agent.model.bodies;
  expect(request).toContain("Releases go to the tap.");
  const tools = yield* toolNames(request);
  expect(tools).toContain("memory");
  expect(tools.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  expect((yield* toolResults(answer)).join("\n")).toContain("Releases go to the tap.");
});

const explainsAnUnreadableCredentialStore = Effect.gen(function* () {
  const agent = yield* setUp({
    memoryToolRequest: "where does the release go?",
    signedIn: true,
    storeFails: true,
  });
  const reason = "could not read the saved sign-in";
  const status = yield* agent.run(["memory", "status"]);
  expect(status.stdout).toContain(reason);
  expect(status.stdout).toContain("gpg: decryption failed");
  expect(status.stdout).not.toContain("connecting");
  const { notices, stderr } = yield* agent.rpc(["/memory"]);
  expect(notices, stderr).toHaveLength(1);
  expect(notices[0]).toContain(reason);
  expect(notices[0]).toContain("gpg: decryption failed");
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  const [, answer = ""] = agent.model.bodies;
  const toolResult = (yield* toolResults(answer)).join("\n");
  expect(toolResult).toContain(reason);
  expect(toolResult).toContain("gpg: decryption failed");
  expect(toolResult).not.toContain("sign in with");
  expect(signInsAsked(agent.sepiace.log)).toEqual([]);
});

const recoversWhenTheCredentialStoreUnlocks = Effect.gen(function* () {
  const agent = yield* setUp({
    memoryToolRequest: "where does the release go?",
    signedIn: true,
    storeFails: true,
  });
  const { notices, stderr } = yield* agent.rpc([
    "/memory",
    "!unlock",
    "/memory",
    "where does the release go?",
  ]);
  const [locked = "", unlocked = ""] = notices;
  expect(locked, stderr).toContain("gpg: decryption failed");
  expect(unlocked, stderr).not.toContain("could not read the saved sign-in");
  expect(unlocked).toContain("connected");
  expect(unlocked).not.toContain("not connected");
  const [request = "", answer = ""] = agent.model.bodies;
  expect(request, stderr).toContain("Releases go to the tap.");
  const toolResult = (yield* toolResults(answer)).join("\n");
  expect(toolResult).toContain("Releases go to the tap.");
  expect(signInsAsked(agent.sepiace.log)).toEqual([]);
});

const leavesSepiaceOutOfSlashMcp = Effect.gen(function* () {
  const agent = yield* setUp({ mcpServers: SEPIACE_ENTRIES, signedIn: true });
  const { notices, stderr } = yield* agent.rpc(["/mcp", "/mcp login sepiace"]);
  expect(notices, stderr).toHaveLength(2);
  expect(notices[0]).not.toContain("sepiace");
  expect(notices[0]).not.toContain("notes");
  expect(notices[1]).toBe(
    "sepiace is long-term memory, not an MCP server; sign in with /memory or msa memory login.",
  );
});

const reusesTheSignInOfMsaMcpLogin = Effect.gen(function* () {
  const agent = yield* setUp({ signedIn: true });
  const status = yield* agent.run(["memory", "status"]);
  expect(status.code, status.stderr).toBe(0);
  expect(status.stdout).toContain("Memory: sepiace (connected)");
  expect(agent.sepiace.authorizations).toHaveLength(0);
  expect(agent.sepiace.tokenRequests).toHaveLength(0);
  expect(signInsAsked(agent.sepiace.log)).toEqual([]);
  expect(agent.sepiace.authorizations).toHaveLength(0);
});

const signsInAndOutThroughMsaMemory = Effect.gen(function* () {
  const agent = yield* setUp({ signedIn: false });
  const before = yield* agent.run(["memory", "status"]);
  expect(before.stdout).toContain("not signed in; sign in with /memory or msa memory login");
  const login = yield* agent.run(["memory", "login", "--timeout", "30"]);
  expect(login.code, login.stderr).toBe(0);
  expect(login.stdout).toContain("Signed in to sepiace.");
  expect(agent.sepiace.authorizations).toHaveLength(1);
  expect(yield* readTextFile(agent.store)).toContain("mcp__sepiace|");
  const signedIn = yield* agent.run(["memory", "status"]);
  expect(signedIn.stdout).toContain("Memory: sepiace (connected)");
  const logout = yield* agent.run(["memory", "logout"]);
  expect(logout.stdout).toContain("Signed out of sepiace.");
  const after = yield* agent.run(["memory", "status"]);
  expect(after.stdout).toContain("not signed in");
});

const memoryEnabledAloneTurnsItOff = Effect.gen(function* () {
  const agent = yield* setUp({ memory: { enabled: false }, signedIn: true });
  const result = yield* agent.prompt("where does the release go?");
  expect(result.code, result.stderr).toBe(0);
  const [request = ""] = agent.model.bodies;
  expect(yield* toolNames(request)).not.toContain("memory");
  expect(request).not.toContain("Releases go to the tap.");
  expect(agent.sepiace.memoryRequests).toEqual([]);
  const status = yield* agent.run(["memory", "status"]);
  expect(status.stdout).toContain("Memory is off (settings: memory.enabled).");
});

describe.skipIf(process.platform === "win32")("long-term memory from the msa command", () => {
  it(
    "recalls and offers the memory tool with --no-mcp",
    () => runTest(recallsWithoutMcpSupport),
    90_000,
  );
  it(
    "warns about and ignores mcp.json entries for sepiace, and passes no mcp__ tools for it",
    () => runTest(ignoresMcpJsonEntriesForSepiace),
    90_000,
  );
  it(
    "recalls and offers the memory tool when an extension replaces the MCP support",
    () => runTest(survivesAnExtensionReplacingMcp),
    90_000,
  );
  it(
    "shows why when the credential store cannot be read",
    () => runTest(explainsAnUnreadableCredentialStore),
    90_000,
  );
  it(
    "reads the saved sign-in again once the credential store unlocks",
    () => runTest(recoversWhenTheCredentialStoreUnlocks),
    90_000,
  );
  it(
    "leaves sepiace out of /mcp and points /mcp login sepiace to memory",
    () => runTest(leavesSepiaceOutOfSlashMcp),
    90_000,
  );
  it(
    "uses a sign-in saved by msa mcp login sepiace without signing in again",
    () => runTest(reusesTheSignInOfMsaMcpLogin),
    90_000,
  );
  it(
    "signs in, reports, and signs out with msa memory",
    () => runTest(signsInAndOutThroughMsaMemory),
    90_000,
  );
  it(
    "turns memory off with memory.enabled alone",
    () => runTest(memoryEnabledAloneTurnsItOff),
    90_000,
  );
});
