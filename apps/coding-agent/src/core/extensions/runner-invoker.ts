import { Effect } from "effect";

import errors from "../../utils/errors.ts";
import platform from "../platform/index.ts";
import type runnerInvokerTypes from "./runner-invoker.types.ts";
import runnerSupport from "./runner-support.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { snapshotEventHandlers } = runnerSupport;
const { toErrorMessage } = errors;
const { fromPromise } = platform;

export default class HandlerInvoker {
  protected readonly host: runnerInvokerTypes.EmitHost;

  constructor(host: runnerInvokerTypes.EmitHost) {
    this.host = host;
  }

  protected slots(
    eventType: extensionsTypesTypes.ExtensionEvent["type"],
  ): runnerInvokerTypes.HandlerSlot[] {
    return snapshotEventHandlers(this.host.extensions, eventType).flatMap(({ ext, handlers }) =>
      handlers.map((handler) => ({ ext, handler })),
    );
  }

  protected reportError(
    extensionPath: string,
    event: string,
    error: unknown,
    message = toErrorMessage(error),
  ): void {
    this.host.emitError({
      error: message,
      event,
      extensionPath,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  protected invoke({ ext, eventType, handler, event, ctx }: runnerInvokerTypes.HandlerRun) {
    return fromPromise(() => handler(event, ctx)).pipe(
      Effect.map((value): runnerInvokerTypes.HandlerOutcome => ({ ok: true, value })),
      Effect.catchTag("ForeignError", (failure) =>
        Effect.sync((): runnerInvokerTypes.HandlerOutcome => {
          this.reportError(ext.path, eventType, failure.cause);
          return { ok: false };
        }),
      ),
    );
  }
}
