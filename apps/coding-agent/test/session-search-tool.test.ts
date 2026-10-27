import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionRootsModule from "../src/core/session-search/session-roots.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import searchSessionsTool from "../src/core/tools/search-sessions.ts";
import fixture from "./session-search-fixture.ts";

const { appendTextFile, joinPath, pathExists, removeDirs, runTest } = testing;
const { deeplyNestedCall, header, makeLocations, user, writeSession } = fixture;
const { sessionRoots } = sessionRootsModule;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const refusal = (locations: sessionSearchTypes.Locations, input: Record<string, unknown>) =>
  Effect.promise(() =>
    searchSessionsTool
      .createSearchSessionsToolDefinition(locations)
      .execute("call", input as never, undefined, undefined, undefined as never)
      .then(
        () => "accepted",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
  );

const refusesASearchWithoutWordsA = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      expect(yield* refusal(locations, { query: "  " })).not.toBe("accepted");
      expect(yield* refusal(locations, { action: "read", session: "/s.jsonl" })).not.toBe(
        "accepted",
      );
      expect(yield* pathExists(locations.indexDirectory)).toBe(false);
      expect(yield* refusal(locations, { query: "x", since: "last week" })).toContain("last week");
      expect(yield* refusal(locations, { query: "x", since: "2026-10-01" })).toBe("accepted");
    }),
  );

const DAY = "2026-10-01T12:00:00.000Z";

const output = (locations: sessionSearchTypes.Locations, input: Record<string, unknown>) =>
  Effect.promise(() =>
    searchSessionsTool
      .createSearchSessionsToolDefinition(locations)
      .execute("call", input as never, undefined, undefined, undefined as never)
      .then((result) => result.content.map((part) => ("text" in part ? part.text : "")).join("")),
  );

const namesTheSessionsItCouldNotIndex = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const directory = joinPath(locations.roots[0] ?? "", "--w--");
      yield* writeSession(joinPath(directory, "s.jsonl"), [
        header("s", "/w", DAY),
        user("u0", DAY, "alpha"),
      ]);
      const deep = yield* writeSession(joinPath(directory, "deep.jsonl"), [header("d", "/w", DAY)]);
      yield* appendTextFile(deep, deeplyNestedCall("d1"));
      const text = yield* output(locations, { query: "alpha" });
      expect(text).toContain("alpha");
      expect(text).toContain("Not searched: 1 session file could not be indexed");
      expect(text).toContain(`- ${deep}: RangeError`);
      expect(yield* output(locations, { query: "nothing-like-this" })).toContain(
        `No matching messages.\n\nNot searched: 1 session file could not be indexed\n- ${deep}:`,
      );
    }),
  );

const walksTheAgentSSessionsAnd = () => {
  expect(
    sessionRoots(["/agent/sessions", undefined, "/agent/sessions/--w--", "/elsewhere", ""]),
  ).toEqual(["/agent/sessions", "/elsewhere"]);
  expect(sessionRoots(["/agent/sessions", "/agent/sessions"])).toEqual(["/agent/sessions"]);
};

describe("search_sessions tool", () => {
  it(
    "refuses a search without words, a read without its entry, and a date it cannot read",
    refusesASearchWithoutWordsA,
  );
  it(
    "names the session files it could not index, with the reason, under the results",
    namesTheSessionsItCouldNotIndex,
  );
  it(
    "walks the agent's sessions and a separate session directory once each",
    walksTheAgentSSessionsAnd,
  );
});
