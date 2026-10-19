import type { Theme } from "@msa/coding-agent";
import { getMarkdownTheme } from "@msa/coding-agent";
import { Container, Markdown, Spacer, Text } from "@msa/tui";

import {
  aggregateUsage,
  formatUsageStats,
  getDisplayItems,
  getFinalOutput,
  isFailedResult,
} from "./format.ts";
import { addToolCalls, renderDisplayItems } from "./render.ts";
import type { SingleResult } from "./types.ts";

const stepSection = (result: SingleResult, label: string, theme: Theme): Container => {
  const container = new Container();
  const icon = result.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
  const finalOutput = getFinalOutput(result.messages);

  container.addChild(new Spacer(1));
  container.addChild(new Text(`${theme.fg("muted", label)} ${icon}`, 0, 0));
  container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", result.task), 0, 0));
  addToolCalls({ container, items: getDisplayItems(result.messages), theme });
  if (finalOutput.length > 0) {
    container.addChild(new Spacer(1));
    container.addChild(new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()));
  }
  const usage = formatUsageStats({ usage: result.usage, model: result.model });
  if (usage.length > 0) container.addChild(new Text(theme.fg("dim", usage), 0, 0));
  return container;
};

const renderChainImpl = (
  results: SingleResult[],
  expanded: boolean,
  theme: Theme,
): Container | Text => {
  const successCount = results.filter((r) => r.exitCode === 0).length;
  const icon = successCount === results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");
  const title =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("chain ")) +
    theme.fg("accent", `${successCount}/${results.length} steps`);

  if (!expanded) {
    let text = title;
    for (const result of results) {
      const rIcon = result.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
      const items = getDisplayItems(result.messages);
      text += `\n\n${theme.fg("muted", `─── Step ${result.step}: `)}${theme.fg("accent", result.agent)} ${rIcon}`;
      text +=
        items.length === 0
          ? `\n${theme.fg("muted", "(no output)")}`
          : `\n${renderDisplayItems({ items, expanded: false, theme, limit: 5 })}`;
    }
    const usage = formatUsageStats({ usage: aggregateUsage(results) });
    if (usage.length > 0) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
    text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    return new Text(text, 0, 0);
  }

  const container = new Container();
  container.addChild(new Text(title, 0, 0));
  for (const result of results) {
    container.addChild(stepSection(result, `─── Step ${result.step}: ${result.agent}`, theme));
  }
  const usage = formatUsageStats({ usage: aggregateUsage(results) });
  if (usage.length > 0) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", `Total: ${usage}`), 0, 0));
  }
  return container;
};

const renderParallelCollapsed = (results: SingleResult[], title: string, theme: Theme): string => {
  let text = title;
  for (const result of results) {
    const icon =
      result.exitCode === -1
        ? theme.fg("warning", "⏳")
        : isFailedResult(result)
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");
    const items = getDisplayItems(result.messages);
    text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", result.agent)} ${icon}`;
    if (items.length === 0) {
      text += `\n${theme.fg("muted", result.exitCode === -1 ? "(running...)" : "(no output)")}`;
    } else {
      text += `\n${renderDisplayItems({ items, expanded: false, theme, limit: 5 })}`;
    }
  }

  if (results.every((r) => r.exitCode !== -1)) {
    const usage = formatUsageStats({ usage: aggregateUsage(results) });
    if (usage.length > 0) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
  }
  return `${text}\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
};

const renderParallelImpl = (
  results: SingleResult[],
  expanded: boolean,
  theme: Theme,
): Container | Text => {
  const running = results.filter((r) => r.exitCode === -1).length;
  const successCount = results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
  const failCount = results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
  const isRunning = running > 0;
  const icon = isRunning
    ? theme.fg("warning", "⏳")
    : failCount > 0
      ? theme.fg("warning", "◐")
      : theme.fg("success", "✓");
  const status = isRunning
    ? `${successCount + failCount}/${results.length} done, ${running} running`
    : `${successCount}/${results.length} tasks`;
  const title = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;

  if (expanded && !isRunning) {
    const container = new Container();
    container.addChild(new Text(title, 0, 0));
    for (const result of results) {
      container.addChild(stepSection(result, `─── ${result.agent}`, theme));
    }
    const usage = formatUsageStats({ usage: aggregateUsage(results) });
    if (usage.length > 0) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", `Total: ${usage}`), 0, 0));
    }
    return container;
  }

  return new Text(renderParallelCollapsed(results, title, theme), 0, 0);
};

export const renderChain = (request: {
  readonly results: SingleResult[];
  readonly expanded: boolean;
  readonly theme: Theme;
}): Container | Text => renderChainImpl(request.results, request.expanded, request.theme);

export const renderParallel = (request: {
  readonly results: SingleResult[];
  readonly expanded: boolean;
  readonly theme: Theme;
}): Container | Text => renderParallelImpl(request.results, request.expanded, request.theme);
