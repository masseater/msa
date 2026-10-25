import errorsModule from "../../utils/errors.ts";
import type AgentSession from "../agent-session.ts";
import mcpSignInStorage from "../mcp-sign-in-storage.ts";
import legacyMigration from "../memory/legacy-migration.ts";
import MemoryService from "../memory/memory-service.ts";
import memoryModule from "../memory/memory.ts";

const { toErrorMessage } = errorsModule;
const { legacyDatabasePath } = legacyMigration;
const { SEPIACE_TOOL_NAME, resolveMemorySettings } = memoryModule;
const { signInsNotSaved } = mcpSignInStorage;

export default class SessionMemory {
  memoryInternal: MemoryService | undefined;

  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get memory(): MemoryService | undefined {
    return this.memoryInternal;
  }

  private settings() {
    return resolveMemorySettings(this.session.settingsManager.getSettings());
  }

  resetMemory(): void {
    this.memoryInternal = this.settings().enabled
      ? new MemoryService({
          agentDir: this.session.agentDir,
          cwd: this.session.cwd,
          legacyDatabase: legacyDatabasePath(
            this.session.agentDir,
            this.session.settingsManager.getSettings(),
          ),
          settings: () => this.settings(),
          signInSaved: () => signInsNotSaved(this.session.agentDir) === undefined,
          tool: () => this.session.tools.registry.toolRegistry.get(SEPIACE_TOOL_NAME),
        })
      : undefined;
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
