declare namespace sessionSelectorSearchTypes {
  type SortMode = "threaded" | "recent" | "relevance";

  type NameFilter = "all" | "named";

  interface ParsedSearchQuery {
    mode: "tokens" | "regex";
    tokens: { kind: "fuzzy" | "phrase"; value: string }[];
    regex: RegExp | null;
    error?: string;
  }

  interface MatchResult {
    matches: boolean;
    score: number;
  }
}

export type { sessionSelectorSearchTypes as default };
