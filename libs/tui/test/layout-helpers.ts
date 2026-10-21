import utils from "../src/utils.ts";

const { stripTerminalSequences } = utils;

function visibleLines(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

export default visibleLines;
