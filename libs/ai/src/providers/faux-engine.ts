import { Effect } from "effect";

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  DeferredHandle,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "../types.ts";
import { createAssistantMessageEventStream } from "../utils/event-stream.ts";
import { errorMessage, type FauxOrigin, stampMessage } from "./faux-messages.ts";
import type { FauxPacing } from "./faux-stream.ts";
import type {
  FauxProviderState,
  FauxResponseStep,
  RegisterFauxProviderOptions,
} from "./faux-types.ts";
import { withUsageEstimate } from "./faux-usage.ts";

export interface DeferredEntry {
  readonly handle: DeferredHandle;
  readonly step: FauxResponseStep;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
  readonly model: Model<string>;
  pendingFetches: number;
  cancelled: boolean;
  final?: AssistantMessage;
}

export interface FauxEngine {
  readonly api: string;
  readonly provider: string;
  readonly state: FauxProviderState;
  readonly promptCache: Map<string, readonly string[]>;
  readonly pacing: FauxPacing;
  readonly deferred: RegisterFauxProviderOptions["deferred"];
  readonly deferredResponses: Map<string, DeferredEntry>;
}

export const originOf =
  (engine: FauxEngine) =>
  (model: Model<string>): FauxOrigin => ({
    api: engine.api,
    provider: engine.provider,
    modelId: model.id,
  });

export interface FauxResponseRequest {
  readonly engine: FauxEngine;
  readonly step: FauxResponseStep;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
  readonly model: Model<string>;
}

export const resolveFauxResponse = Effect.fn("resolveFauxResponse")(function* ({
  engine,
  step,
  context,
  options,
  model,
}: FauxResponseRequest) {
  const resolved =
    typeof step === "function"
      ? yield* Effect.promise(() => Promise.resolve(step(context, options, engine.state, model)))
      : step;
  return withUsageEstimate({
    message: stampMessage({ message: resolved, origin: originOf(engine)(model) }),
    context,
    options,
    promptCache: engine.promptCache,
  });
});

export const endWithError =
  (stream: AssistantMessageEventStream) =>
  (message: AssistantMessage): void => {
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
  };

export interface DetachedStream {
  readonly engine: FauxEngine;
  readonly model: Model<string>;
  readonly run: (stream: AssistantMessageEventStream) => Effect.Effect<void>;
}

export function streamDetached({
  engine,
  model,
  run,
}: DetachedStream): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    Effect.runFork(
      run(stream).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() =>
            endWithError(stream)(errorMessage({ error, origin: originOf(engine)(model) })),
          ),
        ),
      ),
    );
  });
  return stream;
}
