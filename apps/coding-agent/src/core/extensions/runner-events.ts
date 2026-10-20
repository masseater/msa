import { Effect, Function as Fn, Result } from "effect";

import errorsModule from "../../utils/errors.ts";
import platform from "../platform/index.ts";
import type runnerEventsTypes from "./runner-events.types.ts";
import runnerSupport from "./runner-support.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { snapshotEventHandlers } = runnerSupport;
const { fromPromise, unwrapForeign } = platform;
const { toErrorMessage } = errorsModule;

const emitSessionShutdownEventImpl = (
  extensionRunner: runnerEventsTypes.ShutdownEmitter,
  event: extensionsTypesTypes.SessionShutdownEvent,
): Promise<boolean> =>
  extensionRunner.hasHandlers("session_shutdown")
    ? extensionRunner.emit(event).then(() => true)
    : Promise.resolve(false);

const emitSessionShutdownEvent: {
  (
    event: extensionsTypesTypes.SessionShutdownEvent,
  ): (extensionRunner: runnerEventsTypes.ShutdownEmitter) => Promise<boolean>;
  (
    extensionRunner: runnerEventsTypes.ShutdownEmitter,
    event: extensionsTypesTypes.SessionShutdownEvent,
  ): Promise<boolean>;
} = Fn.dual(2, emitSessionShutdownEventImpl);

const projectTrust = (
  extensionsResult: extensionsTypesTypes.LoadExtensionsResult,
  event: extensionsTypesTypes.ProjectTrustEvent,
  ctx: extensionsTypesTypes.ProjectTrustContext,
) =>
  Effect.gen(function* () {
    const errors: extensionsTypesTypes.ExtensionError[] = [];
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
        const handlerResult = outcome.success as extensionsTypesTypes.ProjectTrustEventResult;
        if (handlerResult.trusted !== "undecided") return { errors, result: handlerResult };
      }
    }
    return { errors };
  });

const trustError = (
  ext: extensionsTypesTypes.Extension,
  event: extensionsTypesTypes.ProjectTrustEvent,
  error: unknown,
): extensionsTypesTypes.ExtensionError => ({
  error: toErrorMessage(error),
  event: event.type,
  extensionPath: ext.path,
  stack: error instanceof Error ? error.stack : undefined,
});

const emitProjectTrustEvent: {
  (
    event: extensionsTypesTypes.ProjectTrustEvent,
    ctx: extensionsTypesTypes.ProjectTrustContext,
  ): (extensionsResult: extensionsTypesTypes.LoadExtensionsResult) => Promise<{
    result?: extensionsTypesTypes.ProjectTrustEventResult;
    errors: extensionsTypesTypes.ExtensionError[];
  }>;
  (
    extensionsResult: extensionsTypesTypes.LoadExtensionsResult,
    event: extensionsTypesTypes.ProjectTrustEvent,
    ctx: extensionsTypesTypes.ProjectTrustContext,
  ): Promise<{
    result?: extensionsTypesTypes.ProjectTrustEventResult;
    errors: extensionsTypesTypes.ExtensionError[];
  }>;
} = Fn.dual(
  3,
  (
    extensionsResult: extensionsTypesTypes.LoadExtensionsResult,
    event: extensionsTypesTypes.ProjectTrustEvent,
    ctx: extensionsTypesTypes.ProjectTrustContext,
  ): Promise<{
    result?: extensionsTypesTypes.ProjectTrustEventResult;
    errors: extensionsTypesTypes.ExtensionError[];
  }> => Effect.runPromise(unwrapForeign(projectTrust(extensionsResult, event, ctx))),
);

const runnerEvents = {
  emitProjectTrustEvent,
  emitSessionShutdownEvent,
};

export default runnerEvents;
