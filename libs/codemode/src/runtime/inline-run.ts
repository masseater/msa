import type { VmEvents } from "./launcher.ts";
import type { VmStartData, WorkerToHostMessage } from "./protocol.ts";

export class InlineRun {
  stopped = false;
  private settled = false;
  private polls = 0;
  private exhausted = false;
  private timedOut = false;
  private readonly deadline: number | undefined;

  private readonly data: VmStartData;
  private readonly events: VmEvents;
  private readonly interruptBudget: number;

  constructor(data: VmStartData, events: VmEvents, interruptBudget: number) {
    this.data = data;
    this.events = events;
    this.interruptBudget = interruptBudget;
    this.deadline = data.timeoutMs === undefined ? undefined : performance.now() + data.timeoutMs;
  }

  readonly shouldInterrupt = (): boolean => {
    if (this.stopped || this.settled || this.exhausted || this.timedOut) return true;
    if (this.deadline !== undefined && performance.now() >= this.deadline) {
      this.timedOut = true;
      return true;
    }
    if (++this.polls <= this.interruptBudget) return false;
    this.exhausted = true;
    return true;
  };

  readonly post = (message: WorkerToHostMessage): void => {
    const terminal = message.type === "done" || message.type === "crash";
    if (terminal && this.settled) return;
    if (terminal) this.settled = true;
    queueMicrotask(() => this.dispatch(message, terminal));
  };

  private dispatch(message: WorkerToHostMessage, terminal: boolean): void {
    if (this.stopped) return;
    if ((this.exhausted || this.timedOut) && terminal) {
      this.events.failure({
        kind: "timeout",
        message: this.timedOut
          ? `Execution timed out after ${this.data.timeoutMs} ms`
          : `Execution exceeded its interrupt budget of ${this.interruptBudget}`,
      });
      return;
    }
    this.events.message(message);
  }
}
