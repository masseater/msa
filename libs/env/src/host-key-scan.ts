import { Effect, Stream } from "effect";

import {
  fileExists,
  localPath,
  makeTempDirectory,
  readText,
  removePath,
  spawnProcess,
} from "./platform.ts";
import { runSsh, type SshFailure } from "./run-ssh.ts";
import { SetupError } from "./setup-error.ts";
import { sshArgumentsWith, type SshTarget } from "./ssh-args.ts";

const nonEmptyLines = (text: string): string[] =>
  text.split("\n").filter((line) => line.trim() !== "");

const fingerprintsOf = (file: string): Effect.Effect<string[], Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawnProcess({
        command: "ssh-keygen",
        args: ["-lf", file],
        stdin: "ignore",
      });
      const [output] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.runDrain(child.stderr),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return nonEmptyLines(output);
    }),
  );

const scanInto = (
  target: SshTarget,
  directory: string,
): Effect.Effect<{ lines: string[]; fingerprints: string[] }, Error | SshFailure> =>
  Effect.gen(function* () {
    const scanned = localPath.join(directory, "known_hosts");
    yield* runSsh({
      target,
      command: "exit 0",
      args: sshArgumentsWith(target, { strictHostKeys: false, knownHostsFile: scanned }),
    }).pipe(
      Effect.catchTags({ SshError: () => Effect.void, HostKeyUnknownError: () => Effect.void }),
    );
    const lines = (yield* fileExists(scanned)) ? nonEmptyLines(yield* readText(scanned)) : [];
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
      makeTempDirectory("msa-env-hostkey-"),
      (directory) => scanInto(target, directory),
      removePath,
    ),
  );
}
