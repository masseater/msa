import { NodeServices } from "@effect/platform-node";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, ManagedRuntime, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import SshError from "./ssh-error.ts";
import type sshOperationsTypes from "./ssh-operations.types.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
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
          return yield* SshError.make({ message: `SSH failed (${exitCode}): ${stderr}` });
        }
        return stdout;
      }),
    );
  });
const runSshText = (request: {
  readonly remote: string;
  readonly command: string;
}): Promise<string> => runtime.runPromise(runSsh(request.remote, request.command));
const sshExec = (remote: string, command: string): Promise<Buffer> =>
  runtime.runPromise(runSsh(remote, command).pipe(Effect.map((stdout) => Buffer.from(stdout))));
const createRemoteReadOps = (
  paths: sshOperationsTypes.RemotePaths,
): codingAgentTypes.ReadOperations => {
  const { remote, remoteCwd, localCwd } = paths;
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    access: (p) =>
      runSshText({ command: `test -r ${JSON.stringify(toRemote(p))}`, remote }).then(
        () => undefined,
      ),
    detectImageMimeType: (p) =>
      runSshText({ command: `file --mime-type -b ${JSON.stringify(toRemote(p))}`, remote }).then(
        (output) => {
          const mime = output.trim();
          return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)
            ? mime
            : null;
        },
        () => null,
      ),
    readFile: (p) => sshExec(remote, `cat ${JSON.stringify(toRemote(p))}`),
  };
};
const createRemoteWriteOps = (
  paths: sshOperationsTypes.RemotePaths,
): codingAgentTypes.WriteOperations => {
  const { remote, remoteCwd, localCwd } = paths;
  const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
  return {
    mkdir: (dir) =>
      runSshText({ command: `mkdir -p ${JSON.stringify(toRemote(dir))}`, remote }).then(
        () => undefined,
      ),
    writeFile: (p, content) => {
      const b64 = Buffer.from(content).toString("base64");
      return runSshText({
        command: `echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(toRemote(p))}`,
        remote,
      }).then(() => undefined);
    },
  };
};
const createRemoteEditOps = (
  paths: sshOperationsTypes.RemotePaths,
): codingAgentTypes.EditOperations => {
  const read = createRemoteReadOps(paths);
  const write = createRemoteWriteOps(paths);
  return { access: read.access, readFile: read.readFile, writeFile: write.writeFile };
};
const abortEffect = (signal: AbortSignal): Effect.Effect<never, SshError> =>
  Effect.callback<never, SshError>((resume) => {
    if (signal.aborted) {
      resume(Effect.fail(SshError.make({ message: "aborted" })));
      return;
    }
    const listener = () => resume(Effect.fail(SshError.make({ message: "aborted" })));
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
          return yield* SshError.make({ message: `timeout:${timeout}` });
        }
        return { exitCode: exitCode.value };
      }),
    );
  });
const createRemoteBashOps = (
  paths: sshOperationsTypes.RemotePaths,
): codingAgentTypes.BashOperations => ({
  exec: (command, cwd, { onData, signal, timeout }) => {
    const remoteCommand = `cd ${JSON.stringify(cwd.replace(paths.localCwd, paths.remoteCwd))} && ${command}`;
    const effect = runRemoteBash({ command: remoteCommand, remote: paths.remote }, onData, timeout);
    return runtime.runPromise(
      signal === undefined ? effect : Effect.raceFirst(effect, abortEffect(signal)),
    );
  },
});

const sshOperations = {
  createRemoteBashOps,
  createRemoteEditOps,
  createRemoteReadOps,
  createRemoteWriteOps,
  runSshText,
};

export default sshOperations;
