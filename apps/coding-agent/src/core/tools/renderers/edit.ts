import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import diffModule from "../../../modes/interactive/components/diff.ts";
import keybindingHints from "../../../modes/interactive/components/keybinding-hints.ts";
import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type editTypesModule from "../edit.types.ts";
import renderUtils from "../render-utils.ts";
import editPreviewInput from "./edit-preview-input.ts";
import type editPreviewInputTypes from "./edit-preview-input.types.ts";
import type editTypes from "./edit.types.ts";

const { getRenderablePreviewInput, requestEditPreview } = editPreviewInput;
const { renderToolPath, str } = renderUtils;
const { renderDiff } = diffModule;
const { expandHint } = keybindingHints;

const { Box, Container, Spacer, Text } = tui;

type EditToolResultLike = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: editTypesModule.EditToolDetails;
};
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
function summarizeDiff(diff: string): string {
  const rows = diff.split("\n");
  const added = rows.filter((row) => /^\+\s*\d/u.test(row)).length;
  const removed = rows.filter((row) => /^-\s*\d/u.test(row)).length;
  return `+${added} -${removed} lines`;
}
function formatEditResult(
  args: editPreviewInputTypes.RenderableEditArgs | undefined,
  preview: editTypes.EditPreview | undefined,
  result: EditToolResultLike,
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
    return expanded
      ? renderDiff(resultDiff, { filePath: rawPath ?? undefined })
      : expandHint(summarizeDiff(resultDiff));
  }

  return undefined;
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
      : expanded
        ? renderDiff(component.preview.diff)
        : expandHint(summarizeDiff(component.preview.diff));
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

type EditRenderResultContext = Parameters<
  NonNullable<extensionsTypesTypes.ToolDefinition<any, any>["renderResult"]>
>[3];

function syncCallComponent(
  callComponent: editTypes.EditCallRenderComponent,
  typedResult: EditToolResultLike,
  theme: themeTypes.Theme,
  context: EditRenderResultContext,
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
    const typedResult = result as EditToolResultLike;
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
