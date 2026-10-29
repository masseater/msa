import { NodeServices } from "@effect/platform-node";
import { Cause, Context, Effect, FileSystem, Layer, Option, Path, Queue, Stream } from "effect";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import runMain from "../tools/run-main.ts";
import type hostTypes from "./host.types.ts";

const { runMainWith } = runMain;

class Host extends Context.Service<Host, hostTypes.HostShape>()("msa-monorepo/scripts/host") {}

const outputOption = (mode: hostTypes.OutputMode | undefined) => ({ stream: mode ?? "pipe" });

const stdinOption = (
  mode: hostTypes.CommandOptions["stdin"],
  input: Queue.Queue<string, Cause.Done>,
) =>
  mode === "pipe"
    ? { endOnDone: true, stream: Stream.fromQueue(input).pipe(Stream.encodeText) }
    : { stream: mode ?? "ignore" };

const processOptions = (
  options: hostTypes.CommandOptions,
  input: Queue.Queue<string, Cause.Done>,
) => ({
  cwd: options.cwd,
  env: options.env === undefined ? undefined : { ...options.env },
  extendEnv: options.extendEnv ?? true,
  shell: options.shell ?? false,
  stderr: outputOption(options.stderr),
  stdin: stdinOption(options.stdin, input),
  stdout: outputOption(options.stdout),
});

const makeSpawn = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return (
    options: hostTypes.CommandOptions,
  ): Effect.Effect<hostTypes.RunningCommand, never, Scope.Scope> =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<string, Cause.Done>();
      const handle = yield* spawner.spawn(
        ChildProcess.make(options.command, options.args, processOptions(options, input)),
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
    readDirectory: (target: string, options?: { readonly recursive?: boolean }) =>
      fs.readDirectory(target, options).pipe(Effect.orDie),
    readText: (target: string) => fs.readFileString(target).pipe(Effect.orDie),
    remove: (target: string) =>
      fs.remove(target, { force: true, recursive: true }).pipe(Effect.orDie),
    stat: (target: string) =>
      fs.stat(target).pipe(
        Effect.map((info): hostTypes.FileInfo => ({
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
    const run = (options: hostTypes.CommandOptions): Effect.Effect<hostTypes.CommandResult> =>
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

const runScript = runMainWith(hostLayer);

const runScriptWith = <ROut, E>(layer: Layer.Layer<ROut, E>) =>
  runMainWith(Layer.mergeAll(hostLayer, layer));

const host = {
  Host,
  runScript,
  runScriptWith,
};

export default host;
