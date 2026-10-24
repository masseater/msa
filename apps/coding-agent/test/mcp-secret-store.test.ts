import testing from "@msa/testing";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import mcpConfig from "../src/extensions/mcp/config.ts";
import SecretStoreAuthBackend from "../src/extensions/mcp/credentials/secret-store-backend.ts";
import McpOAuthCredentialStore from "../src/extensions/mcp/mcp-oauth-credential-store.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  readDirectory,
  readTextFile,
  removeDir,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;
const { loadMcpConfig } = mcpConfig;

const SERVER_URL = "https://mcp.example.com/mcp";
const HELPER = `import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
const [, , file, action] = process.argv;
appendFileSync(file + ".argv", JSON.stringify(process.argv.slice(2)) + "\\n");
const input = readFileSync(0, "utf8");
const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
if (action === "store") {
  const entry = JSON.parse(input);
  data[entry.ServerURL] = entry;
  writeFileSync(file, JSON.stringify(data));
} else if (action === "get") {
  const entry = data[input.trim()];
  if (entry === undefined) {
    process.stdout.write("credentials not found in native keychain");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(entry));
}
`;

const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const directory of directories.splice(0)) yield* removeDir(directory);
    }),
  ),
);

const state = (accessToken: string) => ({
  serverUrl: SERVER_URL,
  tokens: { access_token: accessToken, token_type: "Bearer" },
});

const workspace = Effect.gen(function* () {
  const root = yield* makeTempDir("msa-secret-store-");
  directories.push(root);
  const agentDir = joinPath(root, "agent");
  const helperDir = joinPath(root, "helper");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(helperDir);
  const script = joinPath(helperDir, "helper.mjs");
  const storeFile = joinPath(helperDir, "store.json");
  yield* writeTextFile(script, HELPER);
  const useHelper = writeTextFile(
    joinPath(agentDir, "mcp.json"),
    yield* toJsonText({
      credentialHelper: { args: [script, storeFile], command: process.execPath },
      mcpServers: {},
    }),
  );
  return { agentDir, root, storeFile, useHelper };
});

const filesHolding = (directory: string, text: string): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const found: string[] = [];
    for (const name of yield* readDirectory(directory)) {
      const content = yield* readTextFile(joinPath(directory, name)).pipe(
        Effect.orElseSucceed(() => ""),
      );
      if (content.includes(text)) found.push(name);
    }
    return found;
  });

const failingStore = {
  description: "a keychain that is locked",
  persistent: true,
  read: () => Promise.reject(new Error("User interaction is not allowed.")),
  write: () => Promise.reject(new Error("User interaction is not allowed.")),
};

const readOnlyStore = {
  description: "a keychain that rejects writes",
  persistent: true,
  read: () => Promise.resolve(undefined),
  write: () => Promise.reject(new Error("The keyring is locked.")),
};

const keepsSignInsInTheCredentialHelper = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir, storeFile, useHelper } = yield* workspace;
      yield* useHelper;
      const first = new McpOAuthCredentialStore(new SecretStoreAuthBackend({ agentDir }), agentDir);
      yield* awaited(first.forServer("docs", SERVER_URL).save(state("token-in-helper")));

      const second = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir }),
        agentDir,
      );
      expect((yield* awaited(second.tokens("docs", SERVER_URL)))?.access_token).toBe(
        "token-in-helper",
      );
      expect(yield* awaited(second.persistenceNote())).toBeUndefined();
      expect(yield* filesHolding(agentDir, "token-in-helper")).toEqual([]);
      expect(yield* readTextFile(storeFile)).toContain("token-in-helper");
      expect(yield* readTextFile(`${storeFile}.argv`)).not.toContain("token-in-helper");
    }),
  );

const movesMcpAuthJsonIntoTheStore = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir, useHelper } = yield* workspace;
      yield* useHelper;
      const legacy = joinPath(agentDir, "mcp-auth.json");
      yield* writeTextFile(
        legacy,
        yield* toJsonText({ [`mcp__docs|${SERVER_URL}`]: state("old") }),
      );

      const store = new McpOAuthCredentialStore(new SecretStoreAuthBackend({ agentDir }), agentDir);
      expect((yield* awaited(store.tokens("docs", SERVER_URL)))?.access_token).toBe("old");
      expect(yield* pathExists(legacy)).toBe(false);

      const again = new McpOAuthCredentialStore(new SecretStoreAuthBackend({ agentDir }), agentDir);
      expect((yield* awaited(again.tokens("docs", SERVER_URL)))?.access_token).toBe("old");
    }),
  );

const keepsSignInsInMemoryWithoutAStore = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      const backend = new SecretStoreAuthBackend({ agentDir, defaultStore: failingStore });
      const store = new McpOAuthCredentialStore(backend, agentDir);
      yield* awaited(store.forServer("docs", SERVER_URL).save(state("token-in-memory")));

      expect((yield* awaited(store.tokens("docs", SERVER_URL)))?.access_token).toBe(
        "token-in-memory",
      );
      const note = yield* awaited(store.persistenceNote());
      expect(note).toContain("because User interaction is not allowed; they last until");
      expect(note).not.toContain("..");
      expect(yield* filesHolding(agentDir, "token-in-memory")).toEqual([]);
      const restarted = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir, defaultStore: failingStore }),
        agentDir,
      );
      expect(yield* awaited(restarted.tokens("docs", SERVER_URL))).toBeUndefined();
    }),
  );

const fallsBackWhenTheStoreRejectsWrites = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      const store = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir, defaultStore: readOnlyStore }),
        agentDir,
      );
      yield* awaited(store.forServer("docs", SERVER_URL).save(state("token-after-refusal")));
      expect((yield* awaited(store.tokens("docs", SERVER_URL)))?.access_token).toBe(
        "token-after-refusal",
      );
      expect(yield* awaited(store.persistenceNote())).toContain("because The keyring is locked;");
      expect(yield* filesHolding(agentDir, "token-after-refusal")).toEqual([]);
    }),
  );

const deletesMcpAuthJsonWithoutAStore = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      const legacy = joinPath(agentDir, "mcp-auth.json");
      yield* writeTextFile(
        legacy,
        yield* toJsonText({ [`mcp__docs|${SERVER_URL}`]: state("old") }),
      );
      const store = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir, defaultStore: failingStore }),
        agentDir,
      );
      expect((yield* awaited(store.tokens("docs", SERVER_URL)))?.access_token).toBe("old");
      expect(yield* pathExists(legacy)).toBe(false);
    }),
  );

const failsWhenTheConfiguredHelperFails = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      yield* writeTextFile(
        joinPath(agentDir, "mcp.json"),
        yield* toJsonText({ credentialHelper: { command: joinPath(agentDir, "missing-helper") } }),
      );
      const store = new McpOAuthCredentialStore(new SecretStoreAuthBackend({ agentDir }), agentDir);
      const saved = yield* Effect.exit(
        awaited(store.forServer("docs", SERVER_URL).save(state("never-stored"))),
      );
      expect(Exit.isFailure(saved)).toBe(true);
      expect(yield* filesHolding(agentDir, "never-stored")).toEqual([]);
    }),
  );

const rejectsAProjectCredentialHelper = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir, root } = yield* workspace;
      const cwd = joinPath(root, "project");
      yield* makeDirectory(joinPath(cwd, ".msa"));
      yield* writeTextFile(
        joinPath(cwd, ".msa", "mcp.json"),
        yield* toJsonText({ credentialHelper: { command: "steal-tokens" }, mcpServers: {} }),
      );
      const loaded = yield* awaited(loadMcpConfig({ agentDir, cwd, projectTrusted: true }));
      expect(loaded.errors).toEqual([
        `${joinPath(cwd, ".msa", "mcp.json")}: credentialHelper is only allowed in the global mcp.json`,
      ]);
    }),
  );

describe("MCP sign-in storage", () => {
  it(
    "keeps sign-ins in the configured credential helper, passing tokens on stdin",
    keepsSignInsInTheCredentialHelper,
  );
  it("moves mcp-auth.json into the credential store and deletes it", movesMcpAuthJsonIntoTheStore);
  it(
    "keeps sign-ins in memory, not in a file, when no credential store works",
    keepsSignInsInMemoryWithoutAStore,
  );
  it(
    "keeps sign-ins in memory when the store accepts reads but rejects writes",
    fallsBackWhenTheStoreRejectsWrites,
  );
  it(
    "deletes mcp-auth.json when only memory can keep its sign-ins",
    deletesMcpAuthJsonWithoutAStore,
  );
  it(
    "fails instead of falling back when the configured helper fails",
    failsWhenTheConfiguredHelperFails,
  );
  it("rejects a credential helper in the project mcp.json", rejectsAProjectCredentialHelper);
});
