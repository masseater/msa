import { awaited, fromJsonText } from "@msa/testing";
import { Effect } from "effect";
import { expect, vi } from "vite-plus/test";

import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createRuntimeHost, type RuntimeHostOptions } from "./rpc-prompt-response-host.ts";

export interface RpcIo {
  outputLines: string[];
  lineHandler: ((line: string) => void) | undefined;
}

export type ParsedOutputLine = Record<string, unknown>;

const parseLine = (line: string): ParsedOutputLine =>
  Effect.runSync(fromJsonText(line)) as ParsedOutputLine;

export function parseOutputLines(outputLines: string[]): ParsedOutputLine[] {
  return outputLines
    .flatMap((line) => line.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map(parseLine);
}

export const startRpcMode = (
  options: RuntimeHostOptions & { io: RpcIo },
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

    return { lineHandler, cleanup };
  });
