import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Config,
  ConfigProvider,
  Crypto,
  Effect,
  FileSystem,
  ManagedRuntime,
  Option,
  Path,
  Predicate,
  Stream,
} from "effect";
import { Hex } from "effect/encoding";
import { dual } from "effect/Function";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type platformTypes from "./platform.types.ts";

const services = ManagedRuntime.make(NodeServices.layer);

const provideNodeServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(services.contextEffect, (context) => Effect.provideContext(effect, context));

const useFileSystem = <A, E>(
  use: (fileSystem: FileSystem.FileSystem) => Effect.Effect<A, E>,
): Effect.Effect<A> =>
  provideNodeServices(FileSystem.FileSystem.use(use)).pipe(Effect.orDie) as Effect.Effect<A>;

const nodePath = services.runSync(Path.Path);

const pathOperations: platformTypes.PathOperations = {
  basename: (path, suffix) => nodePath.basename(path, suffix),
  dirname: (path) => nodePath.dirname(path),
  isAbsolute: (path) => nodePath.isAbsolute(path),
  join: (...segments) => nodePath.join(...segments),
  relative: (from, to) => nodePath.relative(from, to),
  resolve: (...segments) => nodePath.resolve(...segments),
  separator: nodePath.sep,
};

const entryKind = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<platformTypes.EntryKind, never> =>
  fileSystem.readLink(path).pipe(
    Effect.as<platformTypes.EntryKind>("symlink"),
    Effect.catch(() =>
      fileSystem.stat(path).pipe(
        Effect.map((info): platformTypes.EntryKind => {
          if (info.type === "Directory") return "directory";
          if (info.type === "File") return "file";
          return "other";
        }),
      ),
    ),
    Effect.orDie,
  );

const files = {
  chmod: (path: string, mode: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.chmod(path, mode)),
  chown: (path: string, uid: number, gid: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.chown(path, uid, gid)),
  copy: (from: string, to: string): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.copy(from, to)),
  copyFile: (from: string, to: string): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.copyFile(from, to)),
  exists: (path: string): Effect.Effect<boolean> =>
    useFileSystem((fileSystem) => fileSystem.exists(path)),
  glob: (pattern: string, root: string): Effect.Effect<string[]> =>
    useFileSystem((fileSystem) => fileSystem.glob(pattern, { root })),
  kind: (path: string): Effect.Effect<platformTypes.EntryKind> =>
    useFileSystem((fileSystem) => entryKind(fileSystem, path)),
  makeDirectory: (path: string, mode?: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.makeDirectory(path, { mode, recursive: true })),
  makeTempDirectory: (prefix: string): Effect.Effect<string> =>
    useFileSystem((fileSystem) => fileSystem.makeTempDirectory({ prefix })),
  ownership: (path: string): Effect.Effect<{ uid: number | undefined; mode: number }> =>
    useFileSystem((fileSystem) =>
      fileSystem
        .stat(path)
        .pipe(Effect.map((info) => ({ mode: info.mode, uid: Option.getOrUndefined(info.uid) }))),
    ),
  probeRead: (path: string): Effect.Effect<platformTypes.ReadProbe> =>
    useFileSystem((fileSystem) =>
      fileSystem.readFile(path).pipe(
        Effect.as<platformTypes.ReadProbe>("readable"),
        Effect.catchIf(
          (error) =>
            Predicate.isTagged(error.reason, "PermissionDenied") ||
            Predicate.isTagged(error.reason, "NotFound"),
          () => Effect.succeed<platformTypes.ReadProbe>("unreadable"),
        ),
      ),
    ),
  readDirectory: (path: string): Effect.Effect<string[]> =>
    useFileSystem((fileSystem) => fileSystem.readDirectory(path)),
  readDirectoryIfPresent: (path: string): Effect.Effect<Option.Option<string[]>> =>
    useFileSystem((fileSystem) =>
      fileSystem.readDirectory(path).pipe(
        Effect.asSome,
        Effect.catchIf(
          (error) => Predicate.isTagged(error.reason, "NotFound"),
          () => Effect.succeedNone,
        ),
      ),
    ),
  readFileString: (path: string): Effect.Effect<string> =>
    useFileSystem((fileSystem) => fileSystem.readFileString(path)),
  remove: (path: string): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.remove(path, { force: true, recursive: true })),
  writeFileString: (path: string, content: string, mode?: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.writeFileString(path, content, { mode })),
};

const sha256Hex = (text: string): Effect.Effect<string> =>
  provideNodeServices(
    Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(text))),
  ).pipe(Effect.map(Hex.encode), Effect.orDie);

const randomUuid: Effect.Effect<string> = provideNodeServices(
  Crypto.Crypto.use((crypto) => crypto.randomUUIDv4),
).pipe(Effect.orDie);

const STDOUT_MODES = { capture: "pipe", ignore: "ignore", inherit: "inherit" } as const;

type CommandOptions = {
  readonly cwd: string;
  readonly output: platformTypes.CommandOutputMode;
  readonly env?: Record<string, string | undefined> | undefined;
};

const runCommand: {
  (
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ): (command: string) => Effect.Effect<platformTypes.CommandResult>;
  (
    command: string,
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ): Effect.Effect<platformTypes.CommandResult>;
} = dual(
  3,
  (
    command: string,
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ): Effect.Effect<platformTypes.CommandResult> =>
    provideNodeServices(
      Effect.scoped(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, [...args], {
              cwd: options.cwd,
              env: options.env,
              extendEnv: true,
              stderr: options.output === "ignore" ? "ignore" : "inherit",
              stdin: options.output === "inherit" ? "inherit" : "ignore",
              stdout: STDOUT_MODES[options.output],
            }),
          );
          const [stdout, exitCode] = yield* Effect.all(
            [
              options.output === "capture"
                ? Stream.mkString(Stream.decodeText(handle.stdout))
                : Effect.succeed(""),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { status: exitCode, stdout };
        }),
      ),
    ).pipe(Effect.orDie),
);

const readEnv = (name: string): string | undefined =>
  Effect.runSync(
    Config.option(Config.String(name))
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
      .pipe(Effect.map(Option.getOrUndefined)),
  );

const platform = {
  files,
  pathOperations,
  randomUuid,
  readEnv,
  runCommand,
  sha256Hex,
};

export default platform;
