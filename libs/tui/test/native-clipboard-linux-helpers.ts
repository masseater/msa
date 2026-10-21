import { type TestContext, after, before, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { dual } from "effect/Function";

import platformModule from "../src/platform.ts";
import type nativeClipboardLinuxHelpersTypes from "./native-clipboard-linux-helpers.types.ts";
import testPlatform from "./test-platform.ts";
import type testPlatformTypes from "./test-platform.types.ts";

const { pathOperations } = platformModule;

const { makeTempDirectory, removeRecursive, runCommand, runCommandChecked, startProcess } =
  testPlatform;

const { join } = pathOperations;

const exec = (
  request: nativeClipboardLinuxHelpersTypes.ExecRequest,
): Effect.Effect<{ stdout: string; stderr: string }> => runCommandChecked(request);

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

const native = fileURLToPath(new URL("../native/linux/", import.meta.url));

const supported = process.platform === "linux" && ["arm64", "x64"].includes(process.arch);

const probeDependencies = runCommand({
  args: ["-c", "command -v cc && command -v Xvfb && command -v xclip && pkg-config --exists xcb"],
  file: "sh",
}).pipe(Effect.map(({ exitCode }) => exitCode === 0));

const withDependencies = (register: () => void): Promise<void> =>
  Effect.runPromise(
    Effect.map(
      supported ? probeDependencies.pipe(Effect.orElseSucceed(() => false)) : Effect.succeed(false),
      (available) => {
        if (available) register();
        else it("needs Xvfb, xclip, cc and xcb", { skip: "dependencies are missing" }, () => {});
      },
    ),
  );

const startServer = ({
  t,
  command,
  args,
  env,
}: nativeClipboardLinuxHelpersTypes.ServerRequest): Effect.Effect<{
  server: testPlatformTypes.RunningProcess;
  ready: string;
}> =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context());
    const server = yield* startProcess({ args, command, env });
    t.after(() => runPromise(server.close));
    const ready = yield* server.nextStdout;
    return { ready: ready.trim(), server };
  });

const readClipboard: {
  (
    method: string,
    env: NodeJS.ProcessEnv,
  ): Effect.Effect<nativeClipboardLinuxHelpersTypes.ReaderResult>;
  (
    env: NodeJS.ProcessEnv,
  ): (method: string) => Effect.Effect<nativeClipboardLinuxHelpersTypes.ReaderResult>;
} = dual(
  2,
  (
    method: string,
    env: NodeJS.ProcessEnv,
  ): Effect.Effect<nativeClipboardLinuxHelpersTypes.ReaderResult> =>
    exec({
      args: [
        join(fixtures, "clipboard-reader.ts"),
        join(native, "prebuilds", `linux-${process.arch}`, "linux-platform-x11.node"),
        method,
      ],
      env,
      file: process.execPath,
      timeout: 6000,
    }).pipe(
      Effect.map(
        ({ stdout }) => JSON.parse(stdout) as nativeClipboardLinuxHelpersTypes.ReaderResult,
      ),
    ),
);

const startX11 = (
  t: TestContext,
): Effect.Effect<{ server: testPlatformTypes.RunningProcess; env: NodeJS.ProcessEnv }> =>
  startServer({
    args: ["-displayfd", "1", "-screen", "0", "640x480x24", "-nolisten", "tcp"],
    command: "Xvfb",
    env: process.env,
    t,
  }).pipe(
    Effect.map(({ server, ready }) => ({
      env: { ...process.env, DISPLAY: `:${ready}` },
      server,
    })),
  );

const setClipboard = (request: {
  env: NodeJS.ProcessEnv;
  target: string;
  input: Uint8Array;
}): Effect.Effect<void> =>
  Effect.asVoid(
    runCommandChecked({
      args: ["-selection", "clipboard", "-in", "-t", request.target],
      env: request.env,
      file: "xclip",
      ignoreOutput: true,
      input: request.input,
      timeout: 5000,
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
      args: [
        ...compilerFlags,
        join(fixtures, "clipboard-x11-test.c"),
        "-lxcb",
        "-ldl",
        "-o",
        join(directory, "x11-test"),
      ],
      file: "cc",
    });
    yield* runCommandChecked({
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
      file: "cc",
    });
  });

const useCompiledFixtures = (): nativeClipboardLinuxHelpersTypes.CompiledFixtures => {
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

const nativeClipboardLinuxHelpers = {
  exec,
  fixtures,
  native,
  readClipboard,
  setClipboard,
  startServer,
  startX11,
  supported,
  useCompiledFixtures,
  withDependencies,
};

export default nativeClipboardLinuxHelpers;
