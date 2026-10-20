import { Effect, Stream } from "effect";

import platform from "./platform.ts";
import runSshModule from "./run-ssh.ts";
import type runSshTypes from "./run-ssh.types.ts";
import setupError from "./setup-error.ts";
import sshArgs from "./ssh-args.ts";
import type sshArgsTypes from "./ssh-args.types.ts";

const { fileExists, localPath, makeTempDirectory, readText, removePath, spawnProcess } = platform;
const { runSsh } = runSshModule;
const { sshArgumentsWith } = sshArgs;
const { SetupError } = setupError;

const nonEmptyLines = (text: string): string[] =>
  text.split("\n").filter((line) => line.trim() !== "");

const fingerprintsOf = (file: string): Effect.Effect<string[], Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawnProcess({
        args: ["-lf", file],
        command: "ssh-keygen",
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
  target: sshArgsTypes.SshTarget,
  directory: string,
): Effect.Effect<{ lines: string[]; fingerprints: string[] }, Error | runSshTypes.SshFailure> =>
  Effect.gen(function* () {
    const scanned = localPath.join(directory, "known_hosts");
    yield* runSsh({
      args: sshArgumentsWith(target, { knownHostsFile: scanned, strictHostKeys: false }),
      command: "exit 0",
      target,
    }).pipe(
      Effect.catchTags({ HostKeyUnknownError: () => Effect.void, SshError: () => Effect.void }),
    );
    const lines = (yield* fileExists(scanned)) ? nonEmptyLines(yield* readText(scanned)) : [];
    if (lines.length === 0) {
      return yield* new SetupError(`No host key received from ${target.host}`);
    }
    return { fingerprints: yield* fingerprintsOf(scanned), lines };
  });

function scanHostKey(
  target: sshArgsTypes.SshTarget,
): Promise<{ lines: string[]; fingerprints: string[] }> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      makeTempDirectory("msa-env-hostkey-"),
      (directory) => scanInto(target, directory),
      removePath,
    ),
  );
}

const hostKeyScan = {
  scanHostKey,
};

export default hostKeyScan;
