import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";

const { Text } = tui;

type Renderers = Pick<extensionsTypesTypes.ToolDefinition<any, any>, "renderCall" | "renderResult">;
type RenderResult = NonNullable<Renderers["renderResult"]>;
type Result = Parameters<RenderResult>[0];
type Context = Parameters<RenderResult>[3];

function textRenderers(
  formatCall: (
    args: any,
    theme: themeTypes.Theme,
    context: Parameters<NonNullable<Renderers["renderCall"]>>[2],
  ) => string,
  formatResult: (
    result: Result,
    options: extensionsTypesTypes.ToolRenderResultOptions,
    theme: themeTypes.Theme,
    context: Context,
  ) => string,
): Renderers {
  return {
    renderCall(args, theme, context) {
      const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatCall(args, theme, context));
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatResult(result, options, theme, context));
      return text;
    },
  };
}

const textRenderersModule = {
  textRenderers,
};

export default textRenderersModule;
