import { after, before, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { dual } from "effect/Function";

import { pathOperations } from "../src/platform.ts";
import {
  makeTempDirectory,
  removeRecursive,
  runCommand,
  runCommandChecked,
  type RunningProcess,
  startProcess,
} from "./test-platform.ts";

const { join } = pathOperations;

export interface ExecRequest {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  timeout?: number;
}

export interface ServerRequest {
  t: TestContext;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export const exec = (request: ExecRequest): Effect.Effect<{ stdout: string; stderr: string }> =>
  runCommandChecked(request);

export const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

export const native = fileURLToPath(new URL("../native/linux/", import.meta.url));

export const supported = process.platform === "linux" && ["arm64", "x64"].includes(process.arch);

const probeDependencies = runCommand({
  file: "sh",
  args: ["-c", "command -v cc && command -v Xvfb && command -v xclip && pkg-config --exists xcb"],
}).pipe(Effect.map(({ exitCode }) => exitCode === 0));

export const dependenciesAvailable =
  supported && (await Effect.runPromise(probeDependencies.pipe(Effect.orElseSucceed(() => false))));

export interface ReaderResult {
  ok: boolean;
  value?: string | null;
  unavailable?: boolean;
  length?: number;
  hash?: string;
  error?: string;
}

export const startServer = ({
  t,
  command,
  args,
  env,
}: ServerRequest): Effect.Effect<{ server: RunningProcess; ready: string }> =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context());
    const server = yield* startProcess({ command, args, env });
    t.after(() => runPromise(server.close));
    const ready = yield* server.nextStdout;
    return { server, ready: ready.trim() };
  });

export const readClipboard: {
  (method: string, env: NodeJS.ProcessEnv): Effect.Effect<ReaderResult>;
  (env: NodeJS.ProcessEnv): (method: string) => Effect.Effect<ReaderResult>;
} = dual(2, (method: string, env: NodeJS.ProcessEnv): Effect.Effect<ReaderResult> =>
  exec({
    file: process.execPath,
    args: [
      join(fixtures, "clipboard-reader.ts"),
      join(native, "prebuilds", `linux-${process.arch}`, "linux-platform-x11.node"),
      method,
    ],
    env,
    timeout: 6000,
  }).pipe(Effect.map(({ stdout }) => JSON.parse(stdout) as ReaderResult)),
);

export const startX11 = (
  t: TestContext,
): Effect.Effect<{ server: RunningProcess; env: NodeJS.ProcessEnv }> =>
  startServer({
    t,
    command: "Xvfb",
    args: ["-displayfd", "1", "-screen", "0", "640x480x24", "-nolisten", "tcp"],
    env: process.env,
  }).pipe(
    Effect.map(({ server, ready }) => ({
      server,
      env: { ...process.env, DISPLAY: `:${ready}` },
    })),
  );

export const setClipboard = (request: {
  env: NodeJS.ProcessEnv;
  target: string;
  input: Uint8Array;
}): Effect.Effect<void> =>
  Effect.asVoid(
    runCommandChecked({
      file: "xclip",
      args: ["-selection", "clipboard", "-in", "-t", request.target],
      env: request.env,
      input: request.input,
      timeout: 5000,
      ignoreOutput: true,
    }),
  );

const compilerFlags = [
  "-std=c11",
  "-D_POSIX_C_SOURCE=200809L",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-pthread",
];

const compileFixtures = (directory: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* runCommandChecked({
      file: "cc",
      args: [
        ...compilerFlags,
        join(fixtures, "clipboard-x11-test.c"),
        "-lxcb",
        "-ldl",
        "-o",
        join(directory, "x11-test"),
      ],
    });
    yield* runCommandChecked({
      file: "cc",
      args: [
        ...compilerFlags,
        "-shared",
        "-fPIC",
        "-nostdlib",
        ...(process.arch === "arm64" ? ["-mno-outline-atomics"] : []),
        "-Wl,-z,nodelete",
        join(fixtures, "clipboard-worker-test.c"),
        "-ldl",
        "-o",
        join(directory, "worker-test.node"),
      ],
    });
  });

export interface CompiledFixtures {
  readonly directory: () => string;
}

export const useCompiledFixtures = (): CompiledFixtures => {
  let directory = "";
  before(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        directory = yield* makeTempDirectory("msa-clipboard-test-");
        yield* compileFixtures(directory);
      }),
    ),
  );
  after(() => (directory === "" ? undefined : Effect.runPromise(removeRecursive(directory))));
  return { directory: () => directory };
};
