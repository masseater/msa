import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type readContentTypes from "../read-content.types.ts";
import readCall from "./read-call.ts";
import readClassification from "./read-classification.ts";
import readResult from "./read-result.ts";
import type readRenderTypes from "./read.types.ts";

const { formatCompactReadCall, formatReadCall } = readCall;
const { getCompactReadClassification } = readClassification;
const { formatReadResult } = readResult;

const { Text } = tui;

const readRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, readContentTypes.ReadToolDetails | undefined>,
  "renderCall" | "renderResult"
> = {
  renderCall(rawArgs, theme, context) {
    const args = rawArgs as readRenderTypes.ReadRenderArgs | undefined;
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    const classification = context.expanded
      ? undefined
      : getCompactReadClassification({ args, cwd: context.cwd });
    text.setText(
      classification === undefined
        ? formatReadCall(args, theme, context.cwd)
        : formatCompactReadCall(classification, args, theme),
    );
    return text;
  },
  renderResult(result, options, theme, context) {
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(
      formatReadResult(
        context.args as readRenderTypes.ReadRenderArgs | undefined,
        result,
        options,
        theme,
        context.showImages,
        context.cwd,
        context.isError,
      ),
    );
    return text;
  },
};

const read = {
  readRenderers,
};

export default read;
