import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import outputGuard from "../../../core/output-guard.ts";
import errors from "../../../utils/errors.ts";
import jsonl from "../jsonl.ts";
import type rpcTypesTypes from "../rpc-types.ts";
import commands from "./commands.ts";
import rpcOutput from "./rpc-output.ts";
import type RpcServer from "./rpc-server.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { waitForRawStdoutBackpressure } = outputGuard;
const { toErrorMessage } = errors;
const { attachJsonlLineReader } = jsonl;
const { handleCommand } = commands;
const { error, output } = rpcOutput;

function isUiResponse(parsed: unknown): parsed is rpcTypesTypes.RpcExtensionUIResponse {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "type" in parsed &&
    parsed.type === "extension_ui_response"
  );
}

function runCommand(server: RpcServer, command: rpcTypesTypes.RpcCommand): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        const response = yield* awaited(handleCommand(server, command));
        if (response !== undefined) {
          output(response);
          yield* awaited(waitForRawStdoutBackpressure());
        }
        yield* performed(server.checkShutdownRequested());
      } catch (commandError: unknown) {
        output(error(command.id, command.type, toErrorMessage(commandError)));
        yield* awaited(waitForRawStdoutBackpressure());
      }
    }),
  );
}

function handleInputLine(server: RpcServer, line: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (parseError: unknown) {
        output(error(undefined, "parse", `Failed to parse command: ${toErrorMessage(parseError)}`));
        yield* awaited(waitForRawStdoutBackpressure());
        return;
      }
      if (isUiResponse(parsed)) {
        server.ui.resolve(parsed);
        return;
      }
      yield* awaited(runCommand(server, parsed as rpcTypesTypes.RpcCommand));
    }),
  );
}

function attachInput(server: RpcServer): () => void {
  const onInputEnd = () => {
    void Effect.runFork(server.shutdown());
  };
  process.stdin.on("end", onInputEnd);
  const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
    void handleInputLine(server, line);
  });
  return () => {
    detachJsonl();
    process.stdin.off("end", onInputEnd);
  };
}

const rpcInput = { attachInput };

export default rpcInput;
