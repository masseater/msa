import tui from "@msa/tui";
import { dual } from "effect/Function";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import SingleLine from "./single-line.ts";
import type visualTruncateTypes from "./visual-truncate.types.ts";

const { expandHint } = keybindingHints;
const { theme } = themeModule;
const { Text } = tui;

const truncateToVisualLines: {
  (
    maxVisualLines: number,
    width: number,
    paddingX?: number,
    keep?: "start" | "end",
  ): (text: string) => visualTruncateTypes.VisualTruncateResult;
  (
    text: string,
    maxVisualLines: number,
    width: number,
    paddingX?: number,
    keep?: "start" | "end",
  ): visualTruncateTypes.VisualTruncateResult;
} = dual(
  (args) => typeof args[0] === "string",
  (
    text: string,
    maxVisualLines: number,
    width: number,
    paddingX: number = 0,
    keep: "start" | "end" = "end",
  ): visualTruncateTypes.VisualTruncateResult => {
    if (text === "") {
      return { skippedCount: 0, visualLines: [] };
    }

    const tempText = new Text(text, paddingX, 0);
    const allVisualLines = tempText.render(width);

    if (allVisualLines.length <= maxVisualLines) {
      return { skippedCount: 0, visualLines: allVisualLines };
    }

    const truncatedLines =
      keep === "start"
        ? allVisualLines.slice(0, maxVisualLines)
        : allVisualLines.slice(-maxVisualLines);
    const skippedCount = allVisualLines.length - maxVisualLines;

    return { skippedCount, visualLines: truncatedLines };
  },
);
const collapsedOutput: {
  (pick: "first" | "last", extra?: string): (output: string) => SingleLine;
  (output: string, pick: "first" | "last", extra?: string): SingleLine;
} = dual(
  (args) => args.length > 1 && (args[1] === "first" || args[1] === "last"),
  (output: string, pick: "first" | "last", extra?: string): SingleLine => {
    const lines = output === "" ? [] : output.split("\n");
    const summary = [`${lines.length} ${lines.length === 1 ? "line" : "lines"}`, extra]
      .filter(Boolean)
      .join(", ");
    const shown =
      (pick === "last"
        ? lines.findLast((line) => line.trim())
        : lines.find((line) => line.trim())) ?? "";
    return new SingleLine(
      `${expandHint(summary)}${shown === "" ? "" : `  ${theme.fg("toolOutput", shown.trim())}`}`,
    );
  },
);

const visualTruncate = {
  collapsedOutput,
  truncateToVisualLines,
};

export default visualTruncate;
