import { makeDirectory, makeTempDir, removeDir } from "@msa/testing";
import { Effect } from "effect";

export const createTempDir = (): Promise<string> =>
  Effect.runPromise(
    Effect.flatMap(makeTempDir("msa-suite-"), (tempDir) =>
      Effect.as(makeDirectory(tempDir), tempDir),
    ),
  );

export const removeTempDir = (tempDir: string): Promise<void> =>
  Effect.runPromise(removeDir(tempDir));
