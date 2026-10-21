import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type commandHandlersTypes from "./command-handlers.types.ts";
import rpcOutput from "./rpc-output.ts";

const { awaited, awaiting } = awaitingModule;
const { error, output, success } = rpcOutput;

const promptingCommands: commandHandlersTypes.Handlers<
  "prompt" | "steer" | "follow_up" | "abort" | "clear_queue" | "bash" | "abort_bash"
> = {
  abort: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        yield* awaited(server.session.run.lifecycle.abort());
        return success(id, "abort");
      }),
    ),
  abort_bash: (server, command) => {
    const { id } = command;
    server.session.context.bash.abortBash();
    return success(id, "abort_bash");
  },
  bash: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const eventResult = yield* awaited(
          server.session.extensions.binding.extensionRunner.emitUserBash({
            command: command.command,
            cwd: server.session.sessionManager.getCwd(),
            excludeFromContext: command.excludeFromContext ?? false,
            type: "user_bash",
          }),
        );

        if (eventResult?.result !== undefined) {
          server.session.context.bash.recordBashResult(command.command, eventResult.result, {
            excludeFromContext: command.excludeFromContext,
          });
          return success(id, "bash", eventResult.result);
        }

        const result = yield* awaited(
          server.session.context.bash.executeBash(command.command, undefined, {
            excludeFromContext: command.excludeFromContext,
            id,
            operations: eventResult?.operations,
          }),
        );
        return success(id, "bash", result);
      }),
    ),
  clear_queue: (server, command) => {
    const { id } = command;
    return success(id, "clear_queue", server.session.run.queue.clearQueue());
  },
  follow_up: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const disposition = yield* awaited(
          server.session.run.queue.followUp(command.message, command.images, {
            source: "rpc",
          }),
        );
        return success(id, "follow_up", { disposition });
      }),
    ),
  prompt: (server, command) => {
    const { id } = command;
    let preflightSucceeded = false;
    void server.session.run.prompting
      .prompt(command.message, {
        images: command.images,
        mode: command.mode,
        preflightResult: (disposition) => {
          preflightSucceeded = true;
          output(success(id, "prompt", { disposition }));
        },
        source: "rpc",
        streamingBehavior: command.streamingBehavior,
      })
      .catch((e) => {
        if (!preflightSucceeded) {
          output(error(id, "prompt", e.message));
        }
      });
    return undefined;
  },
  steer: (server, command) =>
    Effect.runPromise(
      awaiting(function* () {
        const { id } = command;
        const disposition = yield* awaited(
          server.session.run.queue.steer(command.message, command.images, { source: "rpc" }),
        );
        return success(id, "steer", { disposition });
      }),
    ),
};

export default promptingCommands;
