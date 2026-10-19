import { NodeServices } from "@effect/platform-node";
import type {
  BashOperations,
  EditOperations,
  ReadOperations,
  WriteOperations,
} from "@msa/coding-agent";
import { Data, Effect, ManagedRuntime, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const runtime = ManagedRuntime.make(NodeServices.layer);

export interface RemotePaths {
  readonly remote: string;
  readonly remoteCwd: string;
  readonly localCwd: string;
}

class SshError extends Data.TaggedError("SshError")<{ readonly message: string }> {}

const runSsh = (remote: string, command: string) =>
  Effect.gen(function* () {
    const service = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* service.spawn(
          ChildProcess.make("ssh", [remote, command], { stdin: "ignore" }),
        );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: 3 },
        );
        if (exitCode !== 0) {
          return yield* new SshError({ message: `SSH failed (${exitCode}): ${stderr}` });
        }
        return stdout;
      }),
    );
  });

export const runSshText = (request: {
  readonly remote: string;
  readonly command: string;
}): Promise<string> => runtime.runPromise(runSsh(request.remote, request.command));

const sshExec = (remote: string, command: string): Promise<Buffer> =>
  runtime.runPromise(runSsh(remote, command).pipe(Effect.map((stdout) => Buffer.from(stdout))));

export const createRemoteReadOps = (paths: RemotePaths): ReadOperations => {
  const { remote, remoteCwd, localCwd } = paths;
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    readFile: (p) => sshExec(remote, `cat ${JSON.stringify(toRemote(p))}`),
    access: (p) =>
      runSshText({ remote, command: `test -r ${JSON.stringify(toRemote(p))}` }).then(
        () => undefined,
      ),
    detectImageMimeType: (p) =>
      runSshText({ remote, command: `file --mime-type -b ${JSON.stringify(toRemote(p))}` }).then(
        (output) => {
          const mime = output.trim();
          return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)
            ? mime
            : null;
        },
        () => null,
      ),
  };
};

export const createRemoteWriteOps = (paths: RemotePaths): WriteOperations => {
  const { remote, remoteCwd, localCwd } = paths;
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    writeFile: (p, content) => {
      const b64 = Buffer.from(content).toString("base64");
      return runSshText({
        remote,
        command: `echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(toRemote(p))}`,
      }).then(() => undefined);
    },
    mkdir: (dir) =>
      runSshText({ remote, command: `mkdir -p ${JSON.stringify(toRemote(dir))}` }).then(
        () => undefined,
      ),
  };
};

export const createRemoteEditOps = (paths: RemotePaths): EditOperations => {
  const read = createRemoteReadOps(paths);
  const write = createRemoteWriteOps(paths);
  return { readFile: read.readFile, access: read.access, writeFile: write.writeFile };
};

const abortEffect = (signal: AbortSignal): Effect.Effect<never, SshError> =>
  Effect.callback<never, SshError>((resume) => {
    if (signal.aborted) {
      resume(Effect.fail(new SshError({ message: "aborted" })));
      return;
    }
    const listener = () => resume(Effect.fail(new SshError({ message: "aborted" })));
    signal.addEventListener("abort", listener, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", listener));
  });

const runRemoteBash = (
  request: { remote: string; command: string },
  onData: (data: Buffer) => void,
  timeout: number | undefined,
) =>
  Effect.gen(function* () {
    const service = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* service.spawn(
          ChildProcess.make("ssh", [request.remote, request.command], { stdin: "ignore" }),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(handle.stdout, (chunk) =>
            Effect.sync(() => onData(Buffer.from(chunk))),
          ),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(handle.stderr, (chunk) =>
            Effect.sync(() => onData(Buffer.from(chunk))),
          ),
        );

        const exitCode =
          timeout === undefined
            ? Option.some(yield* handle.exitCode)
            : yield* handle.exitCode.pipe(Effect.timeoutOption(timeout * 1000));

        if (Option.isNone(exitCode)) {
          return yield* new SshError({ message: `timeout:${timeout}` });
        }
        return { exitCode: exitCode.value };
      }),
    );
  });

export const createRemoteBashOps = (paths: RemotePaths): BashOperations => ({
  exec: (command, cwd, { onData, signal, timeout }) => {
    const remoteCommand = `cd ${JSON.stringify(cwd.replace(paths.localCwd, paths.remoteCwd))} && ${command}`;
    const effect = runRemoteBash({ remote: paths.remote, command: remoteCommand }, onData, timeout);
    return runtime.runPromise(
      signal === undefined ? effect : Effect.raceFirst(effect, abortEffect(signal)),
    );
  },
});
