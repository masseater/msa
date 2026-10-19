import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import { McpOAuthCredentialStore } from "../src/extensions/mcp/oauth.ts";

const SERVER_URL = "https://mcp.example.com/mcp";

function state(accessToken: string) {
  return { serverUrl: SERVER_URL, tokens: { access_token: accessToken, token_type: "Bearer" } };
}

function storedKeys(backend: InMemoryAuthStorageBackend): string[] {
  return Object.keys(JSON.parse(backend.withLock((current) => ({ result: current ?? "{}" }))));
}

describe("MCP OAuth credential store", () => {
  it("keeps separate credentials for servers sharing a SERVER_URL", () =>
    runTest(
      Effect.gen(function* () {
        const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend());
        yield* awaited(store.forServer("work", SERVER_URL).save(state("work-token")));
        yield* awaited(store.forServer("personal", SERVER_URL).save(state("personal-token")));

        expect(
          (yield* awaited(store.forServer("work", SERVER_URL).load()))?.tokens?.access_token,
        ).toBe("work-token");
        expect(
          (yield* awaited(store.forServer("personal", SERVER_URL).load()))?.tokens?.access_token,
        ).toBe("personal-token");

        expect(store.remove("work", SERVER_URL)).toBe(true);
        expect(yield* awaited(store.forServer("work", SERVER_URL).load())).toBeUndefined();
        expect(store.tokens("personal", SERVER_URL)?.access_token).toBe("personal-token");
      }),
    ));

  it("moves credentials stored by SERVER_URL to the first server that loads them", () =>
    runTest(
      Effect.gen(function* () {
        const backend = new InMemoryAuthStorageBackend();
        backend.withLock(() => ({
          result: undefined,
          next: JSON.stringify({ [SERVER_URL]: state("legacy-token") }),
        }));
        const store = new McpOAuthCredentialStore(backend);

        expect(store.tokens("work", SERVER_URL)?.access_token).toBe("legacy-token");
        expect(storedKeys(backend)).toEqual([SERVER_URL]);

        expect(
          (yield* awaited(store.forServer("my_work", SERVER_URL).load()))?.tokens?.access_token,
        ).toBe("legacy-token");

        expect(store.tokens("my-work", SERVER_URL)?.access_token).toBe("legacy-token");
        expect(yield* awaited(store.forServer("personal", SERVER_URL).load())).toBeUndefined();
        expect(storedKeys(backend)).toEqual([`mcp__my_work|${SERVER_URL}`]);
      }),
    ));

  it("signs out of credentials stored by SERVER_URL", () => {
    const backend = new InMemoryAuthStorageBackend();
    backend.withLock(() => ({
      result: undefined,
      next: JSON.stringify({ [SERVER_URL]: state("legacy-token") }),
    }));
    const store = new McpOAuthCredentialStore(backend);

    expect(store.remove("work", SERVER_URL)).toBe(true);
    expect(storedKeys(backend)).toEqual([]);
    expect(store.remove("work", SERVER_URL)).toBe(false);
  });
});
