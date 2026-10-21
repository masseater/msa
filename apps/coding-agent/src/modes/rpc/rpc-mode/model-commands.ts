import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type commandHandlersTypes from "./command-handlers.types.ts";
import rpcOutput from "./rpc-output.ts";

const { awaited, awaiting } = awaitingModule;
const { error, success } = rpcOutput;

const modelCommands: commandHandlersTypes.Handlers<
  | "set_model"
  | "cycle_model"
  | "get_available_models"
  | "set_thinking_level"
  | "cycle_thinking_level"
  | "get_available_thinking_levels"
  | "set_steering_mode"
  | "set_follow_up_mode"
  | "compact"
  | "set_auto_compaction"
  | "set_auto_retry"
  | "abort_retry"
> = {
  abort_retry: (server, command) => {
    const { id } = command;
    server.session.run.retry.abortRetry();
    return success(id, "abort_retry");
  },
  compact: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const result = yield* awaited(
          server.session.compaction.manual.compact(command.customInstructions),
        );
        return success(id, "compact", result);
      }),
    ),
  cycle_model: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const result = yield* awaited(server.session.models.selection.cycleModel());
        if (result === undefined) {
          return success(id, "cycle_model", null);
        }
        return success(id, "cycle_model", result);
      }),
    ),
  cycle_thinking_level: (server, command) => {
    const { id } = command;
    const level = server.session.models.thinking.cycleThinkingLevel();
    if (level === undefined) {
      return success(id, "cycle_thinking_level", null);
    }
    return success(id, "cycle_thinking_level", { level });
  },
  get_available_models: (server, command) => {
    const { id } = command;
    const models = server.session.models.selection.modelRuntime.getAvailableSnapshot();
    return success(id, "get_available_models", { models });
  },
  get_available_thinking_levels: (server, command) => {
    const { id } = command;
    const levels = server.session.models.thinking.getAvailableThinkingLevels();
    return success(id, "get_available_thinking_levels", { levels });
  },
  set_auto_compaction: (server, command) => {
    const { id } = command;
    server.session.compaction.auto.setAutoCompactionEnabled(command.enabled);
    return success(id, "set_auto_compaction");
  },
  set_auto_retry: (server, command) => {
    const { id } = command;
    server.session.run.retry.setAutoRetryEnabled(command.enabled);
    return success(id, "set_auto_retry");
  },
  set_follow_up_mode: (server, command) => {
    const { id } = command;
    server.session.run.queue.setFollowUpMode(command.mode);
    return success(id, "set_follow_up_mode");
  },
  set_model: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const models = server.session.models.selection.modelRuntime.getAvailableSnapshot();
        const model = models.find(
          (m) => m.provider === command.provider && m.id === command.modelId,
        );
        if (model === undefined) {
          return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
        }
        yield* awaited(server.session.models.selection.setModel(model));
        return success(id, "set_model", model);
      }),
    ),
  set_steering_mode: (server, command) => {
    const { id } = command;
    server.session.run.queue.setSteeringMode(command.mode);
    return success(id, "set_steering_mode");
  },
  set_thinking_level: (server, command) => {
    const { id } = command;
    server.session.models.thinking.setThinkingLevel(command.level);
    return success(id, "set_thinking_level");
  },
};

export default modelCommands;
