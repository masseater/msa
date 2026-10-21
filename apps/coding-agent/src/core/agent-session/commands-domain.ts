import type AgentSession from "../agent-session.ts";
import SessionBuiltinCommands from "./builtin-commands.ts";
import SessionCommands from "./commands.ts";
import SessionSlashCommands from "./slash-commands.ts";

export default class SessionCommandsDomain {
  readonly dispatch: SessionCommands;
  readonly builtin: SessionBuiltinCommands;
  readonly slash: SessionSlashCommands;

  constructor(session: AgentSession) {
    this.dispatch = new SessionCommands(session);
    this.builtin = new SessionBuiltinCommands(session);
    this.slash = new SessionSlashCommands(session);
  }
}
