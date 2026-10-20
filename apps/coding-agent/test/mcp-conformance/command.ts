import { fileURLToPath, pathToFileURL } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess } from "effect/process";

import processEnv from "../../src/core/process-env.ts";

const { envSnapshot } = processEnv;

const runtime = ManagedRuntime.make(NodeServices.layer);

const provideNode = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
  Effect.flatMap(runtime.contextEffect, (context) =>
    Effect.provideContext(effect, context),
  ) as unknown as Effect.Effect<A, E>;

const clientPath = fileURLToPath(new URL("client.ts", import.meta.url));
const resolverUrl = pathToFileURL(
  fileURLToPath(new URL("../../src/experimental/source-resolver.ts", import.meta.url)),
).href;

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const runCommand = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
) => {
  const run = Effect.gen(function* () {
    const handle = yield* ChildProcess.make(command, args, {
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: options.env }),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const [stdout, stderr, code] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        handle.exitCode,
      ],
      { concurrency: 3 },
    );
    return { code: Number(code ?? 1), stderr, stdout } satisfies CommandResult;
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed((): CommandResult => ({ code: 1, stderr: "", stdout: "" })),
  );
  if (options.timeoutMs === undefined) return run;
  return run.pipe(
    Effect.timeout(options.timeoutMs),
    Effect.orElseSucceed((): CommandResult => ({ code: 1, stderr: "timed out", stdout: "" })),
  );
};

const conformanceEnv = (): Record<string, string> => ({
  ...envSnapshot(),
  npm_config_ignore_scripts: "true",
  npm_config_yes: "true",
});

const findFile = (
  dir: string,
  name: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(dir).pipe(Effect.orDie))) return undefined;
    for (const entry of yield* fs.readDirectory(dir).pipe(Effect.orDie)) {
      const entryPath = path.join(dir, entry);
      const info = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => undefined));
      if (info === undefined) continue;
      if (info.type === "File" && entry === name) return entryPath;
      if (info.type === "Directory") {
        const found = yield* findFile(entryPath, name);
        if (found !== undefined && found !== "") return found;
      }
    }
    return undefined;
  });

const prepareLauncher = (
  workDir: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const launcher = path.join(workDir, "msa-client");
    yield* fs
      .writeFileString(
        launcher,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} --import ${shellQuote(resolverUrl)} ${shellQuote(clientPath)} "$@"\n`,
      )
      .pipe(Effect.orDie);
    yield* fs.chmod(launcher, 0o755).pipe(Effect.orDie);
    return launcher;
  });

const command = {
  conformanceEnv,
  findFile: (dir: string, name: string) => provideNode(findFile(dir, name)),
  prepareLauncher: (workDir: string) => provideNode(prepareLauncher(workDir)),
  runCommand: (...args: Parameters<typeof runCommand>) => provideNode(runCommand(...args)),
};

export default command;
