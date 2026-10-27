import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import sessionSearch from "../src/core/session-search/session-search.ts";
import SessionSearchView from "../src/modes/interactive/components/session-search-view.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import fixture from "./session-search-fixture.ts";

const { joinPath, pollUntil, removeDirs, runTest } = testing;
const { header, makeLocations, toolResult, user, writeSession } = fixture;
const { setKeybindings } = tuiModule;
const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const ENTER = "\r";
const ESCAPE = "\x1b";
const DAY = "2026-10-01T12:00:00.000Z";

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

type Locations = Effect.Success<ReturnType<typeof makeLocations>>;

const openView = (locations: Locations, closed: string[]) =>
  new SessionSearchView({
    initialQuery: "継承",
    maxHeight: () => 5000,
    onClose: () => closed.push("closed"),
    read: (request) => sessionSearch.readSession(locations, { ...request, after: 5, before: 0 }),
    requestRender: () => undefined,
    search: (query) =>
      sessionSearch.searchSessions(locations, { filters: {}, limit: 10, order: "oldest", query }),
  });

const shown = (view: SessionSearchView): string => stripAnsi(view.render(100).join("\n"));

const waitFor = (view: SessionSearchView, text: string) =>
  pollUntil(
    Effect.sync(() => !view.busy && shown(view).includes(text)),
    200,
    "20 millis",
  );

const searchesReadsAndPagesThroughA = () =>
  runTest(
    Effect.gen(function* () {
      const locations = yield* makeLocations(directories);
      yield* writeSession(joinPath(locations.roots[0] ?? "", "--w--", "s.jsonl"), [
        header("s", "/w", DAY),
        user("ask", DAY, "継承をやめて委譲にする"),
        toolResult("out", DAY, "bash", `${"x".repeat(60_000)} end-of-output`),
      ]);
      const closed: string[] = [];
      const view = openView(locations, closed);
      yield* waitFor(view, "継承をやめて委譲にする");
      expect(shown(view)).toContain("user [session]");
      view.handleInput(ENTER);
      yield* waitFor(view, "/w");
      expect(shown(view)).toContain("--- user");
      view.handleInput("n");
      yield* waitFor(view, "end-of-output");
      view.handleInput(ESCAPE);
      expect(shown(view)).toContain("継承をやめて委譲にする");
      view.handleInput(ESCAPE);
      expect(closed).toEqual(["closed"]);
    }),
  );

describe("session search view", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  it(
    "searches, reads from the chosen hit, pages on, goes back, and closes",
    searchesReadsAndPagesThroughA,
  );
});
