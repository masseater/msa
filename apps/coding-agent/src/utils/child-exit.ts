import platformModule from "../core/platform.ts";
import type platformTypes from "../core/platform.types.ts";
import type nodeChildProcessTypes from "../core/platform/node/child-process.types.ts";

const { schedule } = platformModule;

const EXIT_STDIO_GRACE_MS = 100;

export default class ChildExit {
  private readonly child: nodeChildProcessTypes.ChildProcess;
  private readonly resolve: (code: number | null) => void;
  private readonly reject: (error: Error) => void;
  private settled = false;
  private exited = false;
  private exitCode: number | null = null;
  private postExitTimer: platformTypes.Scheduled | undefined;
  private stdoutEnded: boolean;
  private stderrEnded: boolean;

  constructor(
    child: nodeChildProcessTypes.ChildProcess,
    resolve: (code: number | null) => void,
    reject: (error: Error) => void,
  ) {
    this.child = child;
    this.resolve = resolve;
    this.reject = reject;
    this.stdoutEnded = child.stdout === null;
    this.stderrEnded = child.stderr === null;
  }

  attach(): void {
    this.child.stdout?.once("end", this.onStdoutEnd);
    this.child.stderr?.once("end", this.onStderrEnd);
    this.child.stdout?.on("data", this.onData);
    this.child.stderr?.on("data", this.onData);
    this.child.once("error", this.onError);
    this.child.once("exit", this.onExit);
    this.child.once("close", this.finalize);
  }

  private detach(): void {
    this.postExitTimer?.cancel();
    this.postExitTimer = undefined;
    this.child.removeListener("error", this.onError);
    this.child.removeListener("exit", this.onExit);
    this.child.removeListener("close", this.finalize);
    this.child.stdout?.removeListener("end", this.onStdoutEnd);
    this.child.stderr?.removeListener("end", this.onStderrEnd);
    this.child.stdout?.removeListener("data", this.onData);
    this.child.stderr?.removeListener("data", this.onData);
  }

  private readonly finalize = (code: number | null): void => {
    if (this.settled) return;
    this.settled = true;
    this.detach();
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    this.resolve(code);
  };

  private finalizeWhenStdioEnded(): void {
    if (this.exited && !this.settled && this.stdoutEnded && this.stderrEnded) {
      this.finalize(this.exitCode);
    }
  }

  private armIdleTimer(): void {
    this.postExitTimer?.cancel();
    this.postExitTimer = schedule(() => this.finalize(this.exitCode), EXIT_STDIO_GRACE_MS);
  }

  private readonly onData = (): void => {
    if (this.exited && !this.settled) this.armIdleTimer();
  };

  private readonly onStdoutEnd = (): void => {
    this.stdoutEnded = true;
    this.finalizeWhenStdioEnded();
  };

  private readonly onStderrEnd = (): void => {
    this.stderrEnded = true;
    this.finalizeWhenStdioEnded();
  };

  private readonly onError = (error: Error): void => {
    if (this.settled) return;
    this.settled = true;
    this.detach();
    this.reject(error);
  };

  private readonly onExit = (code: number | null): void => {
    this.exited = true;
    this.exitCode = code;
    this.finalizeWhenStdioEnded();
    if (!this.settled) this.armIdleTimer();
  };
}
