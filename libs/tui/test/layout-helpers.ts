import { stripTerminalSequences } from "../src/utils.ts";

export function visibleLines(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd());
}
