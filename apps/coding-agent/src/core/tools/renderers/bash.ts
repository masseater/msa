import { Container, Spacer, Text } from "@msa/tui";

import {
  collapsedOutput,
  SingleLine,
} from "../../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { BashToolDetails } from "../bash.ts";
import {
  getTextOutput,
  invalidArgText,
  startToolTimer,
  str,
  toolTimerText,
} from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../truncate.ts";

export const BASH_UPDATE_THROTTLE_MS = 100;
function formatShellCall(
  args: { command?: string; timeout?: number } | undefined,
  prompt: string,
  expanded: boolean,
): string {
  const command = str(args?.command);
  const timeout = args?.timeout as number | undefined;
  const timeoutSuffix =
    timeout !== undefined && timeout !== 0 ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
  if (command === null)
    return theme.fg("toolTitle", theme.bold(`${prompt} ${invalidArgText(theme)}`));
  if (command === "")
    return theme.fg("toolTitle", theme.bold(`${prompt} ${theme.fg("toolOutput", "...")}`));
  const lines = command.trimEnd().split("\n");
  const shown = expanded ? lines.join("\n") : lines[0];
  const more =
    !expanded && lines.length > 1 ? theme.fg("muted", ` (+${lines.length - 1} lines)`) : "";
  return theme.fg("toolTitle", theme.bold(`${prompt} ${shown}`)) + more + timeoutSuffix;
}
function rebuildBashResultRenderComponent(
  component: Container,
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: BashToolDetails;
  },
  options: ToolRenderResultOptions,
  showImages: boolean,
  timerText: string | undefined,
): void {
  component.clear();

  let output = getTextOutput(result as any, showImages).trim();
  const truncation = result.details?.truncation;
  const fullOutputPath = result.details?.fullOutputPath;
  if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
    const footerStart = output.lastIndexOf("\n\n[");
    if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
      output = output.slice(0, footerStart).trimEnd();
    }
  }

  if (!options.expanded) {
    component.addChild(new Spacer(1));
    component.addChild(collapsedOutput(output, "last", timerText));
    return;
  }

  if (output !== "") {
    const styledOutput = output
      .split("\n")
      .map((line) => theme.fg("toolOutput", line))
      .join("\n");
    component.addChild(new Text(`\n${styledOutput}`, 0, 0));
  }

  if (truncation?.truncated || fullOutputPath) {
    const warnings: string[] = [];
    if (fullOutputPath !== undefined && fullOutputPath !== "") {
      warnings.push(`Full output: ${fullOutputPath}`);
    }
    if (truncation?.truncated === true) {
      if (truncation.truncatedBy === "lines") {
        warnings.push(
          `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`,
        );
      } else {
        warnings.push(
          `Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
        );
      }
    }
    component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
  }

  if (timerText !== undefined && timerText !== "")
    component.addChild(new Text(`\n${theme.fg("muted", timerText)}`, 0, 0));
}

export function createShellRenderers(
  prompt: string,
): Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> {
  return {
    renderCall(args, _theme, context) {
      startToolTimer(context);
      const call = formatShellCall(
        args as { command?: string; timeout?: number } | undefined,
        prompt,
        context.expanded,
      );
      if (!context.expanded) return new SingleLine(call);
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      text.setText(call);
      return text;
    },
    renderResult(result, options, _theme, context) {
      const timerText = toolTimerText(context, options.isPartial);
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      rebuildBashResultRenderComponent(
        component,
        result as any,
        options,
        context.showImages,
        timerText,
      );
      component.invalidate();
      return component;
    },
  };
}
