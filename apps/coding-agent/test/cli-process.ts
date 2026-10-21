import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, ManagedRuntime, Stream } from "effect";
import { ChildProcess } from "effect/process";

import config from "../src/config.ts";
import type cliProcessTypes from "./cli-process.types.ts";

const { ENV_AGENT_DIR } = config;

const { resolvePath } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);

const cliPath = resolvePath(import.meta.dirname, "../src/cli.ts");

const sourceResolverUrl = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const runCli = (
  args: readonly string[],
  options: cliProcessTypes.Options,
): Promise<cliProcessTypes.Result> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(
          process.execPath,
          ["--import", sourceResolverUrl, cliPath, ...args],
          {
            cwd: options.cwd,
            env: {
              [ENV_AGENT_DIR]: options.agentDir,
              ...(options.offline === false ? {} : { MSA_OFFLINE: "1" }),
            },
            extendEnv: true,
            stderr: "pipe",
            stdin: "ignore",
            stdout: "pipe",
          },
        );
        const { code, stderr, stdout } = yield* Effect.all(
          { code: handle.exitCode, stderr: text(handle.stderr), stdout: text(handle.stdout) },
          { concurrency: "unbounded" },
        );
        return { code: Number(code), stderr, stdout };
      }),
    ).pipe(Effect.timeout(options.timeout ?? "30 seconds"), Effect.orDie),
  );

const cliProcess = {
  runCli,
};

export default cliProcess;
