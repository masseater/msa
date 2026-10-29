import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Cause,
  Console,
  Context,
  Crypto,
  Effect,
  FileSystem,
  Function,
  Layer,
  Option,
  Path,
  Queue,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import htmlDocumentModule from "./html-document.ts";
import scriptCommands from "./script-commands.ts";
import ScriptOutputError from "./script-output-error.ts";
import type scriptOutputTypes from "./script-output.types.ts";

const { writeHtmlFile } = htmlDocumentModule;
const { resolveCommand } = scriptCommands;

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsonl",
  ".map",
  ".md",
  ".mjs",
  ".rb",
  ".ts",
  ".txt",
]);
const TEXT_FILE_NAMES: ReadonlySet<string> = new Set(["SHA256SUMS"]);
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([".png"]);
const HTML_EXTENSIONS: ReadonlySet<string> = new Set([".html"]);
class ScriptOutput extends Context.Service<ScriptOutput, scriptOutputTypes.ScriptOutputShape>()(
  "@msa/ai/utils/script-output/ScriptOutput",
) {}

const refuse = (message: string) => Effect.fail(ScriptOutputError.make({ message }));

const checkDestination = (
  path: Path.Path,
  target: string,
  allowed: scriptOutputTypes.AllowedDestinations,
) => {
  const extension = path.extname(target).toLowerCase();
  if (allowed.extensions.has(extension)) return Effect.void;
  if (allowed.names?.has(path.basename(target)) === true) return Effect.void;
  return refuse(
    HTML_EXTENSIONS.has(extension)
      ? `${target}: write .html files with writeHtmlReport, which takes an HtmlDocument from htmlDocument`
      : `${target}: scripts write only ${[...allowed.extensions].join(" ")} files here`,
  );
};

const checkSameKind = (path: Path.Path, from: string, to: string) => {
  const fromExtension = path.extname(from).toLowerCase();
  if (fromExtension === path.extname(to).toLowerCase()) return Effect.void;
  return refuse(`${to}: keep the ${fromExtension || "missing"} extension of ${from}`);
};

const guarded = <E>(check: Effect.Effect<void, ScriptOutputError>, write: Effect.Effect<void, E>) =>
  Effect.orDie(Effect.andThen(check, write));

const failRead = <A, R>(effect: Effect.Effect<A, { readonly message: string }, R>) =>
  Effect.mapError(effect, (error) => ScriptOutputError.make({ message: error.message }));

const makeFiles = (
  fs: FileSystem.FileSystem,
  crypto: Crypto.Crypto,
): scriptOutputTypes.ScriptFileSystemShape => ({
  chmod: (target, mode) => failRead(fs.chmod(target, mode)),
  exists: (target) => failRead(fs.exists(target)),
  lines: (target) =>
    fs.stream(target).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.mapError((error) => ScriptOutputError.make({ message: error.message })),
    ),
  makeDirectory: (target) => failRead(fs.makeDirectory(target, { recursive: true })),
  makeTempDirectory: (prefix, directory) =>
    failRead(fs.makeTempDirectory(directory === undefined ? { prefix } : { directory, prefix })),
  makeTempDirectoryScoped: (prefix, directory) =>
    failRead(
      fs.makeTempDirectoryScoped(directory === undefined ? { prefix } : { directory, prefix }),
    ),
  readBytes: (target) => failRead(fs.readFile(target)),
  readDirectory: (target, options) => failRead(fs.readDirectory(target, options)),
  readText: (target) => failRead(fs.readFileString(target)),
  remove: (target) => failRead(fs.remove(target, { force: true, recursive: true })),
  sha256Hex: (target) =>
    failRead(
      fs.readFile(target).pipe(
        Effect.flatMap((bytes) => crypto.digest("SHA-256", bytes)),
        Effect.map((digest) =>
          Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
      ),
    ),
  stat: (target) =>
    failRead(
      Effect.map(fs.stat(target), (info) => ({
        birthtimeMs: Option.getOrUndefined(Option.map(info.birthtime, (date) => date.getTime())),
        isDirectory: info.type === "Directory",
        isFile: info.type === "File",
        mtimeMs: Option.getOrUndefined(Option.map(info.mtime, (date) => date.getTime())),
        size: Number(info.size),
      })),
    ),
});

const makePaths = (path: Path.Path): scriptOutputTypes.ScriptPathShape => ({
  basename: (target, suffix) => path.basename(target, suffix),
  dirname: (target) => path.dirname(target),
  extname: (target) => path.extname(target),
  isAbsolute: (target) => path.isAbsolute(target),
  join: (...paths) => path.join(...paths),
  relative: (from, to) => path.relative(from, to),
  resolve: (...segments) => path.resolve(...segments),
  sep: path.sep,
});

const outputOption = (mode: scriptOutputTypes.OutputMode | undefined) => ({
  stream: mode ?? "pipe",
});

const stdinOption = (
  mode: scriptOutputTypes.InputMode | undefined,
  input: Queue.Queue<string, Cause.Done>,
) =>
  mode === "pipe"
    ? { endOnDone: true, stream: Stream.fromQueue(input).pipe(Stream.encodeText) }
    : { stream: mode ?? "ignore" };

const processOptions = (
  input: Queue.Queue<string, Cause.Done>,
  options: scriptOutputTypes.CommandOptions,
  shell: boolean,
) => ({
  cwd: options.cwd,
  env: options.env === undefined ? undefined : { ...options.env },
  extendEnv: options.extendEnv ?? true,
  shell,
  stderr: outputOption(options.stderr),
  stdin: stdinOption(options.stdin, input),
  stdout: outputOption(options.stdout),
});

const makeProcesses = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  path: Path.Path,
): scriptOutputTypes.ScriptProcessShape => {
  const spawn: scriptOutputTypes.ScriptProcessShape["spawn"] = (options) =>
    Effect.gen(function* () {
      const { file, shell } = yield* resolveCommand((target) => path.basename(target), options);
      const input = yield* Queue.unbounded<string, Cause.Done>();
      const handle = yield* spawner.spawn(
        ChildProcess.make(file, options.args, processOptions(input, options, shell)),
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
  return {
    run: (options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const running = yield* spawn(options);
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [running.stdoutText, running.stderrText, running.exitCode],
            { concurrency: "unbounded" },
          );
          return { exitCode, stderr, stdout };
        }),
      ),
    spawn,
  };
};

const makeScriptOutput = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sameKind = (from: string, to: string) => checkSameKind(path, from, to);
  return ScriptOutput.of({
    copyFileTo: (from, to) => guarded(sameKind(from, to), fs.copyFile(from, to)),
    copyTreeTo: (from, to) => guarded(sameKind(from, to), fs.copy(from, to)),
    files: makeFiles(fs, yield* Crypto.Crypto),
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    linkPath: (target, link) => guarded(sameKind(target, link), fs.symlink(target, link)),
    movePath: (from, to) => guarded(sameKind(from, to), fs.rename(from, to)),
    path: makePaths(path),
    processes: makeProcesses(yield* ChildProcessSpawner.ChildProcessSpawner, path),
    writeBinaryFile: (target, data) =>
      guarded(
        checkDestination(path, target, { extensions: BINARY_EXTENSIONS }),
        fs.writeFile(target, data),
      ),
    writeHtmlReport: (target, document) =>
      guarded(
        checkDestination(path, target, { extensions: HTML_EXTENSIONS }),
        writeHtmlFile(fs.writeFileString, target, document),
      ),
    writeTextFile: (target, data) =>
      guarded(
        checkDestination(path, target, { extensions: TEXT_EXTENSIONS, names: TEXT_FILE_NAMES }),
        fs.writeFileString(target, data),
      ),
  });
});

const scriptOutputLayer: Layer.Layer<ScriptOutput> = Layer.effect(
  ScriptOutput,
  makeScriptOutput,
).pipe(Layer.provide(NodeServices.layer));

const runMainWith: {
  <ROut, E2>(
    layer: Layer.Layer<ROut, E2, ScriptOutput>,
  ): <A, E>(program: Effect.Effect<A, E, ROut | ScriptOutput>) => void;
  <A, E, ROut, E2>(
    program: Effect.Effect<A, E, ROut | ScriptOutput>,
    layer: Layer.Layer<ROut, E2, ScriptOutput>,
  ): void;
} = Function.dual(
  2,
  <A, E, ROut, E2>(
    program: Effect.Effect<A, E, ROut | ScriptOutput>,
    layer: Layer.Layer<ROut, E2, ScriptOutput>,
  ): void => {
    const main = Effect.scoped(
      Effect.flatMap(Layer.build(Layer.provideMerge(layer, scriptOutputLayer)), (services) =>
        Effect.provideContext(program, services),
      ),
    );
    NodeRuntime.runMain(main);
  },
);

const print = (text: string): Effect.Effect<void> => Console.log(text);

const printError = (text: string): Effect.Effect<void> => Console.error(text);

const scriptOutput = {
  ScriptOutput,
  print,
  printError,
  runMainWith,
  scriptOutputLayer,
};

export default scriptOutput;
