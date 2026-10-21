import type AgentSession from "../agent-session.ts";
import MemoryService from "../memory/memory-service.ts";
import type memoryTypes from "../memory/memory.types.ts";

export default class SessionMemory {
  memoryInternal: memoryTypes.MemoryService | undefined;

  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get memory(): memoryTypes.MemoryService | undefined {
    return this.memoryInternal;
  }

  resetMemory(): void {
    const memorySettings = this.session.settingsManager.context.getMemorySettings();
    void this.memoryInternal?.close();
    this.memoryInternal = memorySettings.enabled
      ? new MemoryService({ cwd: this.session.cwd, settings: memorySettings })
      : undefined;
    this.memoryInternal?.warm();
  }

  close(): Promise<void> {
    const closing = Promise.resolve(this.memoryInternal?.close());
    this.memoryInternal = undefined;
    return closing;
  }
}
