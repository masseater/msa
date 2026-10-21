import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Effect, FileSystem, Layer, Option, Path, Predicate } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import BuildHost from "./build-host-service.ts";
import buildProcess from "./build-process.ts";
import type buildProcessTypes from "./build-process.types.ts";

const { Win32BuildError } = buildProcess;

const toBuildError = (error: { readonly message: string }): buildProcessTypes.Win32BuildError =>
  new Win32BuildError({ message: error.message });

const processOperations = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
): Pick<BuildHost["Service"], "commandExists" | "exitCode"> => ({
  commandExists: (command) =>
    spawner
      .exitCode(
        ChildProcess.make(command, ["--version"], {
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        }),
      )
      .pipe(
        Effect.match({
          onFailure: (error) => !Predicate.isTagged(error.reason, "NotFound"),
          onSuccess: () => true,
        }),
      ),
  exitCode: ({ command, args, cwd, stdio }) =>
    spawner
      .exitCode(
        ChildProcess.make(command, [...args], {
          cwd,
          stderr: stdio,
          stdin: stdio,
          stdout: stdio,
        }),
      )
      .pipe(Effect.mapError(toBuildError)),
});

const makeBuildHost = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return BuildHost.of({
    env: (name) =>
      Config.option(Config.NonEmptyString(name)).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      ),
    exists: (file) => fs.exists(file).pipe(Effect.orElseSucceed(() => false)),
    installExecutable: (from, to) =>
      fs
        .copyFile(from, to)
        .pipe(Effect.andThen(fs.chmod(to, 0o755)), Effect.mapError(toBuildError)),
    join: (...segments) => path.join(...segments),
    makeDirectory: (dir) =>
      fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(toBuildError)),
    relative: (from, to) => path.relative(from, to),
    writeFile: (file, contents) =>
      fs.writeFileString(file, contents).pipe(Effect.mapError(toBuildError)),
    ...processOperations(spawner),
    makeTemporaryDirectory: (prefix) =>
      fs.makeTempDirectoryScoped({ prefix }).pipe(Effect.mapError(toBuildError)),
    outputLines: (command, args) =>
      spawner.lines(ChildProcess.make(command, [...args])).pipe(Effect.mapError(toBuildError)),
  });
});

const buildHostLayer: Layer.Layer<BuildHost> = Layer.effect(BuildHost, makeBuildHost).pipe(
  Layer.provide(NodeServices.layer),
);

export default buildHostLayer;
