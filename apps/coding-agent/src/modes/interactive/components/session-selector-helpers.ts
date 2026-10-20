import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Stream } from "effect";
import { ChildProcess } from "effect/process";

import errors from "../../../utils/errors.ts";

const { toErrorMessage } = errors;

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

function deleteSessionFile(
  sessionPath: string,
): Promise<{ ok: boolean; method: "trash" | "unlink"; error?: string }> {
  return nodeRuntime.runPromise(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
      const trashResult = yield* deleteSessionFilePart2(trashArgs);

      const getTrashErrorHint = (): string | null => {
        const parts: string[] = [];
        if (trashResult.spawnError !== undefined) {
          parts.push(trashResult.spawnError);
        }
        const stderr = trashResult.stderr.trim();
        if (stderr !== "") {
          parts.push(stderr.split("\n")[0] ?? stderr);
        }
        if (parts.length === 0) return null;
        return `trash: ${parts.join(" · ").slice(0, 200)}`;
      };

      const exists = yield* fileSystem.exists(sessionPath).pipe(Effect.orElseSucceed(() => false));
      if (trashResult.status === 0 || !exists) {
        return { method: "trash" as const, ok: true };
      }

      return yield* fileSystem.remove(sessionPath).pipe(
        Effect.as({ method: "unlink" as const, ok: true }),
        Effect.catch((err) => {
          const error = deleteSessionFilePart1(err, getTrashErrorHint);
          return Effect.succeed({ error, method: "unlink" as const, ok: false });
        }),
      );
    }),
  );
}

function* deleteSessionFilePart2(trashArgs: string[]) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make("trash", trashArgs, {
        stdin: "ignore",
        stdout: "ignore",
      });
      const [stderr, status] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
        { concurrency: 2 },
      );
      return { spawnError: undefined as string | undefined, status, stderr };
    }),
  ).pipe(
    Effect.catch((failure) =>
      Effect.succeed({ spawnError: toErrorMessage(failure), status: -1, stderr: "" }),
    ),
  );
}

function deleteSessionFilePart1(err: unknown, getTrashErrorHint: () => string | null) {
  const unlinkError = toErrorMessage(err);
  const trashErrorHint = getTrashErrorHint();
  const error =
    trashErrorHint !== null && trashErrorHint !== ""
      ? `${unlinkError} (${trashErrorHint})`
      : unlinkError;
  return error;
}

const sessionSelectorHelpers = {
  deleteSessionFile,
};

export default sessionSelectorHelpers;
