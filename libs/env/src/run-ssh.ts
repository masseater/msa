import { Effect, Stream } from "effect";

import { HostKeyChangedError } from "./host-key-changed-error.ts";
import { HostKeyUnknownError } from "./host-key-unknown-error.ts";
import { spawnProcess } from "./platform.ts";
import { sshArguments, type SshTarget } from "./ssh-args.ts";
import { SshError } from "./ssh-error.ts";

const SSH_TIMEOUT_MS = 60_000;

export type SshFailure = SshError | HostKeyChangedError | HostKeyUnknownError;

export interface SshRun {
  readonly target: SshTarget;
  readonly command: string;
  readonly stdin?: Uint8Array;
  readonly args?: string[];
  readonly timeoutMs?: number;
}

export function powershell(script: string): string {
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

function exitFailure(target: SshTarget, code: number | null, diagnostics: string): SshFailure {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/u.test(diagnostics)) {
    return new HostKeyChangedError(
      `The host key of ${target.host} changed; remove the old key to continue`,
    );
  }
  if (/Host key verification failed|No .* host key is known/u.test(diagnostics)) {
    return new HostKeyUnknownError(`The host key of ${target.host} is not trusted yet`);
  }
  return new SshError(
    `ssh ${target.host} failed with exit code ${code}: ${diagnostics.trim()}`,
    code,
    diagnostics,
  );
}

const collect = (target: SshTarget, run: SshRun, stderr: Uint8Array[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawnProcess({
        command: target.ssh ?? "ssh",
        args: [...(run.args ?? sshArguments(target)), run.command],
        stdin: Stream.make(run.stdin ?? new Uint8Array(0)),
      }).pipe(Effect.mapError((error) => new SshError(error.message, null, "")));
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

export function runSsh(run: SshRun): Effect.Effect<string, SshFailure> {
  return Effect.suspend(() => {
    const { target } = run;
    const stderr: Uint8Array[] = [];
    const timeoutMs = run.timeoutMs ?? SSH_TIMEOUT_MS;
    return Effect.timeoutOrElse(collect(target, run, stderr), {
      duration: timeoutMs,
      orElse: () => {
        const diagnostics = Buffer.concat(stderr).toString("utf8");
        return Effect.fail(
          new SshError(
            `ssh ${target.host} did not finish within ${timeoutMs / 1000} s: ${diagnostics.trim()}`,
            null,
            diagnostics,
          ),
        );
      },
    });
  });
}
