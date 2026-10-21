import tokenizeModule from "./tokenize.ts";
import type toolTypes from "./tool.types.ts";

const { tokenize } = tokenizeModule;

export default class Bm25Ranker implements toolTypes.ToolRanker {
  private readonly k1: number;
  private readonly b: number;

  constructor(options: { k1?: number; b?: number } = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  rank(
    query: string,
    documents: readonly toolTypes.ToolSearchDocument[],
    limit: number,
  ): toolTypes.ToolSearchMatch[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0 || documents.length === 0 || limit <= 0) return [];
    const indexed = documents.map((document) => {
      const counts = new Map<string, number>();
      for (const term of tokenize(document.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
      const length = [...counts.values()].reduce((sum, count) => sum + count, 0);
      return { counts, document, length };
    });
    const averageLength =
      indexed.reduce((sum, { length }) => sum + length, 0) / documents.length || 1;
    const idf = new Map(
      queryTerms.map((term) => {
        const frequency = indexed.filter(({ counts }) => counts.has(term)).length;
        return [
          term,
          Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)),
        ] as const;
      }),
    );
    const matches: toolTypes.ToolSearchMatch[] = [];
    for (const { document, counts, length } of indexed) {
      let score = 0;
      for (const term of queryTerms) {
        const count = counts.get(term);
        if (count === undefined || count === 0) continue;
        const norm = this.k1 * (1 - this.b + (this.b * length) / averageLength);
        score += (idf.get(term) ?? 0) * ((count * (this.k1 + 1)) / (count + norm));
      }
      if (score > 0) matches.push({ name: document.name, score });
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
