import tui from "@msa/tui";

import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import renderUtils from "../render-utils.ts";
import editDiffView from "./edit-diff-view.ts";
import editPreviewInput from "./edit-preview-input.ts";
import type editPreviewInputTypes from "./edit-preview-input.types.ts";
import type editTypes from "./edit.types.ts";

const { getRenderablePreviewInput } = editPreviewInput;
const { renderToolPath, str } = renderUtils;
const { renderDiffBody } = editDiffView;

const { Box, Spacer, Text } = tui;

function createEditCallRenderComponent(): editTypes.EditCallRenderComponent {
  return Object.assign(new Box(1, 1, (text: string) => text), {
    preview: undefined as editTypes.EditPreview | undefined,
    previewArgsKey: undefined as string | undefined,
    previewPending: false,
    settledError: false,
  });
}
function getEditCallRenderComponent(
  state: editTypes.EditRenderState,
  lastComponent: unknown,
): editTypes.EditCallRenderComponent {
  if (lastComponent instanceof Box) {
    const component = lastComponent as editTypes.EditCallRenderComponent;
    state.callComponent = component;
    return component;
  }
  if (state.callComponent !== undefined) {
    return state.callComponent;
  }
  const component = createEditCallRenderComponent();
  state.callComponent = component;
  return component;
}
function formatEditCall(
  args: editPreviewInputTypes.RenderableEditArgs | undefined,
  theme: themeTypes.Theme,
  cwd: string,
): string {
  const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
  return `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`;
}
function getEditHeaderBg(
  preview: editTypes.EditPreview | undefined,
  settledError: boolean | undefined,
  theme: themeTypes.Theme,
): (text: string) => string {
  if (preview !== undefined) {
    if ("error" in preview) {
      return (text: string) => theme.bg("toolErrorBg", text);
    }
    return (text: string) => theme.bg("toolSuccessBg", text);
  }
  if (settledError === true) {
    return (text: string) => theme.bg("toolErrorBg", text);
  }
  return (text: string) => theme.bg("toolPendingBg", text);
}
function buildEditCallComponent(
  component: editTypes.EditCallRenderComponent,
  args: editPreviewInputTypes.RenderableEditArgs | undefined,
  theme: themeTypes.Theme,
  cwd: string,
  outputPad: number,
  expanded: boolean,
): editTypes.EditCallRenderComponent {
  component.setBgFn(getEditHeaderBg(component.preview, component.settledError, theme));
  component.setPaddingX(outputPad);
  component.clear();
  component.addChild(new Text(formatEditCall(args, theme, cwd), 0, 0));

  if (component.preview === undefined) {
    return component;
  }

  const body =
    "error" in component.preview
      ? theme.fg("error", component.preview.error)
      : renderDiffBody(component.preview.diff, expanded);
  component.addChild(new Spacer(1));
  component.addChild(new Text(body, 0, 0));
  return component;
}
function setEditPreview(
  component: editTypes.EditCallRenderComponent,
  preview: editTypes.EditPreview,
  argsKey: string | undefined,
): boolean {
  const current = component.preview;
  const changed =
    current === undefined ||
    ("error" in current && "error" in preview
      ? current.error !== preview.error
      : "error" in current !== "error" in preview) ||
    (!("error" in current) &&
      !("error" in preview) &&
      (current.diff !== preview.diff || current.firstChangedLine !== preview.firstChangedLine));
  component.preview = preview;
  component.previewArgsKey = argsKey;
  component.previewPending = false;
  return changed;
}

function syncCallComponent(
  callComponent: editTypes.EditCallRenderComponent,
  typedResult: editTypes.EditToolResultLike,
  theme: themeTypes.Theme,
  context: editTypes.EditRenderResultContext,
): void {
  const args = context.args as editPreviewInputTypes.RenderableEditArgs | undefined;
  const previewInput = getRenderablePreviewInput(args);
  const argsKey =
    previewInput === null
      ? undefined
      : JSON.stringify({ edits: previewInput.edits, path: previewInput.path });
  const resultDiff = context.isError ? undefined : typedResult.details?.diff;
  let changed = false;
  if (typeof resultDiff === "string") {
    changed = setEditPreview(
      callComponent,
      { diff: resultDiff, firstChangedLine: typedResult.details?.firstChangedLine },
      argsKey,
    );
  }
  if (callComponent.settledError !== context.isError) {
    callComponent.settledError = context.isError;
    changed = true;
  }
  if (changed) {
    buildEditCallComponent(
      callComponent,
      args,
      theme,
      context.cwd,
      context.outputPad,
      context.expanded,
    );
  }
}

const editCallComponent = {
  buildEditCallComponent,
  getEditCallRenderComponent,
  setEditPreview,
  syncCallComponent,
};

export default editCallComponent;
