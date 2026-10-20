import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import errors from "../../utils/errors.ts";
import type clientTypes from "./client.types.ts";
import LlamaView from "./llama-view.ts";
import type uiTypes from "./ui.types.ts";
const { awaited, awaiting } = awaitingModule;
const { toErrorMessage } = errors;

function showLlamaUiImpl(
  ctx: extensionsTypesTypes.ExtensionCommandContext,
  run: (ui: uiTypes.LlamaUi) => Promise<void>,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(
        ctx.ui.custom<void>((tui, theme, keybindings, done) => {
          const view = new LlamaView(tui, theme, keybindings);
          Effect.runFork(
            Effect.tryPromise(() => run(view)).pipe(
              Effect.catch((error) =>
                Effect.sync(() => ctx.ui.notify(toErrorMessage(error.cause), "error")),
              ),
              Effect.ensuring(Effect.sync(() => done())),
            ),
          );
          return view;
        }),
      );
    }),
  );
}
const showLlamaUi: {
  (
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    run: (ui: uiTypes.LlamaUi) => Promise<void>,
  ): Promise<void>;
  (
    run: (ui: uiTypes.LlamaUi) => Promise<void>,
  ): (ctx: extensionsTypesTypes.ExtensionCommandContext) => Promise<void>;
} = dual((args: IArguments) => args.length >= 2, showLlamaUiImpl);
function runWithProgressImpl<T>(
  ui: uiTypes.LlamaUi,
  options: {
    title: string;
    model: string;
    initialMessage: string;
    cancelTitle: string;
    cancelMessage: string;
    run(signal: AbortSignal, update: (progress: clientTypes.LlamaProgress) => void): Promise<T>;
    cancel(): Promise<void>;
  },
): Promise<{ cancelled: true } | { cancelled: false; value: T }> {
  return Effect.runPromise(
    awaiting(function* () {
      const controller = new AbortController();
      const state: uiTypes.ProgressState = {
        message: options.initialMessage,
        model: options.model,
        title: options.title,
      };
      const settled = options
        .run(controller.signal, (progress) => {
          Object.assign(state, progress);
          ui.updateProgress(state);
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ error, ok: false as const }),
        );
      const progress = { completed: false };
      settled.finally(() => {
        progress.completed = true;
      });

      while (!progress.completed) {
        const outcome = yield* awaited(
          Promise.race([
            settled.then(() => "settled" as const),
            ui.progress(state).then(() => "stop" as const),
          ]),
        );
        if (outcome === "settled") break;
        const stop = yield* awaited(ui.confirm(options.cancelTitle, options.cancelMessage));
        if (!stop || progress.completed) continue;
        yield* awaited(runWithProgressImplPart1<T>(options, controller, settled));
        return { cancelled: true };
      }

      const result = yield* awaited(settled);
      if (!result.ok) throw result.error;
      return { cancelled: false, value: result.value };
    }),
  );
}
const runWithProgress: {
  <T>(
    ui: uiTypes.LlamaUi,
    options: {
      title: string;
      model: string;
      initialMessage: string;
      cancelTitle: string;
      cancelMessage: string;
      run(signal: AbortSignal, update: (progress: clientTypes.LlamaProgress) => void): Promise<T>;
      cancel(): Promise<void>;
    },
  ): Promise<{ cancelled: true } | { cancelled: false; value: T }>;
  <T>(options: {
    title: string;
    model: string;
    initialMessage: string;
    cancelTitle: string;
    cancelMessage: string;
    run(signal: AbortSignal, update: (progress: clientTypes.LlamaProgress) => void): Promise<T>;
    cancel(): Promise<void>;
  }): (ui: uiTypes.LlamaUi) => Promise<{ cancelled: true } | { cancelled: false; value: T }>;
} = dual((args: IArguments) => args.length >= 2, runWithProgressImpl);

const ui = {
  runWithProgress,
  showLlamaUi,
};

export default ui;

function* runWithProgressImplPart1<T>(
  options: {
    title: string;
    model: string;
    initialMessage: string;
    cancelTitle: string;
    cancelMessage: string;
    run(signal: AbortSignal, update: (progress: clientTypes.LlamaProgress) => void): Promise<T>;
    cancel(): Promise<void>;
  },
  controller: AbortController,
  settled: Promise<{ error: unknown; ok: false } | { ok: true; value: T }>,
) {
  try {
    yield* awaited(options.cancel());
  } finally {
    controller.abort(new Error("Cancelled"));
  }
  yield* awaited(settled);
}
