import type pendingQueueTypes from "./pending-queue.types.ts";
import type typesModule from "./types.ts";

export default class PendingMessageQueue {
  private entries: pendingQueueTypes.QueuedEntry[] = [];
  private released = 0;
  public mode: typesModule.QueueMode;

  constructor(mode: typesModule.QueueMode) {
    this.mode = mode;
  }

  enqueue(message: typesModule.AgentMessage, sequence: number): void {
    this.entries.push({ message, sequence });
  }

  hasItems(): boolean {
    return this.entries.length > 0;
  }

  peek(): typesModule.AgentMessage[] {
    return this.peekEntries().map((entry) => entry.message);
  }

  drain(): typesModule.AgentMessage[] {
    const drained = this.peekEntries();
    this.entries = this.entries.slice(drained.length);
    this.released = Math.max(0, this.released - drained.length);
    return drained.map((entry) => entry.message);
  }

  releaseAll(): number {
    this.released = this.entries.length;
    return this.released;
  }

  takeAll(): pendingQueueTypes.QueuedEntry[] {
    const taken = this.entries;
    this.entries = [];
    this.released = 0;
    return taken;
  }

  clear(): void {
    this.entries = [];
    this.released = 0;
  }

  private peekEntries(): pendingQueueTypes.QueuedEntry[] {
    const count = this.mode === "all" ? this.entries.length : Math.max(this.released, 1);
    return this.entries.slice(0, count);
  }
}
