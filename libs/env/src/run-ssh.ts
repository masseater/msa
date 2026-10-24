import { Effect, Stream } from "effect";

import HostKeyChangedError from "./host-key-changed-error.ts";
import HostKeyUnknownError from "./host-key-unknown-error.ts";
import platform from "./platform.ts";
import type runSshTypes from "./run-ssh.types.ts";
import sshArgs from "./ssh-args.ts";
import type sshArgsTypes from "./ssh-args.types.ts";
import SshError from "./ssh-error.ts";

const { spawnProcess } = platform;
const { sshArguments } = sshArgs;

const SSH_TIMEOUT_MS = 60_000;

function powershell(script: string): string {
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

function exitFailure(
  target: sshArgsTypes.SshTarget,
  code: number | null,
  diagnostics: string,
): runSshTypes.SshFailure {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/u.test(diagnostics)) {
    return HostKeyChangedError.create(
      `The host key of ${target.host} changed; remove the old key to continue`,
    );
  }
  if (/Host key verification failed|No .* host key is known/u.test(diagnostics)) {
    return HostKeyUnknownError.create(`The host key of ${target.host} is not trusted yet`);
  }
  return SshError.create(
    `ssh ${target.host} failed with exit code ${code}: ${diagnostics.trim()}`,
    code,
    diagnostics,
  );
}

const collect = (target: sshArgsTypes.SshTarget, run: runSshTypes.SshRun, stderr: Uint8Array[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawnProcess({
        args: [...(run.args ?? sshArguments(target)), run.command],
        command: target.ssh ?? "ssh",
        stdin: Stream.make(run.stdin ?? new Uint8Array(0)),
      }).pipe(Effect.mapError((error) => SshError.create(error.message, null, "")));
      const [stdout, , code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.runForEach(child.stderr, (chunk) =>
            Effect.sync(() => {
              stderr.push(chunk);
            }),
          ),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (code === 0) return stdout;
      return yield* exitFailure(target, code, Buffer.concat(stderr).toString("utf8"));
    }),
  );

function runSsh(run: runSshTypes.SshRun): Effect.Effect<string, runSshTypes.SshFailure> {
  return Effect.suspend(() => {
    const { target } = run;
    const stderr: Uint8Array[] = [];
    const timeoutMs = run.timeoutMs ?? SSH_TIMEOUT_MS;
    return Effect.timeoutOrElse(collect(target, run, stderr), {
      duration: timeoutMs,
      orElse: () => {
        const diagnostics = Buffer.concat(stderr).toString("utf8");
        return Effect.fail(
          SshError.create(
            `ssh ${target.host} did not finish within ${timeoutMs / 1000} s: ${diagnostics.trim()}`,
            null,
            diagnostics,
          ),
        );
      },
    });
  });
}

const runSshModule = {
  powershell,
  runSsh,
};

export default runSshModule;
