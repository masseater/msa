import altScreenSearchModule from "./alt-screen-search.ts";
import type altScreenSearchTypes from "./alt-screen-search.types.ts";

interface SearchSourceSpan {
  textStart: number;
  textEnd: number;
  row: number;
  startCol: number;
  endCol: number;
  linearColumns: boolean;
}

interface SearchCorpus {
  text: string;
  spans: SearchSourceSpan[];
}

export default class AltScreenSearchIndex {
  private sourceLines: string[] | undefined;
  private corpus: SearchCorpus | undefined;
  private normalizedQuery: string | undefined;
  private matches: altScreenSearchTypes.AltScreenSearchMatch[] = [];

  search(lines: readonly string[], query: string): altScreenSearchTypes.AltScreenSearchResult {
    let sourceChanged = this.sourceLines?.length !== lines.length;
    if (!sourceChanged && this.sourceLines !== undefined) {
      for (let index = 0; index < lines.length; index++) {
        if (this.sourceLines[index] === lines[index]) continue;
        sourceChanged = true;
        break;
      }
    }
    if (sourceChanged || this.corpus === undefined) {
      this.sourceLines = Array.from(lines);
      this.corpus = altScreenSearchModule.buildSearchCorpus(lines);
    }

    const normalizedQuery = altScreenSearchModule.normalizeQuery(query);
    const changed = sourceChanged || normalizedQuery !== this.normalizedQuery;
    if (changed) {
      this.normalizedQuery = normalizedQuery;
      this.matches = altScreenSearchModule.findSearchCorpusMatches(this.corpus, normalizedQuery);
    }
    return { changed, matches: this.matches };
  }
}
