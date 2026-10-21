import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import type truncateTypes from "../../../core/tools/truncate.types.ts";
import BashExecutionComponent from "../components/bash-execution.ts";
import type bashExecutionTypes from "../components/bash-execution.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { awaited, awaitingWith, performed } = awaitingModule;

export default class BashInput {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  isBashMode = false;

  private bashComponent: bashExecutionTypes.BashExecutionComponent | undefined = undefined;

  private pendingBashComponents: bashExecutionTypes.BashExecutionComponent[] = [];

  flushPendingBashComponents(): void {
    for (const component of this.pendingBashComponents) {
      this.mode.layout.pendingMessagesContainer.removeChild(component);
      this.mode.layout.chatContainer.addChild(component);
    }
    this.pendingBashComponents = [];
  }

  private mountBashComponent(command: string, excludeFromContext: boolean): void {
    this.bashComponent = new BashExecutionComponent(
      command,
      this.mode.ui,
      excludeFromContext,
      this.mode.display.thinking.outputPad,
    );
    if (this.mode.session.isStreaming) {
      this.mode.layout.pendingMessagesContainer.addChild(this.bashComponent);
      this.pendingBashComponents.push(this.bashComponent);
    } else this.mode.layout.chatContainer.addChild(this.bashComponent);
  }

  private completeBashComponent(result: {
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    output: string;
    fullOutputPath?: string | undefined;
  }): void {
    this.bashComponent?.setComplete(
      result.exitCode,
      result.cancelled,
      result.truncated
        ? ({ content: result.output, truncated: true } as truncateTypes.TruncationResult)
        : undefined,
      result.fullOutputPath,
    );
  }

  private showExtensionBashResult(
    command: string,
    result: NonNullable<extensionsTypes.UserBashEventResult["result"]>,
    excludeFromContext: boolean,
  ): void {
    this.mountBashComponent(command, excludeFromContext);
    if (result.output !== "") this.bashComponent?.appendOutput(result.output);
    this.completeBashComponent(result);
    this.mode.session.context.bash.recordBashResult(command, result, { excludeFromContext });
    this.bashComponent = undefined;
    this.mode.ui.requestRender();
  }

  private runBashCommand(
    command: string,
    excludeFromContext: boolean,
    operations: extensionsTypes.UserBashEventResult["operations"],
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.mountBashComponent(command, excludeFromContext);
      this.mode.ui.requestRender();
      try {
        const onChunk = (chunk: string) => {
          if (this.bashComponent === undefined) return;
          this.bashComponent.appendOutput(chunk);
          this.mode.ui.requestRender();
        };
        const result = yield* awaited(
          this.mode.session.context.bash.executeBash(command, onChunk, {
            excludeFromContext,
            operations,
          }),
        );
        this.completeBashComponent(result);
      } catch (error) {
        this.bashComponent?.setComplete(undefined, false);
        this.mode.display.status.showError(
          `Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
      this.bashComponent = undefined;
      this.mode.ui.requestRender();
    }, this);
  }

  handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let eventResult: extensionsTypes.UserBashEventResult | undefined;
        try {
          eventResult = yield* awaited(
            this.mode.session.extensions.binding.extensionRunner.emitUserBash({
              command,
              cwd: this.mode.sessionManager.getCwd(),
              excludeFromContext,
              type: "user_bash",
            }),
          );
        } catch {
          return;
        }
        if (eventResult?.result !== undefined) {
          this.showExtensionBashResult(command, eventResult.result, excludeFromContext);
          return;
        }
        yield* performed(this.runBashCommand(command, excludeFromContext, eventResult?.operations));
      }, this),
    );
  }
}
