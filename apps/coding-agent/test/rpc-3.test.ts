import { awaited, failure, pathExists, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { readEnv } from "../src/core/process-env.ts";
import { readSessionEntries, withClient } from "./rpc-support.ts";

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should export to HTML",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Hello"));

            const result = yield* awaited(client.exportHtml());
            expect(result.path).toBeDefined();
            expect(result.path.endsWith(".html")).toBe(true);
            expect(yield* pathExists(result.path)).toBe(true);
          }),
        ),
      ),
    90000,
  );

  test(
    "should get last assistant text",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            let text = yield* awaited(client.getLastAssistantText());
            expect(text).toBeUndefined();

            yield* awaited(client.promptAndWait("Reply with just: test123"));

            text = yield* awaited(client.getLastAssistantText());
            expect(text).toContain("test123");
          }),
        ),
      ),
    90000,
  );

  test(
    "should get session entries with since cursor",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Reply with just 'ok'"));

            const { entries, leafId } = yield* awaited(client.getEntries());
            expect(entries.length).toBeGreaterThanOrEqual(2);
            for (const entry of entries) {
              expect(entry.id).toBeDefined();
            }
            expect(leafId).toBe(entries[entries.length - 1]?.id);

            const [firstEntry] = entries;
            if (firstEntry === undefined) throw new Error("expected session entries");
            const since = yield* awaited(client.getEntries(firstEntry.id));
            expect(since.entries.map((entry) => entry.id)).toEqual(
              entries.slice(1).map((entry) => entry.id),
            );
            expect(since.leafId).toBe(leafId);

            expect(yield* failure(awaited(client.getEntries("nonexistent-id")))).toMatchObject({
              message: "Entry not found",
            });
          }),
        ),
      ),
    90000,
  );

  test(
    "should get session tree",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Reply with just 'ok'"));

            const { entries, leafId } = yield* awaited(client.getEntries());
            const { tree, leafId: treeLeafId } = yield* awaited(client.getTree());
            expect(treeLeafId).toBe(leafId);

            expect(tree.length).toBe(1);
            const chainIds: string[] = [];
            let nodes = tree;
            while (nodes.length === 1) {
              const [node] = nodes;
              if (node === undefined) break;
              chainIds.push(node.entry.id);
              nodes = node.children;
            }
            expect(nodes.length).toBe(0);
            expect(chainIds).toEqual(entries.map((entry) => entry.id));
          }),
        ),
      ),
    90000,
  );

  test(
    "should retain pre-compaction entries in get_entries",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Reply with just 'ok'"));
            const before = yield* awaited(client.getEntries());

            yield* awaited(client.compact());

            const after = yield* awaited(client.getEntries());

            expect(after.entries.slice(0, before.entries.length).map((entry) => entry.id)).toEqual(
              before.entries.map((entry) => entry.id),
            );
            expect(after.entries.some((entry) => entry.type === "compaction")).toBe(true);
          }),
        ),
      ),
    120000,
  );

  test(
    "should set and get session name",
    () =>
      runTest(
        withClient((client, sessionDir) =>
          Effect.gen(function* () {
            let state = yield* awaited(client.getState());
            expect(state.sessionName).toBeUndefined();

            yield* awaited(client.promptAndWait("Reply with just 'ok'"));

            yield* awaited(client.setSessionName("my-test-session"));

            state = yield* awaited(client.getState());
            expect(state.sessionName).toBe("my-test-session");

            yield* Effect.sleep(200);

            const entries = yield* readSessionEntries(sessionDir);

            const sessionInfoEntries = entries.filter(
              (entry: { type: string }) => entry.type === "session_info",
            );
            expect(sessionInfoEntries.length).toBe(1);
            expect(sessionInfoEntries[0].name).toBe("my-test-session");
          }),
        ),
      ),
    60000,
  );
});
