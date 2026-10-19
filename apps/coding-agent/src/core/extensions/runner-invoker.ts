import { Effect } from "effect";

import { toErrorMessage } from "../../utils/errors.ts";
import { fromPromise } from "../platform/index.ts";
import { snapshotEventHandlers } from "./runner-support.ts";
import type { HandlerFn } from "./types-runtime.ts";
import type { Extension, ExtensionContext, ExtensionError, ExtensionEvent } from "./types.ts";

export interface EmitHost {
  readonly extensions: Extension[];
  createContext(): ExtensionContext;
  emitError(error: ExtensionError): void;
  assertActive(): void;
}

export interface HandlerRun {
  ext: Extension;
  eventType: string;
  handler: HandlerFn;
  event: unknown;
  ctx: ExtensionContext;
}

export type HandlerOutcome = { ok: true; value: unknown } | { ok: false };

export interface HandlerSlot {
  ext: Extension;
  handler: HandlerFn;
}

export class HandlerInvoker {
  protected readonly host: EmitHost;

  constructor(host: EmitHost) {
    this.host = host;
  }

  protected slots(eventType: ExtensionEvent["type"]): HandlerSlot[] {
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
      extensionPath,
      event,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  protected invoke({ ext, eventType, handler, event, ctx }: HandlerRun) {
    return fromPromise(() => handler(event, ctx)).pipe(
      Effect.map((value): HandlerOutcome => ({ ok: true, value })),
      Effect.catchTag("ForeignError", (failure) =>
        Effect.sync((): HandlerOutcome => {
          this.reportError(ext.path, eventType, failure.cause);
          return { ok: false };
        }),
      ),
    );
  }
}
