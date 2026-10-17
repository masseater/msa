import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Effect, FileSystem, Layer, Option, Path, Predicate } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { BuildHost } from "./build-host-service.ts";
import { Win32BuildError } from "./build-process.ts";

const toBuildError = (error: { readonly message: string }): Win32BuildError =>
  new Win32BuildError({ message: error.message });

const processOperations = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
): Pick<BuildHost["Service"], "commandExists" | "exitCode"> => ({
  commandExists: (command) =>
    spawner
      .exitCode(
        ChildProcess.make(command, ["--version"], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.match({
          onSuccess: () => true,
          onFailure: (error) => !Predicate.isTagged(error.reason, "NotFound"),
        }),
      ),
  exitCode: ({ command, args, cwd, stdio }) =>
    spawner
      .exitCode(
        ChildProcess.make(command, [...args], {
          cwd,
          stdin: stdio,
          stdout: stdio,
          stderr: stdio,
        }),
      )
      .pipe(Effect.mapError(toBuildError)),
});

const makeBuildHost = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return BuildHost.of({
    join: (...segments) => path.join(...segments),
    relative: (from, to) => path.relative(from, to),
    env: (name) =>
      Config.option(Config.NonEmptyString(name)).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      ),
    exists: (file) => fs.exists(file).pipe(Effect.orElseSucceed(() => false)),
    makeDirectory: (dir) =>
      fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(toBuildError)),
    writeFile: (file, contents) =>
      fs.writeFileString(file, contents).pipe(Effect.mapError(toBuildError)),
    installExecutable: (from, to) =>
      fs
        .copyFile(from, to)
        .pipe(Effect.andThen(fs.chmod(to, 0o755)), Effect.mapError(toBuildError)),
    ...processOperations(spawner),
    makeTemporaryDirectory: (prefix) =>
      fs.makeTempDirectoryScoped({ prefix }).pipe(Effect.mapError(toBuildError)),
    outputLines: (command, args) =>
      spawner.lines(ChildProcess.make(command, [...args])).pipe(Effect.mapError(toBuildError)),
  });
});

export const buildHostLayer: Layer.Layer<BuildHost> = Layer.effect(BuildHost, makeBuildHost).pipe(
  Layer.provide(NodeServices.layer),
);
