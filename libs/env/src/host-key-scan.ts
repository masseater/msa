import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { runSsh, type SshFailure } from "./run-ssh.ts";
import { SetupError } from "./setup-error.ts";
import { sshArgumentsWith, type SshTarget } from "./ssh-args.ts";

const nonEmptyLines = (text: string): string[] =>
  text.split("\n").filter((line) => line.trim() !== "");

const fingerprintsOf = (file: string): Effect.Effect<string[], Error> =>
  Effect.callback<string[], Error>((resume) => {
    const child = spawn("ssh-keygen", ["-lf", file], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resume(Effect.fail(error));
    });
    child.on("close", () => {
      resume(Effect.succeed(nonEmptyLines(output)));
    });
  });

const scanInto = (
  target: SshTarget,
  directory: string,
): Effect.Effect<{ lines: string[]; fingerprints: string[] }, Error | SshFailure> =>
  Effect.gen(function* () {
    const scanned = join(directory, "known_hosts");
    yield* runSsh({
      target,
      command: "exit 0",
      args: sshArgumentsWith(target, { strictHostKeys: false, knownHostsFile: scanned }),
    }).pipe(
      Effect.catchTags({ SshError: () => Effect.void, HostKeyUnknownError: () => Effect.void }),
    );
    const lines = existsSync(scanned)
      ? nonEmptyLines(yield* Effect.promise(() => readFile(scanned, "utf8")))
      : [];
    if (lines.length === 0) {
      return yield* new SetupError(`No host key received from ${target.host}`);
    }
    return { lines, fingerprints: yield* fingerprintsOf(scanned) };
  });

export function scanHostKey(
  target: SshTarget,
): Promise<{ lines: string[]; fingerprints: string[] }> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "msa-env-hostkey-"))),
      (directory) => scanInto(target, directory),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );
}
