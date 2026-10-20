import { Effect } from "effect";

import type AgentSession from "../../core/agent-session.ts";
import awaitingModule from "../../core/awaiting.ts";
import outputGuard from "../../core/output-guard.ts";
import errors from "../../utils/errors.ts";
import shell from "../../utils/shell.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { killTrackedDetachedChildren } = shell;
const { waitForRawStdoutBackpressure } = outputGuard;
const { toErrorMessage } = errors;

function* handleCommandPart1(
  session: AgentSession,
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse,
  id: string | undefined,
) {
  const usage = session.getContextUsage();
  const breakdown = usage === undefined ? undefined : yield* awaited(session.getContextBreakdown());
  const state: rpcTypesTypes.RpcSessionState = {
    autoCompactionEnabled: session.autoCompactionEnabled,
    followUpMode: session.followUpMode,
    isCompacting: session.isCompacting,
    isStreaming: session.isStreaming,
    messageCount: session.messages.length,
    model: session.model,
    pendingMessageCount: session.pendingMessageCount,
    sessionFile: session.sessionFile,
    sessionId: session.sessionId,
    sessionName: session.sessionName,
    steeringMode: session.steeringMode,
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
  return success(id, "get_state", state);
}

function runRpcModePart1(
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void,
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse,
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >,
  handleCommand: (
    command: rpcTypesTypes.RpcCommand,
  ) => Promise<rpcTypesTypes.RpcResponse | undefined>,
  checkShutdownRequested: () => Effect.Effect<void>,
) {
  return (line: string) =>
    Effect.runPromise(
      awaiting(function* () {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (parseError: unknown) {
          output(
            error(undefined, "parse", `Failed to parse command: ${toErrorMessage(parseError)}`),
          );
          yield* awaited(waitForRawStdoutBackpressure());
          return;
        }

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "type" in parsed &&
          parsed.type === "extension_ui_response"
        ) {
          const response = parsed as rpcTypesTypes.RpcExtensionUIResponse;
          const pending = pendingExtensionRequests.get(response.id);
          if (pending !== undefined) {
            pendingExtensionRequests.delete(response.id);
            pending.resolve(response);
          }
          return;
        }

        const command = parsed as rpcTypesTypes.RpcCommand;
        yield* runRpcModePart1Part1(handleCommand, command, output, checkShutdownRequested, error);
      }),
    );
}

function* runRpcModePart1Part1(
  handleCommand: (
    command: rpcTypesTypes.RpcCommand,
  ) => Promise<rpcTypesTypes.RpcResponse | undefined>,
  command: rpcTypesTypes.RpcCommand,
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void,
  checkShutdownRequested: () => Effect.Effect<void>,
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse,
) {
  try {
    const response = yield* awaited(handleCommand(command));
    if (response !== undefined) {
      output(response);
      yield* awaited(waitForRawStdoutBackpressure());
    }
    yield* performed(checkShutdownRequested());
  } catch (commandError: unknown) {
    output(error(command.id, command.type, toErrorMessage(commandError)));
    yield* awaited(waitForRawStdoutBackpressure());
  }
}

function runRpcModePart3(
  shutdown: (exitCode?: number, signal?: NodeJS.Signals) => Effect.Effect<never>,
  signalCleanupHandlers: (() => void)[],
  rebindSession: () => Promise<void>,
): Effect.Effect<void> {
  return awaiting(function* () {
    const registerSignalHandlers = (): void => {
      const signals: NodeJS.Signals[] = ["SIGTERM"];
      if (process.platform !== "win32") {
        signals.push("SIGHUP");
      }

      for (const signal of signals) {
        const handler = () => {
          killTrackedDetachedChildren();
          void Effect.runFork(shutdown(signal === "SIGHUP" ? 129 : 143, signal));
        };
        process.on(signal, handler);
        signalCleanupHandlers.push(() => process.off(signal, handler));
      }
    };

    yield* awaited(rebindSession());
    registerSignalHandlers();
  });
}

const rpcModePart2 = {
  handleCommandPart1,
  runRpcModePart1,
  runRpcModePart3,
};

export default rpcModePart2;
