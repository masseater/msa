import type grepSupportTypes from "./grep-support.types.ts";

export default class RgMatchCollector {
  readonly matches: grepSupportTypes.RgMatch[] = [];
  matchCount = 0;
  matchLimitReached = false;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  readonly onLine = (line: string): boolean => {
    if (line.trim() === "" || this.matchCount >= this.limit) return false;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return false;
    }
    if (event.type !== "match") return false;
    this.matchCount++;
    const filePath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    if (typeof filePath === "string" && filePath !== "" && typeof lineNumber === "number") {
      this.matches.push({ filePath, lineNumber, lineText: event.data?.lines?.text });
    }
    this.matchLimitReached = this.matchCount >= this.limit;
    return this.matchLimitReached;
  };
}
