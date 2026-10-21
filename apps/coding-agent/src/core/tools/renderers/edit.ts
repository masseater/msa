import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import renderUtils from "../render-utils.ts";
import editCallComponent from "./edit-call-component.ts";
import editDiffView from "./edit-diff-view.ts";
import editPreviewInput from "./edit-preview-input.ts";
import type editPreviewInputTypes from "./edit-preview-input.types.ts";
import type editTypes from "./edit.types.ts";

const { getRenderablePreviewInput, requestEditPreview } = editPreviewInput;
const { str } = renderUtils;
const { renderDiffBody } = editDiffView;
const { buildEditCallComponent, getEditCallRenderComponent, setEditPreview, syncCallComponent } =
  editCallComponent;

const { Container, Spacer, Text } = tui;

function formatEditResult(
  args: editPreviewInputTypes.RenderableEditArgs | undefined,
  preview: editTypes.EditPreview | undefined,
  result: editTypes.EditToolResultLike,
  theme: themeTypes.Theme,
  isError: boolean,
  expanded: boolean,
): string | undefined {
  const rawPath = str(args?.file_path ?? args?.path);
  const previewDiff = preview !== undefined && !("error" in preview) ? preview.diff : undefined;
  const previewError = preview !== undefined && "error" in preview ? preview.error : undefined;
  if (isError) {
    const errorText = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
    if (errorText === "" || errorText === previewError) {
      return undefined;
    }
    return theme.fg("error", errorText);
  }

  const resultDiff = result.details?.diff;
  if (resultDiff !== undefined && resultDiff !== "" && resultDiff !== previewDiff) {
    return renderDiffBody(resultDiff, expanded, rawPath ?? undefined);
  }

  return undefined;
}
const editRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, any>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    const component = getEditCallRenderComponent(context.state, context.lastComponent);
    const previewInput = getRenderablePreviewInput(
      args as editPreviewInputTypes.RenderableEditArgs | undefined,
    );
    const argsKey =
      previewInput === null
        ? undefined
        : JSON.stringify({ edits: previewInput.edits, path: previewInput.path });

    if (component.previewArgsKey !== argsKey) {
      component.preview = undefined;
      component.previewArgsKey = argsKey;
      component.previewPending = false;
      component.settledError = false;
    }

    if (
      context.argsComplete &&
      previewInput !== null &&
      component.preview === undefined &&
      component.previewPending !== true
    ) {
      component.previewPending = true;
      const requestKey = argsKey;
      requestEditPreview({
        cwd: context.cwd,
        edits: previewInput.edits,
        onPreview: (preview) => {
          if (component.previewArgsKey === requestKey) {
            setEditPreview(component, preview, requestKey);
            context.invalidate();
          }
        },
        path: previewInput.path,
      });
    }

    return buildEditCallComponent(
      component,
      args as editPreviewInputTypes.RenderableEditArgs | undefined,
      theme,
      context.cwd,
      context.outputPad,
      context.expanded,
    );
  },
  renderResult(result, _options, theme, context) {
    const callComponent = context.state.callComponent;
    const typedResult = result as editTypes.EditToolResultLike;
    if (callComponent !== undefined) {
      syncCallComponent(callComponent, typedResult, theme, context);
    }

    const output = formatEditResult(
      context.args as editPreviewInputTypes.RenderableEditArgs | undefined,
      callComponent?.preview,
      typedResult,
      theme,
      context.isError,
      context.expanded,
    );
    const component = (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
    component.clear();
    if (output === undefined || output === "") {
      return component;
    }
    component.addChild(new Spacer(1));
    component.addChild(new Text(output, context.outputPad, 0));
    return component;
  },
};

const edit = {
  editRenderers,
};

export default edit;
