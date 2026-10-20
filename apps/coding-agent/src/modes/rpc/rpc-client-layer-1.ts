import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type jsonEventTypes from "../json-event.types.ts";
import jsonl from "./jsonl.ts";
import type rpcClientInternalTypes from "./rpc-client-internal.types.ts";
import RpcClientLayer0 from "./rpc-client-layer-0.ts";
import type rpcClientTypes from "./rpc-client.types.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { serializeJsonLine } = jsonl;

export default abstract class RpcClientLayer1 extends RpcClientLayer0 {
  stop(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.process === null) return;

        this.stopReadingStdout?.();
        this.stopReadingStdout = null;
        this.process.kill("SIGTERM");

        yield* performed(
          Effect.callback<void>((resume) => {
            this.process?.on("exit", () => resume(Effect.void));
          }).pipe(
            Effect.timeoutOrElse({
              duration: 1000,
              orElse: () =>
                Effect.sync(() => {
                  this.process?.kill("SIGKILL");
                }),
            }),
          ),
        );

        this.process = null;
        this.pendingRequests.clear();
      }, this),
    );
  }

  onEvent(listener: rpcClientTypes.RpcEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  getStderr(): string {
    return this.stderr;
  }

  abort(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "abort" }));
      }, this),
    );
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ mode, type: "set_steering_mode" }));
      }, this),
    );
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ mode, type: "set_follow_up_mode" }));
      }, this),
    );
  }

  setAutoCompaction(enabled: boolean): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.send({ enabled, type: "set_auto_compaction" }));
    }, this);
  }

  setAutoRetry(enabled: boolean): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.send({ enabled, type: "set_auto_retry" }));
    }, this);
  }

  abortRetry(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "abort_retry" }));
      }, this),
    );
  }

  abortBash(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "abort_bash" }));
      }, this),
    );
  }

  getForkMessages(): Effect.Effect<Array<{ entryId: string; text: string }>> {
    return awaitingWith(function* () {
      const response = yield* awaited(this.send({ type: "get_fork_messages" }));
      return this.getData<{ messages: Array<{ entryId: string; text: string }> }>(response)
        .messages;
    }, this);
  }

  setSessionName(name: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ name, type: "set_session_name" }));
      }, this),
    );
  }

  waitForIdle(timeout = 60000): Promise<void> {
    return Effect.runPromise(
      Effect.callback<void>((resume) => {
        const unsubscribe = this.onEvent((event) => {
          if (event.type === "agent_settled") resume(Effect.void);
        });
        return Effect.sync(unsubscribe);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.die(
              new Error(`Timeout waiting for agent to become idle. Stderr: ${this.stderr}`),
            ),
        }),
      ),
    );
  }

  collectEvents(timeout = 60000): Promise<jsonEventTypes.JsonAgentSessionEvent[]> {
    return Effect.runPromise(
      Effect.callback<jsonEventTypes.JsonAgentSessionEvent[]>((resume) => {
        const events: jsonEventTypes.JsonAgentSessionEvent[] = [];
        const unsubscribe = this.onEvent((event) => {
          events.push(event);
          if (event.type === "agent_settled") resume(Effect.succeed(events));
        });
        return Effect.sync(unsubscribe);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error(`Timeout collecting events. Stderr: ${this.stderr}`)),
        }),
      ),
    );
  }

  protected handleLine(line: string): void {
    try {
      const data = JSON.parse(line);

      if (
        data.type === "response" &&
        typeof data.id === "string" &&
        data.id !== "" &&
        this.pendingRequests.has(data.id)
      ) {
        const pending = this.pendingRequests.get(data.id)!;
        this.pendingRequests.delete(data.id);
        pending.resolve(data as rpcTypesTypes.RpcResponse);
        return;
      }

      for (const listener of [...this.eventListeners]) {
        listener(data as jsonEventTypes.JsonAgentSessionEvent);
      }
    } catch {}
  }

  protected createProcessExitError(code: number | null, signal: NodeJS.Signals | null): Error {
    return new Error(
      `Agent process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`,
    );
  }

  protected rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  protected send(
    command: rpcClientInternalTypes.RpcCommandBody,
  ): Promise<rpcTypesTypes.RpcResponse> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const { childProcess, stdin } = this.sendPart2();
        if (childProcess.exitCode !== null) {
          const error = this.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
          this.exitError = error;
          throw error;
        }
        const id = this.sendPart1(stdin);
        const fullCommand = { ...command, id } as rpcTypesTypes.RpcCommand;

        return Effect.callback<rpcTypesTypes.RpcResponse>((resume) => {
          this.pendingRequests.set(id, {
            reject: (error) => resume(Effect.die(error)),
            resolve: (response) => resume(Effect.succeed(response)),
          });

          try {
            stdin.write(serializeJsonLine(fullCommand));
          } catch (error: unknown) {
            const writeError = error instanceof Error ? error : new Error(String(error));
            const pending = this.pendingRequests.get(id);
            this.pendingRequests.delete(id);
            pending?.reject(writeError);
          }
          return Effect.sync(() => {
            this.pendingRequests.delete(id);
          });
        }).pipe(
          Effect.timeoutOrElse({
            duration: 30000,
            orElse: () =>
              Effect.die(
                new Error(
                  `Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`,
                ),
              ),
          }),
        );
      }),
    );
  }

  private sendPart2() {
    const childProcess = this.process;
    const stdin = childProcess?.stdin;
    if (childProcess === null || stdin === undefined || stdin === null) {
      throw new Error("Client not started");
    }
    if (this.exitError !== null) {
      throw this.exitError;
    }
    return { childProcess, stdin };
  }

  protected sendPart1(stdin: { readonly destroyed: boolean; readonly writable: boolean }) {
    if (stdin.destroyed || !stdin.writable) {
      const error = new Error(`Agent process stdin is not writable. Stderr: ${this.stderr}`);
      this.exitError = error;
      throw error;
    }

    const id = `req_${++this.requestId}`;
    return id;
  }

  protected getData<T>(response: rpcTypesTypes.RpcResponse): T {
    if (!response.success) {
      const errorResponse = response as Extract<rpcTypesTypes.RpcResponse, { success: false }>;
      throw new Error(errorResponse.error);
    }
    const successResponse = response as Extract<
      rpcTypesTypes.RpcResponse,
      { success: true; data: unknown }
    >;
    return successResponse.data as T;
  }
}
