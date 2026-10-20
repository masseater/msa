import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type nodeChildProcessTypes from "../../../core/platform/node/child-process.types.ts";
import type jsonEventTypes from "../../json-event.types.ts";
import jsonl from "../jsonl.ts";
import type rpcClientInternalTypes from "../rpc-client-internal.types.ts";
import type RpcClient from "../rpc-client.ts";
import type rpcClientTypes from "../rpc-client.types.ts";
import type rpcTypesTypes from "../rpc-types.ts";
import spawnAgent from "./spawn-agent.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { serializeJsonLine, attachJsonlLineReader } = jsonl;

export default class RpcConnection {
  private readonly client: RpcClient;

  constructor(client: RpcClient) {
    this.client = client;
  }

  private process: nodeChildProcessTypes.ChildProcess | null = null;

  private stopReadingStdout: (() => void) | null = null;

  private eventListeners: rpcClientTypes.RpcEventListener[] = [];

  private pendingRequests: Map<
    string,
    { resolve: (response: rpcTypesTypes.RpcResponse) => void; reject: (error: Error) => void }
  > = new Map();

  private requestId = 0;

  private stderr = "";

  private exitError: Error | null = null;

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

  private handleLine(line: string): void {
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

  private createProcessExitError(code: number | null, signal: NodeJS.Signals | null): Error {
    return new Error(
      `Agent process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`,
    );
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  send(command: rpcClientInternalTypes.RpcCommandBody): Promise<rpcTypesTypes.RpcResponse> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const { childProcess, stdin } = this.writableProcess();
        if (childProcess.exitCode !== null) {
          const error = this.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
          this.exitError = error;
          throw error;
        }
        const id = this.nextRequestId(stdin);
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

  private writableProcess() {
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

  private nextRequestId(stdin: { readonly destroyed: boolean; readonly writable: boolean }) {
    if (stdin.destroyed || !stdin.writable) {
      const error = new Error(`Agent process stdin is not writable. Stderr: ${this.stderr}`);
      this.exitError = error;
      throw error;
    }

    const id = `req_${++this.requestId}`;
    return id;
  }

  getData<T>(response: rpcTypesTypes.RpcResponse): T {
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

  start(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.process !== null) {
          throw new Error("Client already started");
        }

        this.exitError = null;

        const childProcess = spawnAgent(this.client.options);
        this.process = childProcess;

        this.watchProcess(childProcess);

        this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout!, (line) => {
          this.handleLine(line);
        });

        yield* performed(Effect.sleep(100));

        if (this.process.exitCode !== null) {
          const error =
            this.exitError ??
            this.createProcessExitError(this.process.exitCode, this.process.signalCode);
          this.exitError = error;
          throw error;
        }
      }, this),
    );
  }

  private watchProcess(childProcess: nodeChildProcessTypes.ChildProcess): void {
    childProcess.stderr?.on("data", (data) => {
      this.stderr += data.toString();
      process.stderr.write(data);
    });

    childProcess.once("exit", (code, signal) => {
      if (this.process !== childProcess) return;
      const error = this.createProcessExitError(code, signal);
      this.exitError = error;
      this.rejectPendingRequests(error);
    });
    childProcess.once("error", (error) => {
      if (this.process !== childProcess) return;
      const processError = new Error(
        `Agent process error: ${error.message}. Stderr: ${this.stderr}`,
      );
      this.exitError = processError;
      this.rejectPendingRequests(processError);
    });
    childProcess.stdin?.on("error", (error) => {
      if (this.process !== childProcess) return;
      const stdinError =
        this.exitError ??
        new Error(`Agent process stdin error: ${error.message}. Stderr: ${this.stderr}`);
      this.exitError = stdinError;
      this.rejectPendingRequests(stdinError);
    });
  }

  request<T>(command: rpcClientInternalTypes.RpcCommandBody): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send(command));
        return this.getData<T>(response);
      }, this),
    );
  }

  command(command: rpcClientInternalTypes.RpcCommandBody): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send(command));
      }, this),
    );
  }

  requestField<T, K extends keyof T>(
    command: rpcClientInternalTypes.RpcCommandBody,
    field: K,
  ): Promise<T[K]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send(command));
        return this.getData<T>(response)[field];
      }, this),
    );
  }
}
