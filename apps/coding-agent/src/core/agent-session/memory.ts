import errorsModule from "../../utils/errors.ts";
import type AgentSession from "../agent-session.ts";
import memoryServiceFactory from "../memory/memory-service-factory.ts";
import type MemoryService from "../memory/memory-service.ts";
import memoryModule from "../memory/memory.ts";
import type memoryTypes from "../memory/memory.types.ts";

const { toErrorMessage } = errorsModule;
const { createMemoryService } = memoryServiceFactory;
const { resolveMemorySettings } = memoryModule;

export default class SessionMemory {
  memoryInternal: MemoryService | undefined;

  private readonly session: AgentSession;

  private connectionOptions: memoryTypes.MemoryConnectionOptions = {};

  constructor(session: AgentSession) {
    this.session = session;
  }

  get memory(): MemoryService | undefined {
    return this.memoryInternal;
  }

  configure(options: memoryTypes.MemoryConnectionOptions | undefined): void {
    this.connectionOptions = options ?? {};
  }

  private settings() {
    return resolveMemorySettings(this.session.settingsManager.getSettings());
  }

  resetMemory(): void {
    void this.memoryInternal?.client.close();
    this.memoryInternal = this.settings().enabled
      ? createMemoryService({
          agentDir: this.session.agentDir,
          connection: this.connectionOptions,
          cwd: this.session.cwd,
          settingsManager: this.session.settingsManager,
        })
      : undefined;
  }

  close(): Promise<void> {
    const memory = this.memoryInternal;
    this.memoryInternal = undefined;
    return memory === undefined ? Promise.resolve() : memory.client.close();
  }

  migrateInBackground(): void {
    const memory = this.memoryInternal;
    if (memory === undefined) return;
    memory.migrate().then(
      (result) => {
        if (result === undefined) return undefined;
        return this.session.emit({
          text: [
            `Moved ${result.sent} memories from memory.db to sepiace; memory.db is now memory.db.migrated.`,
            ...result.skipped.map(
              (skipped) =>
                `Not moved, looks like it holds a secret (${skipped.secrets.join(", ")}): memory ${skipped.id} in memory.db.migrated`,
            ),
          ].join("\n"),
          type: "memory_status",
        });
      },
      (error: unknown) =>
        this.session.emit({
          text: `Moving memories from memory.db to sepiace failed; the next session retries: ${toErrorMessage(error)}`,
          type: "memory_status",
        }),
    );
  }
}
