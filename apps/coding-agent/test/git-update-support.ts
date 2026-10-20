import testing from "@msa/testing";
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/process";

const { joinPath, provideNode, readTextFile, writeTextFile } = testing;

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const runCommand = (command: string, args: string[], cwd: string): Effect.Effect<string> =>
  provideNode(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(command, args, {
          cwd,
          stderr: "pipe",
          stdin: "ignore",
          stdout: "pipe",
        });
        const { code, stderr, stdout } = yield* Effect.all(
          { code: handle.exitCode, stderr: text(handle.stderr), stdout: text(handle.stdout) },
          { concurrency: "unbounded" },
        );
        if (Number(code) !== 0) {
          return yield* Effect.die(
            new Error(`Command failed: ${command} ${args.join(" ")}\n${stderr}`),
          );
        }
        return stdout.trim();
      }),
    ),
  ).pipe(Effect.orDie);

const git = (args: string[], cwd: string) => runCommand("git", args, cwd);

const initGitRepo = Effect.fn("initGitRepo")(function* (repoDir: string) {
  yield* git(["init", "--initial-branch=main"], repoDir);
  yield* git(["config", "--local", "user.email", "test@test.com"], repoDir);
  yield* git(["config", "--local", "user.name", "Test"], repoDir);
});

const createCommit = Effect.fn("createCommit")(function* (
  repoDir: string,
  filename: string,
  content: string,
  message: string,
) {
  yield* writeTextFile(joinPath(repoDir, filename), content);
  yield* git(["add", filename], repoDir);
  yield* git(["commit", "-m", message], repoDir);
  return yield* git(["rev-parse", "HEAD"], repoDir);
});

const getCurrentCommit = (repoDir: string) => git(["rev-parse", "HEAD"], repoDir);

const getFileContent = (repoDir: string, filename: string) =>
  readTextFile(joinPath(repoDir, filename));

const gitSource = "git:github.com/test/extension";

const gitUpdateSupport = {
  createCommit,
  getCurrentCommit,
  getFileContent,
  git,
  gitSource,
  initGitRepo,
  runCommand,
};

export default gitUpdateSupport;
