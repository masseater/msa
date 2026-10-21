import { dual } from "effect/Function";

import type fuzzyTypes from "./fuzzy.types.ts";

const fuzzyMatch: {
  (query: string, text: string): fuzzyTypes.FuzzyMatch;
  (text: string): (query: string) => fuzzyTypes.FuzzyMatch;
} = dual(2, (query: string, text: string): fuzzyTypes.FuzzyMatch => {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  const primaryMatch = matchQuery(queryLower, textLower);
  if (primaryMatch.matches) {
    return primaryMatch;
  }

  const swappedQuery = swapAlphaNumericQuery(queryLower);
  if (swappedQuery === "") {
    return primaryMatch;
  }

  const swappedMatch = matchQuery(swappedQuery, textLower);
  if (!swappedMatch.matches) {
    return primaryMatch;
  }

  return { matches: true, score: swappedMatch.score + 5 };
});

const WORD_BOUNDARY = /[\s\-_./:]/u;

function matchQuery(normalizedQuery: string, textLower: string): fuzzyTypes.FuzzyMatch {
  if (normalizedQuery.length === 0) {
    return { matches: true, score: 0 };
  }

  if (normalizedQuery.length > textLower.length) {
    return { matches: false, score: 0 };
  }

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  let consecutiveMatches = 0;

  while (queryIndex < normalizedQuery.length) {
    const i = textLower.indexOf(normalizedQuery[queryIndex]!, lastMatchIndex + 1);
    if (i === -1) break;

    if (lastMatchIndex === i - 1) {
      consecutiveMatches++;
      score -= consecutiveMatches * 5;
    } else {
      consecutiveMatches = 0;
      if (lastMatchIndex >= 0) {
        score += (i - lastMatchIndex - 1) * 2;
      }
    }

    if (i === 0 || WORD_BOUNDARY.test(textLower[i - 1]!)) {
      score -= 10;
    }

    score += i * 0.1;

    lastMatchIndex = i;
    queryIndex++;
  }

  if (queryIndex < normalizedQuery.length) {
    return { matches: false, score: 0 };
  }

  if (normalizedQuery === textLower) {
    score -= 100;
  }

  return { matches: true, score };
}

const ALPHA_NUMERIC_QUERY = /^(?<letters>[a-z]+)(?<digits>[0-9]+)$/u;
const NUMERIC_ALPHA_QUERY = /^(?<digits>[0-9]+)(?<letters>[a-z]+)$/u;

function swapAlphaNumericQuery(queryLower: string): string {
  const groups =
    (ALPHA_NUMERIC_QUERY.exec(queryLower) ?? NUMERIC_ALPHA_QUERY.exec(queryLower))?.groups ??
    undefined;
  if (groups === undefined) return "";
  const letters = groups["letters"] ?? "";
  const digits = groups["digits"] ?? "";
  return ALPHA_NUMERIC_QUERY.test(queryLower) ? `${digits}${letters}` : `${letters}${digits}`;
}

const fuzzyFilter: {
  <T>(items: T[], query: string, getText: (item: T) => string): T[];
  <T>(query: string, getText: (item: T) => string): (items: T[]) => T[];
} = dual(3, <T>(items: T[], query: string, getText: (item: T) => string): T[] => {
  if (query.trim() === "") {
    return items;
  }

  const tokens = query
    .trim()
    .split(/[\s/]+/u)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return items;
  }

  const results: { item: T; totalScore: number }[] = [];

  for (const item of items) {
    const text = getText(item);
    let totalScore = 0;
    let allMatch = true;

    for (const token of tokens) {
      const match = fuzzyMatch(token, text);
      if (match.matches) {
        totalScore += match.score;
      } else {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      results.push({ item, totalScore });
    }
  }

  results.sort((a, b) => a.totalScore - b.totalScore);
  return results.map((r) => r.item);
});

const fuzzy = {
  fuzzyFilter,
  fuzzyMatch,
};

export default fuzzy;
