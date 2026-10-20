import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, vi } from "vite-plus/test";

import rpcMode from "../src/modes/rpc/rpc-mode.ts";
import rpcPromptResponseHost from "./rpc-prompt-response-host.ts";
import type rpcPromptResponseHostTypes from "./rpc-prompt-response-host.types.ts";
import type rpcPromptResponseSupportTypes from "./rpc-prompt-response-support.types.ts";

const { runRpcMode } = rpcMode;

const { createRuntimeHost } = rpcPromptResponseHost;

const { awaited, fromJsonText } = testing;

const parseLine = (line: string): rpcPromptResponseSupportTypes.ParsedOutputLine =>
  Effect.runSync(fromJsonText(line)) as rpcPromptResponseSupportTypes.ParsedOutputLine;

function parseOutputLines(outputLines: string[]): rpcPromptResponseSupportTypes.ParsedOutputLine[] {
  return outputLines
    .flatMap((line) => line.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map(parseLine);
}

const startRpcMode = (
  options: rpcPromptResponseHostTypes.RuntimeHostOptions & {
    io: rpcPromptResponseSupportTypes.RpcIo;
  },
): Effect.Effect<{ lineHandler: (line: string) => void; cleanup: Effect.Effect<void> }> =>
  Effect.gen(function* () {
    const { io, ...hostOptions } = options;
    io.outputLines = [];
    io.lineHandler = undefined;

    const { runtimeHost, cleanup } = yield* createRuntimeHost(hostOptions);
    void runRpcMode(runtimeHost as unknown as Parameters<typeof runRpcMode>[0]);
    yield* awaited(vi.waitFor(() => expect(io.lineHandler).toBeDefined()));

    const lineHandler = io.lineHandler;
    if (lineHandler === undefined) throw new Error("RPC line handler was not installed");

    return { cleanup, lineHandler };
  });

const rpcPromptResponseSupport = {
  parseOutputLines,
  startRpcMode,
};

export default rpcPromptResponseSupport;
