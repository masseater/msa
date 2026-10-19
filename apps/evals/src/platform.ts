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

const services = ManagedRuntime.make(NodeServices.layer);

const provideNodeServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(services.contextEffect, (context) => Effect.provideContext(effect, context));

const useFileSystem = <A, E>(
  use: (fileSystem: FileSystem.FileSystem) => Effect.Effect<A, E>,
): Effect.Effect<A> =>
  provideNodeServices(FileSystem.FileSystem.use(use)).pipe(Effect.orDie) as Effect.Effect<A>;

const nodePath = services.runSync(Path.Path);

export type PathOperations = {
  readonly join: (...segments: ReadonlyArray<string>) => string;
  readonly dirname: (path: string) => string;
  readonly resolve: (...segments: ReadonlyArray<string>) => string;
  readonly relative: (from: string, to: string) => string;
  readonly isAbsolute: (path: string) => boolean;
  readonly basename: (path: string, suffix?: string) => string;
  readonly separator: string;
};

export const pathOperations: PathOperations = {
  join: (...segments) => nodePath.join(...segments),
  dirname: (path) => nodePath.dirname(path),
  resolve: (...segments) => nodePath.resolve(...segments),
  relative: (from, to) => nodePath.relative(from, to),
  isAbsolute: (path) => nodePath.isAbsolute(path),
  basename: (path, suffix) => nodePath.basename(path, suffix),
  separator: nodePath.sep,
};

export type EntryKind = "directory" | "file" | "symlink" | "other";

const entryKind = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<EntryKind, never> =>
  fileSystem.readLink(path).pipe(
    Effect.as<EntryKind>("symlink"),
    Effect.catch(() =>
      fileSystem.stat(path).pipe(
        Effect.map((info): EntryKind => {
          if (info.type === "Directory") return "directory";
          if (info.type === "File") return "file";
          return "other";
        }),
      ),
    ),
    Effect.orDie,
  );

export type ReadProbe = "readable" | "unreadable";

export const files = {
  makeTempDirectory: (prefix: string): Effect.Effect<string> =>
    useFileSystem((fileSystem) => fileSystem.makeTempDirectory({ prefix })),
  makeDirectory: (path: string, mode?: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.makeDirectory(path, { recursive: true, mode })),
  writeFileString: (path: string, content: string, mode?: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.writeFileString(path, content, { mode })),
  readFileString: (path: string): Effect.Effect<string> =>
    useFileSystem((fileSystem) => fileSystem.readFileString(path)),
  remove: (path: string): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.remove(path, { recursive: true, force: true })),
  exists: (path: string): Effect.Effect<boolean> =>
    useFileSystem((fileSystem) => fileSystem.exists(path)),
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
  glob: (pattern: string, root: string): Effect.Effect<string[]> =>
    useFileSystem((fileSystem) => fileSystem.glob(pattern, { root })),
  copy: (from: string, to: string): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.copy(from, to)),
  copyFile: (from: string, to: string): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.copyFile(from, to)),
  ownership: (path: string): Effect.Effect<{ uid: number | undefined; mode: number }> =>
    useFileSystem((fileSystem) =>
      fileSystem
        .stat(path)
        .pipe(Effect.map((info) => ({ uid: Option.getOrUndefined(info.uid), mode: info.mode }))),
    ),
  kind: (path: string): Effect.Effect<EntryKind> =>
    useFileSystem((fileSystem) => entryKind(fileSystem, path)),
  chmod: (path: string, mode: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.chmod(path, mode)),
  chown: (path: string, uid: number, gid: number): Effect.Effect<void> =>
    useFileSystem((fileSystem) => fileSystem.chown(path, uid, gid)),
  probeRead: (path: string): Effect.Effect<ReadProbe> =>
    useFileSystem((fileSystem) =>
      fileSystem.readFile(path).pipe(
        Effect.as<ReadProbe>("readable"),
        Effect.catchIf(
          (error) =>
            Predicate.isTagged(error.reason, "PermissionDenied") ||
            Predicate.isTagged(error.reason, "NotFound"),
          () => Effect.succeed<ReadProbe>("unreadable"),
        ),
      ),
    ),
};

export const sha256Hex = (text: string): Effect.Effect<string> =>
  provideNodeServices(
    Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(text))),
  ).pipe(Effect.map(Hex.encode), Effect.orDie);

export const randomUuid: Effect.Effect<string> = provideNodeServices(
  Crypto.Crypto.use((crypto) => crypto.randomUUIDv4),
).pipe(Effect.orDie);

export type CommandResult = { readonly status: number; readonly stdout: string };

const STDOUT_MODES = { inherit: "inherit", capture: "pipe", ignore: "ignore" } as const;

export type CommandOutputMode = "inherit" | "capture" | "ignore";

type CommandOptions = {
  readonly cwd: string;
  readonly output: CommandOutputMode;
  readonly env?: Record<string, string | undefined> | undefined;
};

export const runCommand: {
  (
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ): (command: string) => Effect.Effect<CommandResult>;
  (
    command: string,
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ): Effect.Effect<CommandResult>;
} = dual(
  3,
  (
    command: string,
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ): Effect.Effect<CommandResult> =>
    provideNodeServices(
      Effect.scoped(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, [...args], {
              cwd: options.cwd,
              env: options.env,
              extendEnv: true,
              stdin: options.output === "inherit" ? "inherit" : "ignore",
              stdout: STDOUT_MODES[options.output],
              stderr: options.output === "ignore" ? "ignore" : "inherit",
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

export const readEnv = (name: string): string | undefined =>
  Effect.runSync(
    Config.option(Config.String(name))
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
      .pipe(Effect.map(Option.getOrUndefined)),
  );
