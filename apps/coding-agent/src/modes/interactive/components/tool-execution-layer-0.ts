import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";

export default abstract class ToolExecutionComponentLayer0 extends tui.Container {
  contentBox!: tuiTypes.Box;
  protected contentText!: tuiTypes.Text;
  protected contentTextRegion!: tuiTypes.MouseRegion;
  selfRenderContainer!: tuiTypes.Container;
  protected selfRenderHeight = 0;
  callRendererComponent?: tuiTypes.Component | undefined;
  resultRendererComponent?: tuiTypes.Component | undefined;
  protected rendererState: any = {};
  imageComponents: tuiTypes.Image[] = [];
  imageSources: Array<{ data: string; mimeType: string; widthCells: number }> = [];
  imageSpacers: tuiTypes.Spacer[] = [];
  protected toolName!: string;
  protected toolCallId!: string;
  args!: any;
  expanded = false;
  showImages!: boolean;
  imageWidthCells!: number;
  outputPad!: number;
  isPartial = true;
  protected toolDefinition?: extensionsTypesTypes.ToolRenderers | undefined;
  protected ui!: tuiTypes.TUI;
  protected cwd!: string;
  protected executionStarted = false;
  protected argsComplete = false;
  result?: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError: boolean;
    details?: any;
    durationMs?: number;
  };
}
