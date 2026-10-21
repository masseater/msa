import { Effect } from "effect";

import type AgentSession from "../../../core/agent-session.ts";
import awaitingModule from "../../../core/awaiting.ts";
import slashCommands from "../../../core/slash-commands.ts";
import type rpcTypesTypes from "../rpc-types.ts";
import type commandHandlersTypes from "./command-handlers.types.ts";
import rpcOutput from "./rpc-output.ts";

const { awaited, awaiting } = awaitingModule;
const { withSkillCommands } = slashCommands;
const { error, success } = rpcOutput;

function sessionState(session: AgentSession): Promise<rpcTypesTypes.RpcSessionState> {
  return Effect.runPromise(
    awaiting(function* () {
      const usage = session.context.stats.getContextUsage();
      const breakdown =
        usage === undefined
          ? undefined
          : yield* awaited(session.context.breakdown.getContextBreakdown());
      const state: rpcTypesTypes.RpcSessionState = {
        autoCompactionEnabled: session.compaction.auto.autoCompactionEnabled,
        followUpMode: session.run.queue.followUpMode,
        isCompacting: session.compaction.manual.isCompacting,
        isStreaming: session.isStreaming,
        messageCount: session.messages.length,
        model: session.model,
        pendingMessageCount: session.run.queue.pendingMessageCount,
        sessionFile: session.sessionFile,
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        steeringMode: session.run.queue.steeringMode,
        thinkingLevel: session.thinkingLevel,
        ...(usage !== undefined && breakdown !== undefined
          ? {
              contextUsage: {
                breakdown,
                contextWindow: usage.contextWindow,
                percent: (breakdown.tokens / usage.contextWindow) * 100,
                tokens: breakdown.tokens,
              },
            }
          : {}),
      };
      return state;
    }),
  );
}

const sessionCommands: commandHandlersTypes.Handlers<
  | "new_session"
  | "switch_session"
  | "fork"
  | "clone"
  | "get_fork_messages"
  | "get_entries"
  | "get_tree"
  | "set_session_name"
  | "get_messages"
  | "get_last_assistant_text"
  | "export_html"
  | "get_session_stats"
  | "get_state"
  | "get_commands"
> = {
  clone: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const leafId = server.session.sessionManager.getLeafId();
        if (leafId === null || leafId === "") {
          return error(id, "clone", "Cannot clone session: no current entry selected");
        }
        const result = yield* awaited(server.runtimeHost.fork(leafId, { position: "at" }));
        if (!result.cancelled) {
          yield* awaited(server.rebindSession());
        }
        return success(id, "clone", { cancelled: result.cancelled });
      }),
    ),
  export_html: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const path = yield* awaited(
          server.session.context.exports.exportToHtml(command.outputPath),
        );
        return success(id, "export_html", { path });
      }),
    ),
  fork: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const result = yield* awaited(server.runtimeHost.fork(command.entryId));
        if (!result.cancelled) {
          yield* awaited(server.rebindSession());
        }
        return success(id, "fork", {
          cancelled: result.cancelled,
          text: result.selectedText,
        });
      }),
    ),
  get_commands: (server, command) => {
    const { id } = command;
    const commands: rpcTypesTypes.RpcSlashCommand[] = [];

    for (const registered of server.session.extensions.binding.extensionRunner.getRegisteredCommands()) {
      commands.push({
        description: registered.description,
        name: registered.invocationName,
        source: "extension",
        sourceInfo: registered.sourceInfo,
      });
    }

    for (const template of server.session.promptTemplates) {
      commands.push({
        description: template.description,
        name: template.name,
        source: "prompt",
        sourceInfo: template.sourceInfo,
      });
    }

    const skills: rpcTypesTypes.RpcSlashCommand[] = server.session.resourceLoader
      .getSkills()
      .skills.map((skill) => ({
        description: skill.description,
        name: skill.name,
        source: "skill",
        sourceInfo: skill.sourceInfo,
      }));

    return success(id, "get_commands", {
      commands: withSkillCommands(commands, skills),
    });
  },
  get_entries: (server, command) => {
    const { id } = command;
    const sessionManager = server.session.sessionManager;
    let entries = sessionManager.getEntries();
    if (command.since !== undefined) {
      const sinceIndex = entries.findIndex((e) => e.id === command.since);
      if (sinceIndex === -1) {
        return error(id, "get_entries", `Entry not found: ${command.since}`);
      }
      entries = entries.slice(sinceIndex + 1);
    }
    return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
  },
  get_fork_messages: (server, command) => {
    const { id } = command;
    const messages = server.session.context.transcript.getUserMessagesForForking();
    return success(id, "get_fork_messages", { messages });
  },
  get_last_assistant_text: (server, command) => {
    const { id } = command;
    const text = server.session.context.transcript.getLastAssistantText();
    return success(id, "get_last_assistant_text", { text });
  },
  get_messages: (server, command) => {
    const { id } = command;
    return success(id, "get_messages", { messages: server.session.messages });
  },
  get_session_stats: (server, command) => {
    const { id } = command;
    const stats = server.session.context.stats.getSessionStats();
    return success(id, "get_session_stats", stats);
  },
  get_state: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        return success(id, "get_state", yield* awaited(sessionState(server.session)));
      }),
    ),
  get_tree: (server, command) => {
    const { id } = command;
    const sessionManager = server.session.sessionManager;
    return success(id, "get_tree", {
      leafId: sessionManager.getLeafId(),
      tree: sessionManager.getTree(),
    });
  },
  new_session: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const options =
          command.parentSession !== undefined && command.parentSession !== ""
            ? { parentSession: command.parentSession }
            : undefined;
        const result = yield* awaited(server.runtimeHost.newSession(options));
        if (!result.cancelled) {
          yield* awaited(server.rebindSession());
        }
        return success(id, "new_session", result);
      }),
    ),
  set_session_name: (server, command) => {
    const { id } = command;
    const name = command.name.trim();
    if (name === "") {
      return error(id, "set_session_name", "Session name cannot be empty");
    }
    server.session.context.transcript.setSessionName(name);
    return success(id, "set_session_name");
  },
  switch_session: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const result = yield* awaited(server.runtimeHost.switchSession(command.sessionPath));
        if (!result.cancelled) {
          yield* awaited(server.rebindSession());
        }
        return success(id, "switch_session", result);
      }),
    ),
};

export default sessionCommands;
