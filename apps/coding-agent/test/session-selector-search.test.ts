import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import sessionSelectorSearch from "../src/modes/interactive/components/session-selector-search.ts";

const { filterAndSortSessions } = sessionSelectorSearch;

const { dateFromMillis } = testing;

function makeSession(
  overrides: Partial<sessionManagerTypes.SessionInfo> & {
    id: string;
    modified: Date;
    allMessagesText: string;
  },
): sessionManagerTypes.SessionInfo {
  return {
    cwd: overrides.cwd ?? "",
    id: overrides.id,
    path: `/tmp/${overrides.id}.jsonl`,
    ...(overrides.name === undefined ? {} : { name: overrides.name }),
    allMessagesText: overrides.allMessagesText,
    created: overrides.created ?? dateFromMillis(0),
    firstMessage: overrides.firstMessage ?? "(no messages)",
    messageCount: overrides.messageCount ?? 1,
    modified: overrides.modified,
  };
}

const sessions2: sessionManagerTypes.SessionInfo[] = [
  makeSession({
    allMessagesText: "blueberry",
    id: "named1",
    modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
    name: "My Project",
  }),
  makeSession({
    allMessagesText: "blueberry",
    id: "named2",
    modified: dateFromMillis("2026-01-02T00:00:00.000Z"),
    name: "Another Named",
  }),
  makeSession({
    allMessagesText: "blueberry",
    id: "other1",
    modified: dateFromMillis("2026-01-04T00:00:00.000Z"),
  }),
  makeSession({
    allMessagesText: "blueberry",
    id: "other2",
    modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
  }),
];

const filtersByQuotedPhraseWithWhitespaceNormalization = () => {
  const sessions: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "node\n\n   cve was discussed",
      id: "a",
      modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
    }),
    makeSession({
      allMessagesText: "node something else",
      id: "b",
      modified: dateFromMillis("2026-01-02T00:00:00.000Z"),
    }),
  ];

  const result = filterAndSortSessions(sessions, '"node cve"', "recent");
  expect(result.map((s) => s.id)).toEqual(["a"]);
};

const filtersByRegexReAndIsCase = () => {
  const sessions: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "Brave is great",
      id: "a",
      modified: dateFromMillis("2026-01-02T00:00:00.000Z"),
    }),
    makeSession({
      allMessagesText: "bravery is not the same",
      id: "b",
      modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
    }),
  ];

  const result = filterAndSortSessions(sessions, "re:\\bbrave\\b", "recent");
  expect(result.map((s) => s.id)).toEqual(["a"]);
};

const recentSortPreservesInputOrder = () => {
  const sessions: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "brave",
      id: "newer",
      modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
    }),
    makeSession({
      allMessagesText: "brave",
      id: "older",
      modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
    }),
    makeSession({
      allMessagesText: "something else",
      id: "nomatch",
      modified: dateFromMillis("2026-01-04T00:00:00.000Z"),
    }),
  ];

  const result = filterAndSortSessions(sessions, '"brave"', "recent");
  expect(result.map((s) => s.id)).toEqual(["newer", "older"]);
};

const relevanceSortOrdersByScoreAndTie = () => {
  const sessions: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "xxxx brave",
      id: "late",
      modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
    }),
    makeSession({
      allMessagesText: "brave xxxx",
      id: "early",
      modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
    }),
  ];

  const result1 = filterAndSortSessions(sessions, '"brave"', "relevance");
  expect(result1.map((s) => s.id)).toEqual(["early", "late"]);

  const tieSessions: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "brave",
      id: "newer",
      modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
    }),
    makeSession({
      allMessagesText: "brave",
      id: "older",
      modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
    }),
  ];

  const result2 = filterAndSortSessions(tieSessions, '"brave"', "relevance");
  expect(result2.map((s) => s.id)).toEqual(["newer", "older"]);
};

const returnsEmptyListForInvalidRegex = () => {
  const sessions: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "brave",
      id: "a",
      modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
    }),
  ];

  const result = filterAndSortSessions(sessions, "re:(", "recent");
  expect(result).toEqual([]);
};

const returnsAllSessionsWhenNamefilterIsAll = () => {
  const result = filterAndSortSessions(sessions2, "", "recent", "all");
  expect(result.map((session) => session.id)).toEqual(["named1", "named2", "other1", "other2"]);
};

const returnsOnlyNamedSessionsWhenNamefilterIs = () => {
  const result = filterAndSortSessions(sessions2, "", "recent", "named");
  expect(result.map((session) => session.id)).toEqual(["named1", "named2"]);
};

const appliesNameFilterBeforeSearchQuery = () => {
  const result = filterAndSortSessions(sessions2, "blueberry", "recent", "named");
  expect(result.map((session) => session.id)).toEqual(["named1", "named2"]);
};

const excludesWhitespaceOnlyNamesFromNamedFilter = () => {
  const sessionsWithWhitespace: sessionManagerTypes.SessionInfo[] = [
    makeSession({
      allMessagesText: "test",
      id: "whitespace",
      modified: dateFromMillis("2026-01-01T00:00:00.000Z"),
      name: "   ",
    }),
    makeSession({
      allMessagesText: "test",
      id: "empty",
      modified: dateFromMillis("2026-01-02T00:00:00.000Z"),
      name: "",
    }),
    makeSession({
      allMessagesText: "test",
      id: "named",
      modified: dateFromMillis("2026-01-03T00:00:00.000Z"),
      name: "Real Name",
    }),
  ];

  const result = filterAndSortSessions(sessionsWithWhitespace, "", "recent", "named");
  expect(result.map((session) => session.id)).toEqual(["named"]);
};

describe("session selector search", () => {
  it(
    "filters by quoted phrase with whitespace normalization",
    filtersByQuotedPhraseWithWhitespaceNormalization,
  );

  it("filters by regex (re:) and is case-insensitive", filtersByRegexReAndIsCase);

  it("recent sort preserves input order", recentSortPreservesInputOrder);

  it(
    "relevance sort orders by score and tie-breaks by modified desc",
    relevanceSortOrdersByScoreAndTie,
  );

  it("returns empty list for invalid regex", returnsEmptyListForInvalidRegex);

  describe("name filter", () => {
    it("returns all sessions when nameFilter is 'all'", returnsAllSessionsWhenNamefilterIsAll);

    it(
      "returns only named sessions when nameFilter is 'named'",
      returnsOnlyNamedSessionsWhenNamefilterIs,
    );

    it("applies name filter before search query", appliesNameFilterBeforeSearchQuery);

    it(
      "excludes whitespace-only names from named filter",
      excludesWhitespaceOnlyNamesFromNamedFilter,
    );
  });
});
