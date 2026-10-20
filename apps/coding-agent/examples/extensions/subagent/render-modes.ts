import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import format from "./format.ts";
import renderItems from "./render-items.ts";
import type subagentTypesTypes from "./types.types.ts";

const { getMarkdownTheme } = codingAgent;
const { aggregateUsage, formatUsageStats, getDisplayItems, getFinalOutput, isFailedResult } =
  format;
const { addToolCalls, renderDisplayItems } = renderItems;

const { Container, Markdown, Spacer, Text } = tui;

const stepSection = (
  result: subagentTypesTypes.SingleResult,
  label: string,
  theme: codingAgentTypes.Theme,
): tuiTypes.Container => {
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
  const usage = formatUsageStats({ model: result.model, usage: result.usage });
  if (usage.length > 0) container.addChild(new Text(theme.fg("dim", usage), 0, 0));
  return container;
};

const renderChainImpl = (
  results: subagentTypesTypes.SingleResult[],
  expanded: boolean,
  theme: codingAgentTypes.Theme,
): tuiTypes.Container | tuiTypes.Text => {
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
          : `\n${renderDisplayItems({ expanded: false, items, limit: 5, theme })}`;
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

const renderParallelCollapsed = (
  results: subagentTypesTypes.SingleResult[],
  title: string,
  theme: codingAgentTypes.Theme,
): string => {
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
      text += `\n${renderDisplayItems({ expanded: false, items, limit: 5, theme })}`;
    }
  }

  if (results.every((r) => r.exitCode !== -1)) {
    const usage = formatUsageStats({ usage: aggregateUsage(results) });
    if (usage.length > 0) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
  }
  return `${text}\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
};

const renderParallelImpl = (
  results: subagentTypesTypes.SingleResult[],
  expanded: boolean,
  theme: codingAgentTypes.Theme,
): tuiTypes.Container | tuiTypes.Text => {
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

const renderChain = (request: {
  readonly results: subagentTypesTypes.SingleResult[];
  readonly expanded: boolean;
  readonly theme: codingAgentTypes.Theme;
}): tuiTypes.Container | tuiTypes.Text =>
  renderChainImpl(request.results, request.expanded, request.theme);

const renderParallel = (request: {
  readonly results: subagentTypesTypes.SingleResult[];
  readonly expanded: boolean;
  readonly theme: codingAgentTypes.Theme;
}): tuiTypes.Container | tuiTypes.Text =>
  renderParallelImpl(request.results, request.expanded, request.theme);

const renderModes = {
  renderChain,
  renderParallel,
};

export default renderModes;
