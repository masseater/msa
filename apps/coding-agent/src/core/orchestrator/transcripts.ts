import type agentTypes from "@msa/agent-core/index.types";

import SessionManager from "../session-manager.ts";
import type workerTypes from "./worker.ts";

export default class TranscriptCache {
  private readonly cache = new Map<string, readonly agentTypes.AgentMessage[]>();
  private readonly onLoaded: () => void;

  constructor(onLoaded: () => void) {
    this.onLoaded = onLoaded;
  }

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
    const cached = this.cache.get(sessionFile);
    if (cached !== undefined) return cached;
    this.cache.set(sessionFile, []);
    void this.load(sessionFile);
    return [];
  }

  private load(sessionFile: string): Promise<void> {
    return SessionManager.open(sessionFile)
      .then(
        (sessionManager) => sessionManager.buildSessionContext().messages,
        () => [],
      )
      .then((messages) => {
        this.cache.set(sessionFile, messages);
        this.onLoaded();
        return undefined;
      });
  }
}
