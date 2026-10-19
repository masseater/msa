import { Box, Container, Spacer, Text } from "@msa/tui";

import { renderDiff } from "../../../modes/interactive/components/diff.ts";
import { expandHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../../extensions/types.ts";
import type { EditDiffError, EditDiffResult } from "../edit-diff.ts";
import type { EditToolDetails } from "../edit.ts";
import { renderToolPath, str } from "../render-utils.ts";
import {
  getRenderablePreviewInput,
  type RenderableEditArgs,
  requestEditPreview,
} from "./edit-preview-input.ts";

type EditPreview = EditDiffResult | EditDiffError;
export type EditRenderState = {
  callComponent?: EditCallRenderComponent;
};
type EditToolResultLike = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: EditToolDetails;
};
type EditCallRenderComponent = Box & {
  preview?: EditPreview | undefined;
  previewArgsKey?: string | undefined;
  previewPending?: boolean;
  settledError?: boolean;
};
function createEditCallRenderComponent(): EditCallRenderComponent {
  return Object.assign(new Box(1, 1, (text: string) => text), {
    preview: undefined as EditPreview | undefined,
    previewArgsKey: undefined as string | undefined,
    previewPending: false,
    settledError: false,
  });
}
function getEditCallRenderComponent(
  state: EditRenderState,
  lastComponent: unknown,
): EditCallRenderComponent {
  if (lastComponent instanceof Box) {
    const component = lastComponent as EditCallRenderComponent;
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
function formatEditCall(args: RenderableEditArgs | undefined, theme: Theme, cwd: string): string {
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
  args: RenderableEditArgs | undefined,
  preview: EditPreview | undefined,
  result: EditToolResultLike,
  theme: Theme,
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
  preview: EditPreview | undefined,
  settledError: boolean | undefined,
  theme: Theme,
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
  component: EditCallRenderComponent,
  args: RenderableEditArgs | undefined,
  theme: Theme,
  cwd: string,
  outputPad: number,
  expanded: boolean,
): EditCallRenderComponent {
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
  component: EditCallRenderComponent,
  preview: EditPreview,
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

type EditRenderResultContext = Parameters<NonNullable<ToolDefinition<any, any>["renderResult"]>>[3];

function syncCallComponent(
  callComponent: EditCallRenderComponent,
  typedResult: EditToolResultLike,
  theme: Theme,
  context: EditRenderResultContext,
): void {
  const args = context.args as RenderableEditArgs | undefined;
  const previewInput = getRenderablePreviewInput(args);
  const argsKey =
    previewInput === null
      ? undefined
      : JSON.stringify({ path: previewInput.path, edits: previewInput.edits });
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

export const editRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
  renderCall(args, theme, context) {
    const component = getEditCallRenderComponent(context.state, context.lastComponent);
    const previewInput = getRenderablePreviewInput(args as RenderableEditArgs | undefined);
    const argsKey =
      previewInput === null
        ? undefined
        : JSON.stringify({ path: previewInput.path, edits: previewInput.edits });

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
        path: previewInput.path,
        edits: previewInput.edits,
        cwd: context.cwd,
        onPreview: (preview) => {
          if (component.previewArgsKey === requestKey) {
            setEditPreview(component, preview, requestKey);
            context.invalidate();
          }
        },
      });
    }

    return buildEditCallComponent(
      component,
      args as RenderableEditArgs | undefined,
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
      context.args as RenderableEditArgs | undefined,
      callComponent?.preview,
      typedResult,
      theme,
      context.isError,
      context.expanded,
    );
    const component = (context.lastComponent as Container | undefined) ?? new Container();
    component.clear();
    if (output === undefined || output === "") {
      return component;
    }
    component.addChild(new Spacer(1));
    component.addChild(new Text(output, context.outputPad, 0));
    return component;
  },
};
