import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import renderUtils from "../../core/tools/render-utils.ts";
import visualTruncate from "../../modes/interactive/components/visual-truncate.ts";
import type toolsTypes from "./tools.types.ts";

const { Container, Spacer, Text } = tui;
const { formatToolCallWithArgs, getTextOutput, replaceTabs } = renderUtils;
const { collapsedOutput } = visualTruncate;

function createMcpToolRenderers(label: string): extensionsTypesTypes.ToolRenderers {
  return {
    renderCall(args, theme, context) {
      const component = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
      component.setText(formatToolCallWithArgs(label, args, theme, context.expanded));
      return component;
    },
    renderResult(result, options, theme, context) {
      const component =
        (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
      component.clear();
      const output = getTextOutput(result, context.showImages).trim();
      if (output === "") return component;
      const color = context.isError ? "error" : "toolOutput";
      const styled = replaceTabs(output)
        .split("\n")
        .map((line) => theme.fg(color, line))
        .join("\n");
      component.addChild(new Spacer(1));
      if (!options.expanded) {
        component.addChild(collapsedOutput(output, "first"));
        return component;
      }
      component.addChild(new Text(styled, 0, 0));
      const fullOutputPath = (result.details as toolsTypes.McpToolDetails | undefined)
        ?.fullOutputPath;
      if (fullOutputPath !== undefined && fullOutputPath !== "")
        component.addChild(new Text(theme.fg("muted", `Full output: ${fullOutputPath}`), 0, 0));
      return component;
    },
  };
}

const toolsPart7 = {
  createMcpToolRenderers,
};

export default toolsPart7;
