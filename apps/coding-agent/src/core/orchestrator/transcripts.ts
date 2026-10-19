import type { AgentMessage } from "@msa/agent-core";

import { SessionManager } from "../session-manager.ts";
import type { WorkerSession } from "./worker.ts";

export class TranscriptCache {
  private readonly cache = new Map<string, readonly AgentMessage[]>();

  messages(
    id: string,
    workers: ReadonlyMap<string, WorkerSession>,
    sessionFile: string | null,
  ): readonly AgentMessage[] {
    const worker = workers.get(id);
    if (worker !== undefined) {
      const streaming = worker.state.streamingMessage;
      return streaming === undefined ? worker.messages : [...worker.messages, streaming];
    }
    if (sessionFile === null) return [];
    let cached = this.cache.get(sessionFile);
    if (cached === undefined) {
      try {
        cached = SessionManager.open(sessionFile).buildSessionContext().messages;
      } catch {
        cached = [];
      }
      this.cache.set(sessionFile, cached);
    }
    return cached;
  }
}
