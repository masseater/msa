import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import themeModule from "../theme/theme.ts";
import ToolExecutionComponentLayer2 from "./tool-execution-layer-2.ts";
import type toolExecutionTypes from "./tool-execution.types.ts";

const { Box, Container, Spacer, Text } = tui;
const { theme } = themeModule;

export default class ToolExecutionComponent extends ToolExecutionComponentLayer2 {
  constructor(
    toolName: string,
    toolCallId: string,
    args: any,
    options: toolExecutionTypes.ToolExecutionOptions = {},
    toolDefinition:
      | extensionsTypesTypes.ToolRenderers
      | extensionsTypesTypes.ToolDefinition<any, any, any>
      | undefined,
    ui: tuiTypes.TUI,
    cwd: string,
  ) {
    super();
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.args = args;
    this.toolDefinition = toolDefinition;
    this.showImages = options.showImages ?? true;
    this.imageWidthCells = options.imageWidthCells ?? 60;
    this.outputPad = options.outputPad ?? 1;
    this.ui = ui;
    this.cwd = cwd;

    this.addChild(new Spacer(1));

    this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
    this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
    this.contentTextRegion = this.createResultRegion(this.contentText);
    this.selfRenderContainer = new Container();

    if (this.hasRendererDefinition()) {
      this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
    } else {
      this.addChild(this.contentTextRegion);
    }

    this.updateDisplay();
  }
}
