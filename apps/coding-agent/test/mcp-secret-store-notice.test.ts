import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import SecretStoreAuthBackend from "../src/extensions/mcp/credentials/secret-store-backend.ts";
import McpOAuthCredentialStore from "../src/extensions/mcp/mcp-oauth-credential-store.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removeDir,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const SERVER_URL = "https://mcp.example.com/mcp";
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
  const root = yield* makeTempDir("msa-secret-notice-");
  directories.push(root);
  const agentDir = joinPath(root, "agent");
  yield* makeDirectory(agentDir);
  return { agentDir };
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

const forgetfulStore = {
  description: "a keychain that drops what it is given",
  persistent: true,
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(),
};

const warnsWhenSignInsStopBeingSaved = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      const legacy = joinPath(agentDir, "mcp-auth.json");
      yield* writeTextFile(
        legacy,
        yield* toJsonText({ [`mcp__docs|${SERVER_URL}`]: state("old-token-value") }),
      );
      const store = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir, defaultStore: failingStore }),
        agentDir,
      );
      const warnings: string[] = [];
      store.onMemoryOnly((notice) => warnings.push(notice));
      expect((yield* awaited(store.tokens("docs", SERVER_URL)))?.access_token).toBe(
        "old-token-value",
      );
      yield* awaited(store.forServer("docs", SERVER_URL).save(state("refreshed")));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`${legacy} was deleted`);
      expect(warnings[0]).toContain("they last until");
      expect(warnings[0]).toContain("The sign-ins it held (docs) last only until");
      expect(warnings[0]).toContain(
        `credentialHelper to a docker-credential helper in ${joinPath(agentDir, "mcp.json")}`,
      );
      expect(warnings[0]).not.toContain("old-token-value");
      expect(warnings[0]).not.toContain("..");
    }),
  );

const warnsWhenALaterWriteFallsBack = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      const store = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir, defaultStore: readOnlyStore }),
        agentDir,
      );
      const warnings: string[] = [];
      store.onMemoryOnly((notice) => warnings.push(notice));
      expect(yield* awaited(store.tokens("docs", SERVER_URL))).toBeUndefined();
      expect(warnings).toEqual([]);
      yield* awaited(store.forServer("docs", SERVER_URL).save(state("token-at-login")));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toContain("was deleted");
      expect(warnings[0]).not.toContain("sign-ins it held");
      expect(warnings[0]).not.toContain("token-at-login");
    }),
  );

const checksTheStoreKeptTheTokensBeforeDeletingTheFile = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir } = yield* workspace;
      const legacy = joinPath(agentDir, "mcp-auth.json");
      yield* writeTextFile(
        legacy,
        yield* toJsonText({ [`mcp__docs|${SERVER_URL}`]: state("old") }),
      );
      const store = new McpOAuthCredentialStore(
        new SecretStoreAuthBackend({ agentDir, defaultStore: forgetfulStore }),
        agentDir,
      );
      expect((yield* awaited(store.tokens("docs", SERVER_URL)))?.access_token).toBe("old");
      expect(yield* awaited(store.persistenceNote())).toContain("did not keep what was written");
    }),
  );

describe("MCP sign-in storage notices", () => {
  it(
    "warns once, naming the deleted mcp-auth.json and credentialHelper, when sign-ins stop being saved",
    warnsWhenSignInsStopBeingSaved,
  );
  it("warns when a write after startup falls back to memory", warnsWhenALaterWriteFallsBack);
  it(
    "reads back what the store kept before trusting it with mcp-auth.json",
    checksTheStoreKeptTheTokensBeforeDeletingTheFile,
  );
});
