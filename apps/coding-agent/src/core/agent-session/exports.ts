import * as Effect from "effect/Effect";

import themeModule from "../../modes/interactive/theme/theme.ts";
import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import bugReport from "../bug-report.ts";
import exportHtml from "../export-html/index.ts";
import type exportHtmlTypes from "../export-html/index.types.ts";
import toolRendererModule from "../export-html/tool-renderer.ts";
import sessionExport from "../session-export.ts";

const { exportSessionToJsonl } = sessionExport;
const { awaited, awaitingWith, performed } = awaitingModule;
const { getThemeByName, theme } = themeModule;
const { createToolHtmlRenderer } = toolRendererModule;
const { exportSessionToHtml } = exportHtml;
const { generateBugReportSummary } = bugReport;

export default class SessionExports {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  exportToJsonl(outputPath?: string): Promise<string> {
    return exportSessionToJsonl(this.session.sessionManager, outputPath);
  }

  exportToHtml(
    outputPath?: string,
    options: { themeName?: string | undefined } = {},
  ): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const themeName = [options.themeName, this.session.settingsManager.display.getTheme()].find(
          (candidate) => candidate !== undefined && getThemeByName(candidate) !== undefined,
        );

        const toolRenderer: exportHtmlTypes.ToolHtmlRenderer = createToolHtmlRenderer({
          cwd: this.session.sessionManager.getCwd(),
          getToolRenderers: (name) =>
            this.session.extensions.binding.extensionRunnerInternal.resolveToolRenderers(name, () =>
              this.session.tools.registry.getToolDefinition(name),
            ),
          theme,
        });

        return yield* awaited(
          exportSessionToHtml(this.session.sessionManager, this.session.state, {
            outputPath,
            themeName,
            toolRenderer,
          }),
        );
      }, this),
    );
  }

  summarizeForBugReport(options: {
    hint?: string | undefined;
    signal: AbortSignal;
  }): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const model = this.session.model;
        if (model === undefined) {
          throw new Error("No model selected");
        }
        return yield* awaited(
          generateBugReportSummary({
            ...(yield* performed(
              this.session.models.auth.getSummarizationRequestAuth(model, options.signal),
            )),
            hint: options.hint,
            messages: this.session.messages,
            retry: this.session.settingsManager.session.getRetrySettings(),
            sessionId: this.session.sessionId,
            signal: options.signal,
            streamFn: this.session.agent.streamFunction,
          }),
        );
      }, this),
    );
  }
}
