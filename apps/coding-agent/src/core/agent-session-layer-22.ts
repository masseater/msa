import * as Effect from "effect/Effect";

import themeModule from "../modes/interactive/theme/theme.ts";
import AgentSessionLayer21 from "./agent-session-layer-21.ts";
import awaitingModule from "./awaiting.ts";
import exportHtml from "./export-html/index.ts";
import type exportHtmlTypes from "./export-html/index.types.ts";
import toolRendererModule from "./export-html/tool-renderer.ts";

const { awaited, awaitingWith } = awaitingModule;
const { getThemeByName, theme } = themeModule;
const { createToolHtmlRenderer } = toolRendererModule;
const { exportSessionToHtml } = exportHtml;

export default abstract class AgentSessionLayer22 extends AgentSessionLayer21 {
  exportToHtml(
    outputPath?: string,
    options: { themeName?: string | undefined } = {},
  ): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const themeName = [options.themeName, this.settingsManager.getTheme()].find(
          (candidate) => candidate !== undefined && getThemeByName(candidate) !== undefined,
        );

        const toolRenderer: exportHtmlTypes.ToolHtmlRenderer = createToolHtmlRenderer({
          cwd: this.sessionManager.getCwd(),
          getToolRenderers: (name) =>
            this.extensionRunnerInternal.resolveToolRenderers(name, () =>
              this.getToolDefinition(name),
            ),
          theme,
        });

        return yield* awaited(
          exportSessionToHtml(this.sessionManager, this.state, {
            outputPath,
            themeName,
            toolRenderer,
          }),
        );
      }, this),
    );
  }
}
