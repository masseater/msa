import type AgentSession from "../agent-session.ts";
import SessionAutoCompaction from "./auto-compaction.ts";
import SessionCompactionHooks from "./compaction-hooks.ts";
import SessionCompaction from "./compaction.ts";
import SessionOverflowRecovery from "./overflow-recovery.ts";

export default class SessionCompactionDomain {
  readonly manual: SessionCompaction;
  readonly auto: SessionAutoCompaction;
  readonly hooks: SessionCompactionHooks;
  readonly overflow: SessionOverflowRecovery;

  constructor(session: AgentSession) {
    this.manual = new SessionCompaction(session);
    this.auto = new SessionAutoCompaction(session);
    this.hooks = new SessionCompactionHooks(session);
    this.overflow = new SessionOverflowRecovery(session);
  }
}
