import * as Effect from "effect/Effect";

import errors from "../../utils/errors.ts";
import awaitingModule from "../awaiting.ts";
import type packageManagerTypes from "../package-manager.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errors;

export default class PackageProgress {
  private progressCallback: packageManagerTypes.ProgressCallback | undefined;

  setProgressCallback(callback: packageManagerTypes.ProgressCallback | undefined): void {
    this.progressCallback = callback;
  }

  withProgress(
    action: packageManagerTypes.ProgressEvent["action"],
    source: string,
    message: string,
    operation: () => Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.emitProgress({ action, message, source, type: "start" });
      try {
        yield* awaited(operation());
        this.emitProgress({ action, source, type: "complete" });
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        this.emitProgress({ action, message: errorMessage, source, type: "error" });
        throw error;
      }
    }, this);
  }

  private emitProgress(event: packageManagerTypes.ProgressEvent): void {
    this.progressCallback?.(event);
  }
}
