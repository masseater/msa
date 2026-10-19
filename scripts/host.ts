import { NodeServices } from "@effect/platform-node";
import {
  Cause,
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Queue,
  Stream,
} from "effect";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { runMainWith } from "../tools/run-main.ts";

interface FileInfo {
  readonly birthtimeMs: number | undefined;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly mtimeMs: number | undefined;
  readonly size: number;
}

type InputMode = "ignore" | "inherit" | "pipe";
type OutputMode = "ignore" | "inherit" | "pipe";

interface CommandOptions {
  readonly args: ReadonlyArray<string>;
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly extendEnv?: boolean;
  readonly shell?: boolean;
  readonly stderr?: OutputMode;
  readonly stdin?: InputMode;
  readonly stdout?: OutputMode;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface RunningCommand {
  readonly endInput: Effect.Effect<void>;
  readonly exitCode: Effect.Effect<number>;
  readonly kill: Effect.Effect<void>;
  readonly stderrChunks: Stream.Stream<string>;
  readonly stderrText: Effect.Effect<string>;
  readonly stdoutLines: Stream.Stream<string>;
  readonly stdoutText: Effect.Effect<string>;
  readonly write: (text: string) => Effect.Effect<void>;
}

interface HostShape {
  readonly basename: (path: string, suffix?: string) => string;
  readonly chmod: (path: string, mode: number) => Effect.Effect<void>;
  readonly dirname: (path: string) => string;
  readonly exists: (path: string) => Effect.Effect<boolean>;
  readonly extname: (path: string) => string;
  readonly isAbsolute: (path: string) => boolean;
  readonly join: (...paths: ReadonlyArray<string>) => string;
  readonly lines: (path: string) => Stream.Stream<string>;
  readonly makeDirectory: (path: string) => Effect.Effect<void>;
  readonly makeTempDirectory: (prefix: string) => Effect.Effect<string>;
  readonly readDirectory: (path: string) => Effect.Effect<ReadonlyArray<string>>;
  readonly readText: (path: string) => Effect.Effect<string>;
  readonly relative: (from: string, to: string) => string;
  readonly remove: (path: string) => Effect.Effect<void>;
  readonly resolve: (...segments: ReadonlyArray<string>) => string;
  readonly run: (options: CommandOptions) => Effect.Effect<CommandResult>;
  readonly sep: string;
  readonly spawn: (options: CommandOptions) => Effect.Effect<RunningCommand, never, Scope.Scope>;
  readonly stat: (path: string) => Effect.Effect<FileInfo>;
  readonly writeText: (path: string, data: string) => Effect.Effect<void>;
}

class Host extends Context.Service<Host, HostShape>()("msa-monorepo/scripts/host") {}

const outputOption = (mode: OutputMode | undefined) => ({ stream: mode ?? "pipe" });

const makeSpawn = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return (options: CommandOptions): Effect.Effect<RunningCommand, never, Scope.Scope> =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<string, Cause.Done>();
      const stdin =
        options.stdin === "pipe"
          ? { stream: Stream.fromQueue(input).pipe(Stream.encodeText), endOnDone: true }
          : { stream: options.stdin ?? "ignore" };
      const handle = yield* spawner.spawn(
        ChildProcess.make(options.command, options.args, {
          cwd: options.cwd,
          env: options.env === undefined ? undefined : { ...options.env },
          extendEnv: options.extendEnv ?? true,
          shell: options.shell ?? false,
          stdin,
          stdout: outputOption(options.stdout),
          stderr: outputOption(options.stderr),
        }),
      );
      return {
        endInput: Queue.end(input).pipe(Effect.asVoid),
        exitCode: handle.exitCode.pipe(Effect.map(Number), Effect.orDie),
        kill: handle.kill().pipe(Effect.orDie),
        stderrChunks: handle.stderr.pipe(Stream.decodeText(), Stream.orDie),
        stderrText: handle.stderr.pipe(Stream.decodeText(), Stream.mkString, Effect.orDie),
        stdoutLines: handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.orDie),
        stdoutText: handle.stdout.pipe(Stream.decodeText(), Stream.mkString, Effect.orDie),
        write: (text: string) => Queue.offer(input, text).pipe(Effect.asVoid),
      };
    }).pipe(Effect.orDie);
});

const makeFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return {
    chmod: (target: string, mode: number) => fs.chmod(target, mode).pipe(Effect.orDie),
    exists: (target: string) => fs.exists(target).pipe(Effect.orDie),
    lines: (target: string) =>
      fs.stream(target).pipe(Stream.decodeText(), Stream.splitLines, Stream.orDie),
    makeDirectory: (target: string) =>
      fs.makeDirectory(target, { recursive: true }).pipe(Effect.orDie),
    makeTempDirectory: (prefix: string) => fs.makeTempDirectory({ prefix }).pipe(Effect.orDie),
    readDirectory: (target: string) => fs.readDirectory(target).pipe(Effect.orDie),
    readText: (target: string) => fs.readFileString(target).pipe(Effect.orDie),
    remove: (target: string) =>
      fs.remove(target, { recursive: true, force: true }).pipe(Effect.orDie),
    stat: (target: string) =>
      fs.stat(target).pipe(
        Effect.map((info): FileInfo => ({
          birthtimeMs: Option.getOrUndefined(Option.map(info.birthtime, (date) => date.getTime())),
          isDirectory: info.type === "Directory",
          isFile: info.type === "File",
          mtimeMs: Option.getOrUndefined(Option.map(info.mtime, (date) => date.getTime())),
          size: Number(info.size),
        })),
        Effect.orDie,
      ),
    writeText: (target: string, data: string) =>
      fs.writeFileString(target, data).pipe(Effect.orDie),
  };
});

const makePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  return {
    basename: (target: string, suffix?: string) => path.basename(target, suffix),
    dirname: (target: string) => path.dirname(target),
    extname: (target: string) => path.extname(target),
    isAbsolute: (target: string) => path.isAbsolute(target),
    join: (...paths: ReadonlyArray<string>) => path.join(...paths),
    relative: (from: string, to: string) => path.relative(from, to),
    resolve: (...segments: ReadonlyArray<string>) => path.resolve(...segments),
    sep: path.sep,
  };
});

const hostLayer: Layer.Layer<Host> = Layer.effect(
  Host,
  Effect.gen(function* () {
    const spawn = yield* makeSpawn;
    const run = (options: CommandOptions): Effect.Effect<CommandResult> =>
      Effect.scoped(
        Effect.gen(function* () {
          const running = yield* spawn(options);
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [running.stdoutText, running.stderrText, running.exitCode],
            { concurrency: "unbounded" },
          );
          return { exitCode, stderr, stdout };
        }),
      );
    return Host.of({ ...(yield* makeFiles), ...(yield* makePaths), run, spawn });
  }),
).pipe(Layer.provide(NodeServices.layer));

const scriptLayer = Layer.mergeAll(hostLayer, DateTime.layerCurrentZoneLocal);

const runScript = runMainWith(scriptLayer);

const runScriptWith = <ROut, E>(layer: Layer.Layer<ROut, E>) =>
  runMainWith(Layer.mergeAll(scriptLayer, layer));

export type { CommandOptions, CommandResult, FileInfo, HostShape, RunningCommand };
export { Host, runScript, runScriptWith };
