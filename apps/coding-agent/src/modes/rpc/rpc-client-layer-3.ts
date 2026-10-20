import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import nodeChildProcess from "../../core/platform/node/child-process.ts";
import processEnv from "../../core/process-env.ts";
import type jsonEventTypes from "../json-event.types.ts";
import jsonl from "./jsonl.ts";
import RpcClientLayer2 from "./rpc-client-layer-2.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { spawn } = nodeChildProcess;
const { envSnapshot } = processEnv;
const { attachJsonlLineReader } = jsonl;

export default abstract class RpcClientLayer3 extends RpcClientLayer2 {
  start(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.process !== null) {
          throw new Error("Client already started");
        }

        this.exitError = null;

        const cliPath = this.options.cliPath ?? "dist/cli.js";
        const args = ["--mode", "rpc"];

        if (this.options.provider !== undefined && this.options.provider !== "") {
          args.push("--provider", this.options.provider);
        }
        if (this.options.model !== undefined && this.options.model !== "") {
          args.push("--model", this.options.model);
        }
        if (this.options.args !== undefined) {
          args.push(...this.options.args);
        }

        const childProcess = spawn("node", [cliPath, ...args], {
          cwd: this.options.cwd,
          env: { ...envSnapshot(), ...this.options.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.process = childProcess;

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

  prompt(
    message: string,
    images?: aiTypes.ImageContent[],
    streamingBehavior?: "steer" | "followUp",
  ): Promise<agentSessionTypes.PromptDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(
          this.send({ images, message, streamingBehavior, type: "prompt" }),
        );
        return this.getData<{ disposition: agentSessionTypes.PromptDisposition }>(response)
          .disposition;
      }, this),
    );
  }

  ask(
    message: string,
    images?: aiTypes.ImageContent[],
  ): Promise<agentSessionTypes.PromptDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(
          this.send({ images, message, mode: "ask", type: "prompt" }),
        );
        return this.getData<{ disposition: agentSessionTypes.PromptDisposition }>(response)
          .disposition;
      }, this),
    );
  }

  steer(
    message: string,
    images?: aiTypes.ImageContent[],
  ): Promise<agentSessionTypes.QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ images, message, type: "steer" }));
        return this.getData<{ disposition: agentSessionTypes.QueuedInputDisposition }>(response)
          .disposition;
      }, this),
    );
  }

  followUp(
    message: string,
    images?: aiTypes.ImageContent[],
  ): Promise<agentSessionTypes.QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ images, message, type: "follow_up" }));
        return this.getData<{ disposition: agentSessionTypes.QueuedInputDisposition }>(response)
          .disposition;
      }, this),
    );
  }

  promptAndWait(
    message: string,
    images?: aiTypes.ImageContent[],
    timeout = 60000,
  ): Promise<jsonEventTypes.JsonAgentSessionEvent[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const eventsPromise = this.collectEvents(timeout);
        yield* awaited(this.prompt(message, images));
        return yield* awaited(eventsPromise);
      }, this),
    );
  }
}
