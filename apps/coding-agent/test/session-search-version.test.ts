import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import indexStore from "../src/core/session-search/index-store.ts";
import sessionSearch from "../src/core/session-search/session-search.ts";
import type sessionSearchTypes from "../src/core/session-search/session-search.types.ts";
import fixture from "./session-search-fixture.ts";

const {
  joinPath,
  makeDirectory,
  pathExists,
  readDirectory,
  readTextFile,
  removeDirs,
  runNodeScript,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;
const { currentIndexPath, header, indexVersionDirectory, makeLocations, user, writeSession } =
  fixture;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const DAY = "2026-10-01T12:00:00.000Z";
const searchModule = new URL("../src/core/session-search/session-search.ts", import.meta.url).href;
const sourceResolver = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const search = (locations: sessionSearchTypes.Locations, query: string) =>
  Effect.promise(() =>
    sessionSearch
      .searchSessions(locations, { filters: {}, limit: 50, order: "oldest", query })
      .then(({ hits }) => ({ ids: hits.map((hit) => hit.entryId) })),
  );

const writeOne = (locations: sessionSearchTypes.Locations, ...texts: string[]) =>
  writeSession(joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl"), [
    header("s", "/w", DAY),
    ...texts.map((text, index) => user(`u${index}`, DAY, text)),
  ]);

const SEARCH_IN_A_NEW_PROCESS = `
const { default: sessionSearch } = await import(process.env.SEARCH_MODULE);
const { hits } = await sessionSearch.searchSessions(JSON.parse(process.env.SEARCH_LOCATIONS), {
  filters: {}, limit: 50, order: "oldest", query: "alpha",
});
console.log(hits.map((hit) => hit.entryId).join(","));
`;

const searchInANewProcess = (locations: sessionSearchTypes.Locations) =>
  Effect.gen(function* () {
    return yield* runNodeScript(SEARCH_IN_A_NEW_PROCESS, {
      env: { SEARCH_LOCATIONS: yield* toJsonText(locations), SEARCH_MODULE: searchModule },
      nodeArgs: ["--import", sourceResolver],
      timeout: "60 seconds",
    });
  });

const rebuildsAnIndexThatRecordsAnotherFormat = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const first = yield* currentIndexPath(locations);
      const other = new DatabaseSync(first);
      other.exec(`PRAGMA user_version = ${indexStore.SCHEMA_VERSION + 1}`);
      other.close();
      const fresh = yield* searchInANewProcess(locations);
      expect(fresh.code, fresh.stderr).toBe(0);
      expect(fresh.stdout.trim()).toBe("u0,u1");
      expect(yield* currentIndexPath(locations)).not.toBe(first);
    }),
  );

const OTHER_VERSIONS = ["v1", "v99"];

const leavesTheIndexOfAnotherVersionAlone = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      const others = OTHER_VERSIONS.map((version) => joinPath(locations.indexDirectory, version));
      for (const directory of others) {
        yield* makeDirectory(directory);
        yield* writeTextFile(joinPath(directory, "current"), "000000000000001-1.db\n");
        yield* writeTextFile(joinPath(directory, "000000000000001-1.db"), "another format\n");
      }
      yield* writeOne(locations, "alpha one", "alpha two");
      expect(yield* search(locations, "alpha")).toEqual({ ids: ["u0", "u1"] });
      const fresh = yield* searchInANewProcess(locations);
      expect(fresh.code, fresh.stderr).toBe(0);
      expect(fresh.stdout.trim()).toBe("u0,u1");
      for (const directory of others) {
        expect(yield* readTextFile(joinPath(directory, "000000000000001-1.db"))).toBe(
          "another format\n",
        );
      }
      expect(yield* pathExists(joinPath(indexVersionDirectory(locations), "current"))).toBe(true);
      expect(yield* readDirectory(locations.indexDirectory)).toEqual(
        [...OTHER_VERSIONS, `v${indexStore.SCHEMA_VERSION}`].toSorted(),
      );
    }),
  );

describe("search_sessions index format versions", () => {
  it(
    "rebuilds an index that records another format version",
    rebuildsAnIndexThatRecordsAnotherFormat,
  );
  it(
    "searches with its own index and leaves the index of another msa version as it is",
    leavesTheIndexOfAnotherVersionAlone,
  );
});
