import { stripTerminalSequences } from "../src/utils.ts";

function visibleLines(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

export default visibleLines;
