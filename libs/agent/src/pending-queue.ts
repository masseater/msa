import type { AgentMessage, QueueMode } from "./types.ts";

export class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  public mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  peek(): AgentMessage[] {
    if (this.mode === "all") return this.messages.slice();
    const first = this.messages[0];
    return first === undefined ? [] : [first];
  }

  drain(): AgentMessage[] {
    const drained = this.peek();
    this.messages = this.messages.slice(drained.length);
    return drained;
  }

  clear(): void {
    this.messages = [];
  }
}
