import type { CompletionRequest, CompletionResult } from "./autocomplete-types.ts";

function replaceLine(lines: string[], index: number, line: string): string[] {
  const newLines = [...lines];
  newLines[index] = line;
  return newLines;
}

export function applyAutocompleteCompletion(request: CompletionRequest): CompletionResult {
  const { lines, cursorLine, cursorCol, item, prefix } = request;
  const currentLine = lines[cursorLine] ?? "";
  const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
  const afterCursor = currentLine.slice(cursorCol);
  const isQuotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"');
  const hasTrailingQuoteInItem = item.value.endsWith('"');
  const adjustedAfterCursor =
    isQuotedPrefix && hasTrailingQuoteInItem && afterCursor.startsWith('"')
      ? afterCursor.slice(1)
      : afterCursor;

  const isSlashCommand =
    prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/");
  if (isSlashCommand) {
    return {
      lines: replaceLine(lines, cursorLine, `${beforePrefix}/${item.value} ${adjustedAfterCursor}`),
      cursorLine,
      cursorCol: beforePrefix.length + item.value.length + 2,
    };
  }

  const isDirectory = item.label.endsWith("/");
  const cursorOffset =
    isDirectory && hasTrailingQuoteInItem ? item.value.length - 1 : item.value.length;
  const suffix = prefix.startsWith("@") && !isDirectory ? " " : "";
  return {
    lines: replaceLine(
      lines,
      cursorLine,
      `${beforePrefix + item.value}${suffix}${adjustedAfterCursor}`,
    ),
    cursorLine,
    cursorCol: beforePrefix.length + cursorOffset + suffix.length,
  };
}
