import type agentTypes from "@msa/agent-core/index.types";

import SessionManager from "../session-manager.ts";
import type workerTypes from "./worker.ts";

export default class TranscriptCache {
  private readonly cache = new Map<string, readonly agentTypes.AgentMessage[]>();

  messages(
    id: string,
    workers: ReadonlyMap<string, workerTypes.WorkerSession>,
    sessionFile: string | null,
  ): readonly agentTypes.AgentMessage[] {
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
