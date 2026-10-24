import delay from "./delay.ts";
import type delayTypes from "./delay.types.ts";
import env from "./env.ts";
import programStatusModule from "./program-status.ts";
import type programStatusTypes from "./program-status.types.ts";

const { readEnv } = env;
const { PROGRAM_STATUS_QUERY, formatProgramStatus, isProgramStatusReply, programStatusReplyKinds } =
  programStatusModule;
const { runEvery } = delay;

const TERMINAL_PROGRESS_KEEPALIVE_MS = 1000;
const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07";
const TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1b]9;4;0\x07";

export default class TerminalStatusReporter {
  private cancelProgressKeepalive: delayTypes.CancelDelay | undefined;
  private programStatus: programStatusTypes.ProgramStatus | undefined;
  private programStatusSupported = false;
  private programStatusQueryPending = false;
  private programStatusKinds: ReadonlySet<string> | undefined;

  beginQuery(): string {
    const programStatusOverride = readEnv("MSA_PROGRAM_STATUS");
    this.programStatusSupported = programStatusOverride === "1";
    this.programStatusQueryPending = programStatusOverride !== "1" && programStatusOverride !== "0";
    return this.programStatusQueryPending ? PROGRAM_STATUS_QUERY : "";
  }

  handleReply(sequence: string): boolean {
    if (!isProgramStatusReply(sequence)) return false;
    if (this.programStatusQueryPending) {
      this.programStatusQueryPending = false;
      this.programStatusSupported = true;
      this.programStatusKinds = programStatusReplyKinds(sequence);
      this.writeProgramStatus();
    }
    return true;
  }

  endQuery(): void {
    this.programStatusQueryPending = false;
  }

  stop(): void {
    if (this.clearProgressInterval()) {
      process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
    }
    if (this.programStatusSupported && this.programStatus !== undefined) {
      process.stdout.write(formatProgramStatus({ state: "clear" }));
    }
    this.programStatusSupported = false;
    this.programStatusQueryPending = false;
  }

  setProgramStatus(status: programStatusTypes.ProgramStatus): void {
    this.programStatus = status.state === "clear" ? undefined : status;
    if (this.programStatusSupported)
      process.stdout.write(formatProgramStatus(status, this.programStatusKinds));
  }

  writeProgramStatus(): void {
    if (this.programStatusSupported && this.programStatus !== undefined) {
      process.stdout.write(formatProgramStatus(this.programStatus, this.programStatusKinds));
    }
  }

  setProgress(active: boolean): void {
    if (active) {
      process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
      if (this.cancelProgressKeepalive === undefined) {
        this.cancelProgressKeepalive = runEvery(TERMINAL_PROGRESS_KEEPALIVE_MS, () => {
          process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
        });
      }
    } else {
      this.clearProgressInterval();
      process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
    }
  }

  private clearProgressInterval(): boolean {
    if (this.cancelProgressKeepalive === undefined) return false;
    this.cancelProgressKeepalive();
    this.cancelProgressKeepalive = undefined;
    return true;
  }
}
