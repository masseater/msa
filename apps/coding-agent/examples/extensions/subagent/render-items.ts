import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import format from "./format.ts";
import type subagentTypesTypes from "./types.types.ts";

const { formatToolCall } = format;

const { Text } = tui;

const renderDisplayItems = (request: {
  readonly items: subagentTypesTypes.DisplayItem[];
  readonly expanded: boolean;
  readonly theme: codingAgentTypes.Theme;
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

const addToolCalls = (request: {
  readonly container: tuiTypes.Container;
  readonly items: subagentTypesTypes.DisplayItem[];
  readonly theme: codingAgentTypes.Theme;
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

const renderItems = {
  addToolCalls,
  renderDisplayItems,
};

export default renderItems;
