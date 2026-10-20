declare namespace fuzzyTypes {
  interface FuzzyMatch {
    matches: boolean;
    score: number;
  }
}

export type { fuzzyTypes as default };
