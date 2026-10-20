import { Effect, Function as Fn, Result } from "effect";

import { toErrorMessage } from "../../utils/errors.ts";
import { fromPromise, platformRuntime, unwrapForeign } from "../platform/index.ts";
import { snapshotEventHandlers } from "./runner-support.ts";
import type {
  Extension,
  ExtensionError,
  LoadExtensionsResult,
  ProjectTrustContext,
  ProjectTrustEvent,
  ProjectTrustEventResult,
  SessionShutdownEvent,
} from "./types.ts";

export interface ShutdownEmitter {
  hasHandlers(eventType: string): boolean;
  emit(event: SessionShutdownEvent): Promise<unknown>;
}

const emitSessionShutdownEventImpl = (
  extensionRunner: ShutdownEmitter,
  event: SessionShutdownEvent,
): Promise<boolean> =>
  extensionRunner.hasHandlers("session_shutdown")
    ? extensionRunner.emit(event).then(() => true)
    : Promise.resolve(false);

export const emitSessionShutdownEvent: {
  (event: SessionShutdownEvent): (extensionRunner: ShutdownEmitter) => Promise<boolean>;
  (extensionRunner: ShutdownEmitter, event: SessionShutdownEvent): Promise<boolean>;
} = Fn.dual(2, emitSessionShutdownEventImpl);

const projectTrust = (
  extensionsResult: LoadExtensionsResult,
  event: ProjectTrustEvent,
  ctx: ProjectTrustContext,
) =>
  Effect.gen(function* () {
    const errors: ExtensionError[] = [];
    for (const { ext, handlers } of snapshotEventHandlers(
      extensionsResult.extensions,
      "project_trust",
    )) {
      for (const handler of handlers) {
        const outcome = yield* fromPromise(() => handler(event, ctx)).pipe(Effect.result);
        if (Result.isFailure(outcome)) {
          errors.push(trustError(ext, event, outcome.failure.cause));
          continue;
        }
        const handlerResult = outcome.success as ProjectTrustEventResult;
        if (handlerResult.trusted !== "undecided") return { errors, result: handlerResult };
      }
    }
    return { errors };
  });

const trustError = (ext: Extension, event: ProjectTrustEvent, error: unknown): ExtensionError => ({
  error: toErrorMessage(error),
  event: event.type,
  extensionPath: ext.path,
  stack: error instanceof Error ? error.stack : undefined,
});

export const emitProjectTrustEvent: {
  (
    event: ProjectTrustEvent,
    ctx: ProjectTrustContext,
  ): (
    extensionsResult: LoadExtensionsResult,
  ) => Promise<{ result?: ProjectTrustEventResult; errors: ExtensionError[] }>;
  (
    extensionsResult: LoadExtensionsResult,
    event: ProjectTrustEvent,
    ctx: ProjectTrustContext,
  ): Promise<{ result?: ProjectTrustEventResult; errors: ExtensionError[] }>;
} = Fn.dual(
  3,
  (
    extensionsResult: LoadExtensionsResult,
    event: ProjectTrustEvent,
    ctx: ProjectTrustContext,
  ): Promise<{ result?: ProjectTrustEventResult; errors: ExtensionError[] }> =>
    platformRuntime.runPromise(unwrapForeign(projectTrust(extensionsResult, event, ctx))),
);
