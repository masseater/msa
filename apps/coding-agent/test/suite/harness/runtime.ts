import testing from "@msa/testing";
import { Effect } from "effect";

const { makeDirectory, makeTempDir, removeDir } = testing;

const createTempDir = (): Promise<string> =>
  Effect.runPromise(
    Effect.flatMap(makeTempDir("msa-suite-"), (tempDir) =>
      Effect.as(makeDirectory(tempDir), tempDir),
    ),
  );

const removeTempDir = (tempDir: string): Promise<void> => Effect.runPromise(removeDir(tempDir));

const runtime = {
  createTempDir,
  removeTempDir,
};

export default runtime;
