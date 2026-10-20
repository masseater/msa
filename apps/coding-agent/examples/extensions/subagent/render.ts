import type { Theme } from "@msa/coding-agent";
import { getMarkdownTheme } from "@msa/coding-agent";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type { AgentScope } from "./agents.ts";
import {
  formatToolCall,
  formatUsageStats,
  getDisplayItems,
  getFinalOutput,
  isFailedResult,
} from "./format.ts";
import { renderChain, renderParallel } from "./render-modes.ts";
import {
  COLLAPSED_ITEM_COUNT,
  type DisplayItem,
  type SingleResult,
  type SubagentDetails,
} from "./types.ts";

const { Container, Markdown, Spacer, Text } = tui;

interface RenderCallArgs {
  agent?: string | undefined;
  task?: string | undefined;
  tasks?: { agent: string; task: string }[] | undefined;
  chain?: { agent: string; task: string }[] | undefined;
  agentScope?: AgentScope | undefined;
}

const preview = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}...` : text;

const renderChainCall = (
  chain: { agent: string; task: string }[],
  scope: AgentScope,
  theme: Theme,
): tuiTypes.Text => {
  let text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", `chain (${chain.length} steps)`) +
    theme.fg("muted", ` [${scope}]`);

  for (const [i, step] of chain.slice(0, 3).entries()) {
    const cleanTask = step.task.replace(/\{previous\}/gu, "").trim();
    text +=
      "\n  " +
      theme.fg("muted", `${i + 1}.`) +
      " " +
      theme.fg("accent", step.agent) +
      theme.fg("dim", ` ${preview(cleanTask, 40)}`);
  }
  if (chain.length > 3) text += `\n  ${theme.fg("muted", `... +${chain.length - 3} more`)}`;
  return new Text(text, 0, 0);
};

const renderParallelCall = (
  tasks: { agent: string; task: string }[],
  scope: AgentScope,
  theme: Theme,
): tuiTypes.Text => {
  let text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", `parallel (${tasks.length} tasks)`) +
    theme.fg("muted", ` [${scope}]`);

  for (const task of tasks.slice(0, 3)) {
    text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview(task.task, 40)}`)}`;
  }
  if (tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${tasks.length - 3} more`)}`;
  return new Text(text, 0, 0);
};

const renderSingleCall = (args: RenderCallArgs, scope: AgentScope, theme: Theme): tuiTypes.Text => {
  const agentName = args.agent || "...";
  const taskPreview =
    args.task !== undefined && args.task.length > 0 ? preview(args.task, 60) : "...";
  const text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", agentName) +
    theme.fg("muted", ` [${scope}]`) +
    `\n  ${theme.fg("dim", taskPreview)}`;
  return new Text(text, 0, 0);
};

export const renderCall = (request: {
  readonly args: RenderCallArgs;
  readonly theme: Theme;
}): tuiTypes.Text => {
  const { args, theme } = request;
  const scope: AgentScope = args.agentScope ?? "user";
  if (args.chain !== undefined && args.chain.length > 0) {
    return renderChainCall(args.chain, scope, theme);
  }
  if (args.tasks !== undefined && args.tasks.length > 0) {
    return renderParallelCall(args.tasks, scope, theme);
  }
  return renderSingleCall(args, scope, theme);
};

export const renderDisplayItems = (request: {
  readonly items: DisplayItem[];
  readonly expanded: boolean;
  readonly theme: Theme;
  readonly limit?: number | undefined;
}): string => {
  const { items, expanded, theme, limit } = request;
  const toShow = limit === undefined ? items : items.slice(-limit);
  const skipped = limit === undefined || items.length <= limit ? 0 : items.length - limit;
  let text = "";
  if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);

  for (const item of toShow) {
    if (item.type === "text") {
      const previewText = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
      text += `${theme.fg("toolOutput", previewText)}\n`;
    } else {
      const call = formatToolCall({
        args: item.args,
        themeFg: (color, value) => theme.fg(color, value),
        toolName: item.name,
      });
      text += `${theme.fg("muted", "→ ") + call}\n`;
    }
  }
  return text.trimEnd();
};

export const addToolCalls = (request: {
  readonly container: tuiTypes.Container;
  readonly items: DisplayItem[];
  readonly theme: Theme;
}): void => {
  const { container, items, theme } = request;
  for (const item of items) {
    if (item.type !== "toolCall") continue;
    const call = formatToolCall({
      args: item.args,
      themeFg: (color, value) => theme.fg(color, value),
      toolName: item.name,
    });
    container.addChild(new Text(theme.fg("muted", "→ ") + call, 0, 0));
  }
};

const resultHeader = (result: SingleResult, theme: Theme): string => {
  const icon = isFailedResult(result) ? theme.fg("error", "✗") : theme.fg("success", "✓");
  let header = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}${theme.fg("muted", ` (${result.agentSource})`)}`;
  if (isFailedResult(result) && result.stopReason !== undefined && result.stopReason.length > 0) {
    header += ` ${theme.fg("error", `[${result.stopReason}]`)}`;
  }
  return header;
};

const renderSingleExpanded = (result: SingleResult, theme: Theme): tuiTypes.Container => {
  const container = new Container();
  const items = getDisplayItems(result.messages);
  const finalOutput = getFinalOutput(result.messages);

  container.addChild(new Text(resultHeader(result, theme), 0, 0));
  if (
    isFailedResult(result) &&
    result.errorMessage !== undefined &&
    result.errorMessage.length > 0
  ) {
    container.addChild(new Text(theme.fg("error", `Error: ${result.errorMessage}`), 0, 0));
  }
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
  container.addChild(new Text(theme.fg("dim", result.task), 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));

  if (items.length === 0 && finalOutput.length === 0) {
    container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
  } else {
    addToolCalls({ container, items, theme });
    if (finalOutput.length > 0) {
      container.addChild(new Spacer(1));
      container.addChild(new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()));
    }
  }

  const usage = formatUsageStats({ model: result.model, usage: result.usage });
  if (usage.length > 0) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", usage), 0, 0));
  }
  return container;
};

const renderSingleCollapsed = (result: SingleResult, theme: Theme): tuiTypes.Text => {
  const items = getDisplayItems(result.messages);
  let text = resultHeader(result, theme);

  if (
    isFailedResult(result) &&
    result.errorMessage !== undefined &&
    result.errorMessage.length > 0
  ) {
    text += `\n${theme.fg("error", `Error: ${result.errorMessage}`)}`;
  } else if (items.length === 0) {
    text += `\n${theme.fg("muted", "(no output)")}`;
  } else {
    text += `\n${renderDisplayItems({ expanded: false, items, limit: COLLAPSED_ITEM_COUNT, theme })}`;
    if (items.length > COLLAPSED_ITEM_COUNT) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
  }

  const usage = formatUsageStats({ model: result.model, usage: result.usage });
  if (usage.length > 0) text += `\n${theme.fg("dim", usage)}`;
  return new Text(text, 0, 0);
};

const renderSingle = (result: SingleResult, expanded: boolean, theme: Theme) =>
  expanded ? renderSingleExpanded(result, theme) : renderSingleCollapsed(result, theme);

export const renderResult = (request: {
  readonly result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown };
  readonly options: { expanded: boolean };
  readonly theme: Theme;
}) => {
  const { result, options, theme } = request;
  const details = result.details as SubagentDetails | undefined;
  if (details === undefined || details.results.length === 0) {
    const content = result.content[0];
    return new Text(content?.type === "text" ? (content.text ?? "") : "(no output)", 0, 0);
  }

  const single = details.results.length === 1 ? details.results[0] : undefined;
  if (details.mode === "single" && single !== undefined) {
    return renderSingle(single, options.expanded, theme);
  }
  if (details.mode === "chain") {
    return renderChain({ expanded: options.expanded, results: details.results, theme });
  }
  if (details.mode === "parallel") {
    return renderParallel({ expanded: options.expanded, results: details.results, theme });
  }

  const content = result.content[0];
  return new Text(content?.type === "text" ? (content.text ?? "") : "(no output)", 0, 0);
};
