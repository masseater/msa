import type { Context } from "@msa/chord";
import type { CodemodeResult, CodemodeRun } from "@msa/codemode/portable";
import type { CodemodeSourceOptions } from "@msa/codemode/source";
import { Cause, Effect, Exit } from "effect";

import type { ToolExecutionApi, ToolExecutionResult } from "../harness/types.ts";
import { type CallHost, createCallHost } from "./run-calls.ts";
import { CODEMODE_MODULE_VERSION, type CodemodeToolOptions, errorResult } from "./run-docs.ts";
import { type Resumed, RunJournal } from "./run-journal.ts";
import { completeRun, decideRun } from "./run-persist.ts";
import { openRun, remainingOf } from "./run-start.ts";

const abortOf = (signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal === undefined || signal.aborted) {
      resume(Effect.void);
      return;
    }
    const onAbort = (): void => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

class CodemodeRunner {
  private readonly options: CodemodeToolOptions;
  private readonly context: Context;
  private readonly host: CallHost;
  private readonly opened: Resumed;
  private readonly journal: RunJournal;
  private readonly controller = new AbortController();
  private run: CodemodeRun | undefined;
  private ended: ToolExecutionResult | undefined;
  private failure: unknown;
  private generatedImages = 0;

  constructor(
    options: CodemodeToolOptions,
    api: ToolExecutionApi,
    context: Context,
    opened: Resumed,
  ) {
    this.options = options;
    this.context = context;
    this.opened = opened;
    this.host = createCallHost({
      options,
      api,
      context,
      start: opened.start,
      stopped: () => this.stopped,
      generated: (images) => {
        this.generatedImages += images;
      },
    });
    this.journal = new RunJournal({
      host: this.host,
      opened,
      run: () => this.run!,
      stopped: () => this.stopped,
      diverge: (message) => this.diverge(message),
      fail: (error) => this.fail(error),
      refuse: (result, reason) => this.refuse(result, reason),
    });
  }

  execute(code: string): Effect.Effect<ToolExecutionResult> {
    const { start } = this.opened;
    if (start.version !== CODEMODE_MODULE_VERSION) {
      return this.decide(
        errorResult(
          `The script cannot resume: it started under code mode version ${start.version}, this is ${CODEMODE_MODULE_VERSION}.`,
        ),
      );
    }
    const remaining = remainingOf(start);
    if (remaining !== undefined && remaining <= 0) {
      return this.decide(
        errorResult(`Script timed out: its deadline passed while it was interrupted.`),
      );
    }
    const { abortSignal } = this.context;
    const onAbort = () => this.controller.abort(abortSignal?.reason);
    return Effect.suspend(() => {
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      if (abortSignal?.aborted === true) onAbort();
      return this.runScript(code, remaining);
    }).pipe(Effect.ensuring(Effect.sync(() => abortSignal?.removeEventListener("abort", onAbort))));
  }

  private startScript(code: string, remaining: number | undefined): CodemodeRun {
    const { start } = this.opened;
    const { journal } = this;
    this.run = this.options.sandbox.start(code, {
      startedAt: start.startedAt,
      seed: start.seed,
      tools: start.tools.filter((tool) => tool.hidden !== true),
      globals: start.globals,
      store: start.store,
      signal: this.controller.signal,
      ...(remaining === undefined ? {} : { timeoutMs: remaining }),
      onStarted: (fingerprint) => void Effect.runFork(journal.checkFingerprint(fingerprint)),
      onCall: (call) => journal.onCall(call),
      onIdle: (seq, issued) => journal.onIdle(seq, issued),
    });
    return this.run;
  }

  private runScript(code: string, remaining: number | undefined) {
    return Effect.gen({ self: this }, function* () {
      const run = this.startScript(code, remaining);
      const result = yield* Effect.promise(() => run.result);
      if (this.failure !== undefined) throw this.failure;
      if (this.ended !== undefined) return this.ended;
      const { abortSignal } = this.context;
      abortSignal?.throwIfAborted();
      if (!result.ok && result.error.kind === "aborted" && !this.controller.signal.aborted) {
        yield* abortOf(abortSignal);
        abortSignal?.throwIfAborted();
        throw new Error("The code mode sandbox was closed while the script ran");
      }
      return yield* this.finish(result);
    });
  }

  private finish(result: CodemodeResult): Effect.Effect<ToolExecutionResult> {
    const { during } = result;
    if (during !== undefined && this.wentOnBefore(during)) {
      return this.decide(
        errorResult(
          `The script took a different path when resumed after a restart: it ended after result ${during.seq}, where it went on before.`,
        ),
      );
    }
    return Effect.suspend(() =>
      completeRun(
        this.host.api,
        this.context,
        this.opened.start,
        { result, generatedImages: this.generatedImages },
        this.host.rows.details(),
      ),
    );
  }

  private wentOnBefore(during: { readonly seq: number; readonly issued: number }): boolean {
    const { journal: replayed, rerun, firstIssued } = this.opened;
    if (!rerun || during.seq > replayed.length) return false;
    return (
      (during.seq === 0
        ? replayed.length > 0 || firstIssued !== undefined
        : replayed[during.seq - 1]?.issuedAfter !== undefined) ||
      replayed.slice(during.seq).some((entry) => entry.id > during.issued)
    );
  }

  private decide(decided: ToolExecutionResult): Effect.Effect<ToolExecutionResult> {
    return Effect.suspend(() =>
      decideRun(this.host.api, this.context, decided, this.host.rows.details()),
    );
  }

  private refuse(result: ToolExecutionResult, reason: Error): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.ended = result;
      const decided = yield* Effect.exit(this.decide(result));
      if (Exit.isFailure(decided)) this.fail(Cause.squash(decided.cause));
      this.controller.abort(reason);
    });
  }

  private diverge(message: string): void {
    if (this.ended !== undefined || this.failure !== undefined) return;
    const result = errorResult(
      `The script took a different path when resumed after a restart: ${message}`,
    );
    this.ended = result;
    Effect.runFork(
      Effect.map(Effect.exit(this.decide(result)), (exit) =>
        Exit.isSuccess(exit)
          ? this.controller.abort(new Error(message))
          : this.fail(Cause.squash(exit.cause)),
      ),
    );
  }

  private get stopped(): boolean {
    return this.ended !== undefined || this.failure !== undefined || this.run?.finished === true;
  }

  private fail(error: unknown): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    this.controller.abort(error);
  }
}

export const runCodemode = Effect.fnUntraced(function* (
  options: CodemodeToolOptions,
  api: ToolExecutionApi,
  context: Context,
  source: { readonly code: string; readonly options: CodemodeSourceOptions },
) {
  const opened = yield* openRun(options, source.options, api, context);
  if ("done" in opened) return opened.done;
  return yield* new CodemodeRunner(options, api, context, opened).execute(source.code);
});
