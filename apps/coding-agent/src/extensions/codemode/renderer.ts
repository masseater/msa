import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type { ToolDefinition } from "../../core/extensions/types.ts";
import {
  getTextOutput,
  replaceTabs,
  startToolTimer,
  str,
  toolTimerText,
} from "../../core/tools/render-utils.ts";
import { expandHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { SingleLine, collapsedOutput } from "../../modes/interactive/components/visual-truncate.ts";
import { type Theme, highlightCode } from "../../modes/interactive/theme/theme.ts";
import type { CodemodeNestedCall, CodemodeToolDetails } from "./tool.ts";

const { Container, Spacer, Text } = tui;

const COLLAPSED_ARGS_CHARS = 80;
const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/u;

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function statusIcon(call: CodemodeNestedCall, theme: Theme): string {
  switch (call.status) {
    case "running":
      return theme.fg("warning", "…");
    case "ok":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "cancelled":
      return theme.fg("muted", "⊘");
  }
}

function formatCall(call: CodemodeNestedCall, theme: Theme, expanded: boolean): string {
  const args =
    !expanded && call.args.length > COLLAPSED_ARGS_CHARS
      ? `${call.args.slice(0, COLLAPSED_ARGS_CHARS - 3)}...`
      : call.args;
  const duration = formatDuration(call.durationMs);
  let line = `${statusIcon(call, theme)} ${theme.fg("toolTitle", call.name)}`;
  if (args !== "") line += ` ${theme.fg("muted", args)}`;
  if (duration !== "") line += ` ${theme.fg("dim", duration)}`;
  if (call.cost !== undefined && call.cost !== 0)
    line += ` ${theme.fg("dim", formatCost(call.cost))}`;
  if (expanded && call.error !== undefined && call.error !== "")
    line += `\n    ${theme.fg("error", call.error.split("\n").join("\n    "))}`;
  return line;
}

export const codemodeRenderers: Pick<
  ToolDefinition<any, CodemodeToolDetails | undefined>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    startToolTimer(context);

    const code = str((args as { code?: unknown } | undefined)?.code);
    const title = theme.fg("toolTitle", theme.bold("codemode"));
    const component = (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
    component.clear();
    if (code === null) {
      component.addChild(new Text(`${title} ${theme.fg("error", "[invalid arg]")}`, 0, 0));
      return component;
    }
    const source = code.replace(/\r/gu, "").trimEnd();
    if (!context.expanded) {
      const lines = source === "" ? 0 : source.split("\n").length;
      component.addChild(
        new SingleLine(lines > 0 ? `${title} ${expandHint(`${lines} lines of code`)}` : title),
      );
      return component;
    }
    component.addChild(new Text(title, 0, 0));
    if (source !== "") {
      component.addChild(
        new Text(highlightCode(replaceTabs(source), "javascript").join("\n"), 0, 0),
      );
    }
    return component;
  },
  renderResult(result, options, theme, context) {
    const timerText = toolTimerText(context, options.isPartial);
    const component = (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
    component.clear();
    const calls = result.details?.calls ?? [];
    if (calls.length > 0 && !options.expanded) {
      const earlier = calls.length - 1;
      const more = earlier > 0 ? `  ${theme.fg("muted", `+${earlier} earlier calls`)}` : "";
      component.addChild(new Spacer(1));
      component.addChild(new SingleLine(`${formatCall(calls.at(-1)!, theme, false)}${more}`));
    } else if (calls.length > 0) {
      const lines = calls.map((call) => formatCall(call, theme, true));
      const priced = calls.filter((call) => call.cost);
      if (priced.length > 1) {
        const total = priced.reduce((sum, call) => sum + (call.cost ?? 0), 0);
        lines.push(theme.fg("muted", `Model calls: ${formatCost(total)}`));
      }
      component.addChild(new Spacer(1));
      component.addChild(new Text(lines.join("\n"), 0, 0));
    }

    const [first, ...rest] = result.content;
    const hasHeader = first?.type === "text" && SCRIPT_HEADER.test(first.text);
    const output = options.isPartial
      ? ""
      : getTextOutput(
          { ...result, content: hasHeader ? rest : result.content },
          context.showImages,
        ).trim();
    if (output !== "" && !options.expanded) {
      component.addChild(new Spacer(1));
      component.addChild(collapsedOutput(output, "first", timerText));
      return component;
    }
    if (output !== "") {
      const color = context.isError ? "error" : "toolOutput";
      const styled = replaceTabs(output)
        .split("\n")
        .map((line) => theme.fg(color, line))
        .join("\n");
      component.addChild(new Spacer(1));
      component.addChild(new Text(styled, 0, 0));
    }
    if (timerText !== undefined && timerText !== "") {
      component.addChild(new Spacer(1));
      component.addChild(new Text(theme.fg("muted", timerText), 0, 0));
    }
    return component;
  },
};
