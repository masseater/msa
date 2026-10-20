import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import SingleLine from "../../../modes/interactive/components/single-line.ts";
import visualTruncate from "../../../modes/interactive/components/visual-truncate.ts";
import themeModule from "../../../modes/interactive/theme/theme.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type bashTypesModule from "../bash.types.ts";
import renderUtils from "../render-utils.ts";
import truncate from "../truncate.ts";

const { getTextOutput, invalidArgText, startToolTimer, str, toolTimerText } = renderUtils;
const { theme } = themeModule;
const { DEFAULT_MAX_BYTES, formatSize } = truncate;
const { collapsedOutput } = visualTruncate;

const { Container, Spacer, Text } = tui;

const BASH_UPDATE_THROTTLE_MS = 100;
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
type BashResultDetails = bashTypesModule.BashToolDetails | undefined;

function stripFullOutputFooter(output: string, details: BashResultDetails, isPartial: boolean) {
  const fullOutputPath = details?.fullOutputPath;
  if (
    isPartial ||
    details?.truncation?.truncated !== true ||
    fullOutputPath === undefined ||
    fullOutputPath === "" ||
    !output.endsWith("]")
  ) {
    return output;
  }
  const footerStart = output.lastIndexOf("\n\n[");
  return footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)
    ? output.slice(0, footerStart).trimEnd()
    : output;
}

function truncationWarnings(details: BashResultDetails): string[] {
  const warnings: string[] = [];
  const fullOutputPath = details?.fullOutputPath;
  const truncation = details?.truncation;
  if (fullOutputPath !== undefined && fullOutputPath !== "") {
    warnings.push(`Full output: ${fullOutputPath}`);
  }
  if (truncation?.truncated === true) {
    warnings.push(
      truncation.truncatedBy === "lines"
        ? `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`
        : `Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
    );
  }
  return warnings;
}

function rebuildBashResultRenderComponent(
  component: tuiTypes.Container,
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: bashTypesModule.BashToolDetails;
  },
  options: extensionsTypesTypes.ToolRenderResultOptions,
  showImages: boolean,
  timerText: string | undefined,
): void {
  component.clear();
  const output = stripFullOutputFooter(
    getTextOutput(result as any, showImages).trim(),
    result.details,
    options.isPartial,
  );

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

  const warnings = truncationWarnings(result.details);
  if (warnings.length > 0) {
    component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
  }

  if (timerText !== undefined && timerText !== "")
    component.addChild(new Text(`\n${theme.fg("muted", timerText)}`, 0, 0));
}

function createShellRenderers(
  prompt: string,
): Pick<extensionsTypesTypes.ToolDefinition<any, any>, "renderCall" | "renderResult"> {
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
      const component =
        (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
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

const bash = {
  BASH_UPDATE_THROTTLE_MS,
  createShellRenderers,
};

export default bash;
