import type altScreenSearch from "./alt-screen-search.ts";

declare namespace altScreenSearchTypes {
  interface AltScreenSearchSegment {
    row: number;
    startCol: number;
    endCol: number;
  }

  interface AltScreenSearchMatch {
    segments: AltScreenSearchSegment[];
  }

  interface AltScreenSearchResult {
    matches: AltScreenSearchMatch[];
    changed: boolean;
  }

  type AltScreenSearchIndex = (typeof altScreenSearch.AltScreenSearchIndex)["prototype"];
}

export type { altScreenSearchTypes as default };
