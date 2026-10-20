import type AgentSession from "../agent-session.ts";
import SessionBash from "./bash.ts";
import SessionContextBreakdown from "./context-breakdown.ts";
import SessionExports from "./exports.ts";
import SessionStats from "./stats.ts";
import SessionTranscript from "./transcript.ts";
import SessionTree from "./tree.ts";

export default class SessionContext {
  readonly transcript: SessionTranscript;
  readonly tree: SessionTree;
  readonly bash: SessionBash;
  readonly stats: SessionStats;
  readonly breakdown: SessionContextBreakdown;
  readonly exports: SessionExports;

  constructor(session: AgentSession) {
    this.transcript = new SessionTranscript(session);
    this.tree = new SessionTree(session);
    this.bash = new SessionBash(session);
    this.stats = new SessionStats(session);
    this.breakdown = new SessionContextBreakdown(session);
    this.exports = new SessionExports(session);
  }
}
