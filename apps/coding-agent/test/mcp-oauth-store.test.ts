import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type authStorageTypes from "../src/core/auth-storage.types.ts";
import InMemoryAuthStorageBackend from "../src/core/in-memory-auth-storage-backend.ts";
import McpOAuthCredentialStore from "../src/extensions/mcp/mcp-oauth-credential-store.ts";
import mcpOAuthMemoryStore from "./mcp-oauth-memory-store.ts";

const { awaited, runTest, toJsonText } = testing;
const { oauthState } = mcpOAuthMemoryStore;

const SERVER_URL = "https://mcp.example.com/mcp";

const storedKeys = (backend: authStorageTypes.InMemoryAuthStorageBackend) =>
  Effect.map(
    awaited(backend.withLockAsync((current) => Promise.resolve({ result: current ?? "{}" }))),
    (text): string[] => Object.keys(JSON.parse(text)),
  );

const keepsSeparateCredentialsForServersSharingA = () =>
  runTest(
    Effect.gen(function* () {
      const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend());
      yield* awaited(
        store.forServer("work", SERVER_URL).save(oauthState(SERVER_URL, "work-token")),
      );
      yield* awaited(
        store.forServer("personal", SERVER_URL).save(oauthState(SERVER_URL, "personal-token")),
      );

      expect(
        (yield* awaited(store.forServer("work", SERVER_URL).load()))?.tokens?.access_token,
      ).toBe("work-token");
      expect(
        (yield* awaited(store.forServer("personal", SERVER_URL).load()))?.tokens?.access_token,
      ).toBe("personal-token");

      expect(yield* awaited(store.remove("work", SERVER_URL))).toBe(true);
      expect(yield* awaited(store.forServer("work", SERVER_URL).load())).toBeUndefined();
      expect((yield* awaited(store.tokens("personal", SERVER_URL)))?.access_token).toBe(
        "personal-token",
      );
    }),
  );

const movesCredentialsStoredByServerUrlTo = () =>
  runTest(
    Effect.gen(function* () {
      const backend = new InMemoryAuthStorageBackend(
        yield* toJsonText({ [SERVER_URL]: oauthState(SERVER_URL, "legacy-token") }),
      );
      const store = new McpOAuthCredentialStore(backend);

      expect((yield* awaited(store.tokens("work", SERVER_URL)))?.access_token).toBe("legacy-token");
      expect(yield* storedKeys(backend)).toEqual([SERVER_URL]);

      expect(
        (yield* awaited(store.forServer("my_work", SERVER_URL).load()))?.tokens?.access_token,
      ).toBe("legacy-token");

      expect((yield* awaited(store.tokens("my-work", SERVER_URL)))?.access_token).toBe(
        "legacy-token",
      );
      expect(yield* awaited(store.forServer("personal", SERVER_URL).load())).toBeUndefined();
      expect(yield* storedKeys(backend)).toEqual([`mcp__my_work|${SERVER_URL}`]);
    }),
  );

const signsOutOfCredentialsStoredByServer = () =>
  runTest(
    Effect.gen(function* () {
      const backend = new InMemoryAuthStorageBackend(
        yield* toJsonText({ [SERVER_URL]: oauthState(SERVER_URL, "legacy-token") }),
      );
      const store = new McpOAuthCredentialStore(backend);

      expect(yield* awaited(store.remove("work", SERVER_URL))).toBe(true);
      expect(yield* storedKeys(backend)).toEqual([]);
      expect(yield* awaited(store.remove("work", SERVER_URL))).toBe(false);
    }),
  );

describe("MCP OAuth credential store", () => {
  it(
    "keeps separate credentials for servers sharing a SERVER_URL",
    keepsSeparateCredentialsForServersSharingA,
  );

  it(
    "moves credentials stored by SERVER_URL to the first server that loads them",
    movesCredentialsStoredByServerUrlTo,
  );

  it("signs out of credentials stored by SERVER_URL", signsOutOfCredentialsStoredByServer);
});
