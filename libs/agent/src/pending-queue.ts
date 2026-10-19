import type { AgentMessage, QueueMode } from "./types.ts";

export type QueuedEntry = { readonly message: AgentMessage; readonly sequence: number };

export class PendingMessageQueue {
  private entries: QueuedEntry[] = [];
  private released = 0;
  public mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: AgentMessage, sequence: number): void {
    this.entries.push({ message, sequence });
  }

  hasItems(): boolean {
    return this.entries.length > 0;
  }

  peek(): AgentMessage[] {
    return this.peekEntries().map((entry) => entry.message);
  }

  drain(): AgentMessage[] {
    const drained = this.peekEntries();
    this.entries = this.entries.slice(drained.length);
    this.released = Math.max(0, this.released - drained.length);
    return drained.map((entry) => entry.message);
  }

  releaseAll(): number {
    this.released = this.entries.length;
    return this.released;
  }

  takeAll(): QueuedEntry[] {
    const taken = this.entries;
    this.entries = [];
    this.released = 0;
    return taken;
  }

  clear(): void {
    this.entries = [];
    this.released = 0;
  }

  private peekEntries(): QueuedEntry[] {
    const count = this.mode === "all" ? this.entries.length : Math.max(this.released, 1);
    return this.entries.slice(0, count);
  }
}
