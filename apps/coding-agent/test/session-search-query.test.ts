import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const { joinPath, removeDirs, runTest } = testing;
const { assistant, header, makeLocations, toolCall, toolResult, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const LONG_OUTPUT = `${"ok line\n".repeat(40_000)}tail-marker reached`;
const SNIPPET_OUTPUT = `nofail failed ${"x ".repeat(400)}FAIL here ${"y ".repeat(400)}Privacyの設定 there`;

const seedSessions = Effect.fn("seedSessions")(function* (locations: sessionSearchTypes.Locations) {
  const root = locations.roots[0] ?? "";
  const path = yield* writeSession(joinPath(root, "--work-app--", "plain.jsonl"), [
    header("plain", "/work/app", DAY),
    user("u1", DAY, "継承の関係を見直したい"),
    assistant("a1", DAY, [
      { text: "Privacyの設定を既知の限界として残さない。結果はOKだった", type: "text" },
      toolCall("c1", "bash", { command: "git push origin main", timeout: 30 }),
      toolCall("c3", "edit", { edits: [{ newText: "bar baz", oldText: "foo" }], path: "a.ts" }),
    ]),
    toolResult("r1", DAY, "bash", LONG_OUTPUT),
    toolResult("r3", DAY, "read", SNIPPET_OUTPUT),
    assistant("a2", DAY, [toolCall("c2", "search_sessions", { query: "継承" })]),
    toolResult("r2", DAY, "search_sessions", "1. user 継承の関係を見直したい"),
  ]);
  return path;
});

const find = (
  locations: sessionSearchTypes.Locations,
  query: string,
  filters: sessionSearchTypes.Filters = {},
) =>
  Effect.promise(() =>
    sessionSearch.searchSessions(locations, { filters, limit: 50, order: "oldest", query }),
  ).pipe(Effect.map(({ hits }) => hits.map((hit) => `${hit.entryId ?? "?"}:${hit.kind}`)));

const matchesJapaneseWordsInsideLongerRuns = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedSessions(locations);
      expect(yield* find(locations, "継承")).toEqual(["u1:user"]);
      expect(yield* find(locations, "既知の限界")).toEqual(["a1:assistant"]);
      expect(yield* find(locations, "知の限")).toEqual(["a1:assistant"]);
      expect(yield* find(locations, "の")).toEqual(["u1:user", "a1:assistant", "r3:tool_result"]);
      expect(yield* find(locations, "結果はok")).toEqual(["a1:assistant"]);
      expect(yield* find(locations, "限界の既知")).toEqual([]);
    }),
  );

const matchesLatinWordsCaseAndWidth = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedSessions(locations);
      expect(yield* find(locations, "privacy")).toEqual(["a1:assistant", "r3:tool_result"]);
      expect(yield* find(locations, "ＰＲＩＶＡＣＹの設定を")).toEqual(["a1:assistant"]);
      expect(yield* find(locations, "priv")).toEqual([]);
    }),
  );

const needsEveryWordInOneMessage = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedSessions(locations);
      expect(yield* find(locations, "main git")).toEqual(["a1:tool_call"]);
      expect(yield* find(locations, '"git push"')).toEqual(["a1:tool_call"]);
      expect(yield* find(locations, '"push git"')).toEqual([]);
      expect(yield* find(locations, "継承 privacy")).toEqual([]);
    }),
  );

const indexesToolCallArgumentsAndWhole = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedSessions(locations);
      expect(yield* find(locations, "timeout 30")).toEqual(["a1:tool_call"]);
      expect(yield* find(locations, '"edits newText bar"')).toEqual(["a1:tool_call"]);
      expect(yield* find(locations, "tail-marker")).toEqual(["r1:tool_result"]);
      const {
        hits: [hit],
      } = yield* Effect.promise(() =>
        sessionSearch.searchSessions(locations, {
          filters: {},
          limit: 5,
          order: "relevance",
          query: "tail-marker",
        }),
      );
      expect(hit?.snippet).toContain("tail-marker reached");
      expect(hit?.tool).toBe("bash");
    }),
  );

const cutsTheSnippetAroundAWhole = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedSessions(locations);
      const snippetOf = (query: string) =>
        Effect.promise(() =>
          sessionSearch.searchSessions(locations, {
            filters: { tools: ["read"] },
            limit: 5,
            order: "relevance",
            query,
          }),
        ).pipe(Effect.map(({ hits }) => hits[0]?.snippet ?? ""));
      expect(yield* snippetOf("fail")).toContain("FAIL here");
      expect(yield* snippetOf("の設定")).toContain("の設定 there");
    }),
  );

const narrowsToTheKindsAndTools = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* seedSessions(locations);
      expect(yield* find(locations, "git", { kinds: ["tool_call"] })).toEqual(["a1:tool_call"]);
      expect(yield* find(locations, "継承", { kinds: ["assistant"] })).toEqual([]);
      expect(yield* find(locations, "ok", { kinds: ["tool_result"], tools: ["bash"] })).toEqual([
        "r1:tool_result",
      ]);
      expect(yield* find(locations, "git", { tools: ["read"] })).toEqual([]);
    }),
  );

describe("search_sessions query", () => {
  it(
    "matches Japanese words inside longer runs, across の, and in the middle of a run",
    matchesJapaneseWordsInsideLongerRuns,
  );
  it(
    "matches latin words case- and width-insensitively next to Japanese",
    matchesLatinWordsCaseAndWidth,
  );
  it(
    "needs every word in one message part and keeps quoted words in order",
    needsEveryWordInOneMessage,
  );
  it(
    "indexes tool call arguments and whole tool results, but not its own calls",
    indexesToolCallArgumentsAndWhole,
  );
  it("cuts the snippet around a whole matching word", cutsTheSnippetAroundAWhole);
  it("narrows to the kinds and tools asked for", narrowsToTheKindsAndTools);
});
