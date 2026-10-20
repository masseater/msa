import { constants as osConstants } from "node:os";

import { Effect, Function } from "effect";

import type dualTypes from "../../dual.ts";
import type nodeChildWaitTypes from "./node-child-wait.types.ts";
import type nodeProcessTypes from "./node-process.types.ts";
import nodeTimer from "./node-timer.ts";
import type nodeTimerTypes from "./node-timer.types.ts";

const { cancelTimer, startTimer } = nodeTimer;

const EXIT_STDIO_GRACE_MS = 100;

type Resume = (effect: Effect.Effect<nodeChildWaitTypes.ChildExit, Error>) => void;

class ChildWaiter {
  readonly #child: nodeProcessTypes.OsProcess;
  readonly #spillIsDraining: () => boolean;
  readonly #resume: Resume;
  #settled = false;
  #exited = false;
  #exitCode: number | null = null;
  #exitSignal: NodeJS.Signals | null = null;
  #postExitTimer: nodeTimerTypes.Timer | undefined;
  #stdoutEnded: boolean;
  #stderrEnded: boolean;

  constructor(child: nodeProcessTypes.OsProcess, spillIsDraining: () => boolean, resume: Resume) {
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

const waitForChildProcess: dualTypes.Dual2<
  nodeProcessTypes.OsProcess,
  () => boolean,
  Effect.Effect<nodeChildWaitTypes.ChildExit, Error>
> = Function.dual(2, (child: nodeProcessTypes.OsProcess, spillIsDraining: () => boolean) =>
  Effect.callback<nodeChildWaitTypes.ChildExit, Error>((resume) => {
    new ChildWaiter(child, spillIsDraining, resume).listen();
  }),
);

const exitCodeOf = ({ code, signal }: nodeChildWaitTypes.ChildExit): number =>
  code ?? (signal === null ? 1 : 128 + (osConstants.signals[signal] ?? 0));

const nodeChildWait = {
  exitCodeOf,
  waitForChildProcess,
};

export default nodeChildWait;
