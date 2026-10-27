import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const { joinPath, makeDirectory, removeDirs, runTest, writeTextFile } = testing;
const { header, makeLocations, user, writeSession } = fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";

const search = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch
      .searchSessions(locations, { filters: {}, limit: 50, order: "oldest", query })
      .then(
        (hits) => ({ ids: hits.map((hit) => hit.entryId) }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      ),
  );

const writeOne = (locations: sessionSearchTypes.Locations, ...texts: string[]) =>
  writeSession(joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl"), [
    header("s", "/w", DAY),
    ...texts.map((text, index) => user(`u${index}`, DAY, text)),
  ]);

const rebuildsAfterAFailedUpdate = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two", "alpha three");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1", "u2"] });
      const other = new DatabaseSync(locations.indexPath);
      other.exec("DROP TABLE parts_fts");
      other.close();
      yield* writeOne(locations, "alpha one");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0"] });
      yield* writeOne(locations, "alpha one", "beta two");
      expect(yield* search(locations, "beta")).toEqual({ ids: ["u1"] });
    }),
  );

const replacesAnIndexThatIsNotADatabase = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "gamma");
      yield* writeTextFile(locations.indexPath, "not a database\n".repeat(400));
      expect(yield* search(locations, "gamma")).toEqual({ ids: ["u0"] });
    }),
  );

const namesTheIndexItCannotOpen = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "delta");
      yield* makeDirectory(locations.indexPath);
      const result = yield* search(locations, "delta");
      expect(result).toEqual({ error: expect.stringContaining(locations.indexPath) });
    }),
  );

describe("search_sessions index recovery", () => {
  it("rebuilds the index from the sessions when an update fails", rebuildsAfterAFailedUpdate);
  it("replaces an index file that is not a database", replacesAnIndexThatIsNotADatabase);
  it(
    "names the index in the error when it can neither open nor replace it",
    namesTheIndexItCannotOpen,
  );
});
