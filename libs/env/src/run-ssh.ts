import { spawn } from "node:child_process";

import { Effect } from "effect";

import { HostKeyChangedError } from "./host-key-changed-error.ts";
import { HostKeyUnknownError } from "./host-key-unknown-error.ts";
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

export function runSsh(run: SshRun): Effect.Effect<string, SshFailure> {
  return Effect.suspend(() => {
    const { target } = run;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeoutMs = run.timeoutMs ?? SSH_TIMEOUT_MS;
    const finished = Effect.callback<string, SshFailure>((resume) => {
      const child = spawn(
        target.ssh ?? "ssh",
        [...(run.args ?? sshArguments(target)), run.command],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.stdin.on("error", () => undefined);
      child.on("error", (error) => {
        resume(Effect.fail(new SshError(error.message, null, "")));
      });
      child.on("close", (code) => {
        const diagnostics = Buffer.concat(stderr).toString("utf8");
        resume(
          code === 0
            ? Effect.succeed(Buffer.concat(stdout).toString("utf8"))
            : Effect.fail(exitFailure(target, code, diagnostics)),
        );
      });
      child.stdin.end(run.stdin ?? new Uint8Array(0));
      return Effect.sync(() => {
        child.kill();
      });
    });
    return Effect.timeoutOrElse(finished, {
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
