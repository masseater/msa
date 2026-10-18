import type { ChildProcess } from "node:child_process";
import { constants as osConstants } from "node:os";

import { Effect, Function } from "effect";

import type { Dual2 } from "../dual.ts";
import { cancelTimer, startTimer, type Timer } from "./node-timer.ts";

const EXIT_STDIO_GRACE_MS = 100;

export type ChildExit = { code: number | null; signal: NodeJS.Signals | null };

type Resume = (effect: Effect.Effect<ChildExit, Error>) => void;

class ChildWaiter {
  readonly #child: ChildProcess;
  readonly #spillIsDraining: () => boolean;
  readonly #resume: Resume;
  #settled = false;
  #exited = false;
  #exitCode: number | null = null;
  #exitSignal: NodeJS.Signals | null = null;
  #postExitTimer: Timer | undefined;
  #stdoutEnded: boolean;
  #stderrEnded: boolean;

  constructor(child: ChildProcess, spillIsDraining: () => boolean, resume: Resume) {
    this.#child = child;
    this.#spillIsDraining = spillIsDraining;
    this.#resume = resume;
    this.#stdoutEnded = child.stdout === null;
    this.#stderrEnded = child.stderr === null;
  }

  listen(): void {
    const child = this.#child;
    child.stdout?.once("end", this.#onStdoutEnd);
    child.stderr?.once("end", this.#onStderrEnd);
    child.stdout?.on("data", this.#onData);
    child.stderr?.on("data", this.#onData);
    child.once("error", this.#onError);
    child.once("exit", this.#onExit);
    child.once("close", this.#onClose);
  }

  #cleanup(): void {
    const child = this.#child;
    cancelTimer(this.#postExitTimer);
    child.removeListener("error", this.#onError);
    child.removeListener("exit", this.#onExit);
    child.removeListener("close", this.#onClose);
    child.stdout?.removeListener("end", this.#onStdoutEnd);
    child.stderr?.removeListener("end", this.#onStderrEnd);
    child.stdout?.removeListener("data", this.#onData);
    child.stderr?.removeListener("data", this.#onData);
  }

  #finalize(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#cleanup();
    this.#child.stdout?.destroy();
    this.#child.stderr?.destroy();
    this.#resume(Effect.succeed({ code: this.#exitCode, signal: this.#exitSignal }));
  }

  #maybeFinalizeAfterExit(): void {
    if (this.#exited && this.#stdoutEnded && this.#stderrEnded) this.#finalize();
  }

  #armIdleTimer(): void {
    cancelTimer(this.#postExitTimer);
    this.#postExitTimer = startTimer(EXIT_STDIO_GRACE_MS, () => {
      if (this.#spillIsDraining()) this.#armIdleTimer();
      else this.#finalize();
    });
  }

  readonly #onData = (): void => {
    if (this.#exited && !this.#settled) this.#armIdleTimer();
  };

  readonly #onStdoutEnd = (): void => {
    this.#stdoutEnded = true;
    this.#maybeFinalizeAfterExit();
  };

  readonly #onStderrEnd = (): void => {
    this.#stderrEnded = true;
    this.#maybeFinalizeAfterExit();
  };

  readonly #onError = (error: Error): void => {
    if (this.#settled) return;
    this.#settled = true;
    this.#cleanup();
    this.#resume(Effect.fail(error));
  };

  readonly #onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    this.#exited = true;
    this.#exitCode = code;
    this.#exitSignal = signal;
    this.#maybeFinalizeAfterExit();
    if (!this.#settled) this.#armIdleTimer();
  };

  readonly #onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    this.#exitCode = code;
    this.#exitSignal = signal;
    this.#finalize();
  };
}

export const waitForChildProcess: Dual2<
  ChildProcess,
  () => boolean,
  Effect.Effect<ChildExit, Error>
> = Function.dual(2, (child: ChildProcess, spillIsDraining: () => boolean) =>
  Effect.callback<ChildExit, Error>((resume) => {
    new ChildWaiter(child, spillIsDraining, resume).listen();
  }),
);

export const exitCodeOf = ({ code, signal }: ChildExit): number =>
  code ?? (signal === null ? 1 : 128 + (osConstants.signals[signal] ?? 0));
