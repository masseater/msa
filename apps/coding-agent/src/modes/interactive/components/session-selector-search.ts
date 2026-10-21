import tui from "@msa/tui";
import { dual } from "effect/Function";

import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import errors from "../../../utils/errors.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

const { toErrorMessage } = errors;

const { fuzzyMatch } = tui;

function normalizeWhitespaceLower(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, " ").trim();
}

function getSessionSearchText(session: sessionManagerTypes.SessionInfo): string {
  return `${session.id} ${session.name ?? ""} ${session.allMessagesText} ${session.cwd}`;
}

function hasSessionName(session: sessionManagerTypes.SessionInfo): boolean {
  return Boolean(session.name?.trim());
}

function matchesNameFilter(
  session: sessionManagerTypes.SessionInfo,
  filter: sessionSelectorSearchTypes.NameFilter,
): boolean {
  if (filter === "all") return true;
  return hasSessionName(session);
}

function parseSearchQuery(query: string): sessionSelectorSearchTypes.ParsedSearchQuery {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { mode: "tokens", regex: null, tokens: [] };
  }

  if (trimmed.startsWith("re:")) {
    const pattern = trimmed.slice(3).trim();
    if (pattern === "") {
      return { error: "Empty regex", mode: "regex", regex: null, tokens: [] };
    }
    try {
      return { mode: "regex", regex: new RegExp(pattern, "iu"), tokens: [] };
    } catch (err) {
      const msg = toErrorMessage(err);
      return { error: msg, mode: "regex", regex: null, tokens: [] };
    }
  }

  const tokens: { kind: "fuzzy" | "phrase"; value: string }[] = [];
  let { inQuote, hadUnclosedQuote, flush } = tokenizeQuery(tokens, trimmed);

  if (inQuote) {
    hadUnclosedQuote = true;
  }

  if (hadUnclosedQuote) {
    return {
      mode: "tokens",
      regex: null,
      tokens: trimmed
        .split(/\s+/u)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((t) => ({ kind: "fuzzy" as const, value: t })),
    };
  }

  flush(inQuote ? "phrase" : "fuzzy");

  return { mode: "tokens", regex: null, tokens };
}

const matchSession: {
  (
    parsed: sessionSelectorSearchTypes.ParsedSearchQuery,
  ): (session: sessionManagerTypes.SessionInfo) => sessionSelectorSearchTypes.MatchResult;
  (
    session: sessionManagerTypes.SessionInfo,
    parsed: sessionSelectorSearchTypes.ParsedSearchQuery,
  ): sessionSelectorSearchTypes.MatchResult;
} = dual(
  2,
  (
    session: sessionManagerTypes.SessionInfo,
    parsed: sessionSelectorSearchTypes.ParsedSearchQuery,
  ): sessionSelectorSearchTypes.MatchResult => {
    const text = getSessionSearchText(session);

    if (parsed.mode === "regex") {
      if (parsed.regex === null) {
        return { matches: false, score: 0 };
      }
      const idx = text.search(parsed.regex);
      if (idx < 0) return { matches: false, score: 0 };
      return { matches: true, score: idx * 0.1 };
    }

    if (parsed.tokens.length === 0) {
      return { matches: true, score: 0 };
    }

    let totalScore = 0;
    let normalizedText: string | null = null;

    for (const token of parsed.tokens) {
      if (token.kind === "phrase") {
        if (normalizedText === null) {
          normalizedText = normalizeWhitespaceLower(text);
        }
        const phrase = normalizeWhitespaceLower(token.value);
        if (phrase === "") continue;
        const idx = normalizedText.indexOf(phrase);
        if (idx < 0) return { matches: false, score: 0 };
        totalScore += idx * 0.1;
        continue;
      }

      const m = fuzzyMatch(token.value, text);
      if (!m.matches) return { matches: false, score: 0 };
      totalScore += m.score;
    }

    return { matches: true, score: totalScore };
  },
);

const filterAndSortSessions: {
  (
    query: string,
    sortMode: sessionSelectorSearchTypes.SortMode,
    nameFilter?: sessionSelectorSearchTypes.NameFilter,
  ): (sessions: sessionManagerTypes.SessionInfo[]) => sessionManagerTypes.SessionInfo[];
  (
    sessions: sessionManagerTypes.SessionInfo[],
    query: string,
    sortMode: sessionSelectorSearchTypes.SortMode,
    nameFilter?: sessionSelectorSearchTypes.NameFilter,
  ): sessionManagerTypes.SessionInfo[];
} = dual(
  (args) => Array.isArray(args[0]),
  (
    sessions: sessionManagerTypes.SessionInfo[],
    query: string,
    sortMode: sessionSelectorSearchTypes.SortMode,
    nameFilter: sessionSelectorSearchTypes.NameFilter = "all",
  ): sessionManagerTypes.SessionInfo[] => {
    const nameFiltered =
      nameFilter === "all"
        ? sessions
        : sessions.filter((session) => matchesNameFilter(session, nameFilter));
    const trimmed = query.trim();
    if (trimmed === "") return nameFiltered;

    const parsed = parseSearchQuery(query);
    if (parsed.error !== undefined && parsed.error !== "") return [];

    if (sortMode === "recent") {
      const filtered: sessionManagerTypes.SessionInfo[] = [];
      for (const s of nameFiltered) {
        const res = matchSession(s, parsed);
        if (res.matches) filtered.push(s);
      }
      return filtered;
    }

    const scored: { session: sessionManagerTypes.SessionInfo; score: number }[] = [];
    for (const s of nameFiltered) {
      const res = matchSession(s, parsed);
      if (!res.matches) continue;
      scored.push({ score: res.score, session: s });
    }

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return b.session.modified.getTime() - a.session.modified.getTime();
    });

    return scored.map((r) => r.session);
  },
);

const sessionSelectorSearch = {
  filterAndSortSessions,
  hasSessionName,
  matchSession,
  parseSearchQuery,
};

export default sessionSelectorSearch;

function tokenizeQuery(tokens: { kind: "fuzzy" | "phrase"; value: string }[], trimmed: string) {
  let buf = "";
  let inQuote = false;
  let hadUnclosedQuote = false;

  const flush = (kind: "fuzzy" | "phrase"): void => {
    const v = buf.trim();
    buf = "";
    if (v === "") return;
    tokens.push({ kind, value: v });
  };

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === '"') {
      if (inQuote) {
        flush("phrase");
        inQuote = false;
      } else {
        flush("fuzzy");
        inQuote = true;
      }
      continue;
    }

    if (!inQuote && /\s/u.test(ch)) {
      flush("fuzzy");
      continue;
    }

    buf += ch;
  }
  return { flush, hadUnclosedQuote, inQuote };
}
