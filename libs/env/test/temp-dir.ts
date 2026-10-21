import { Effect } from "effect";

import platform from "./platform.ts";
import type tempDirTypes from "./temp-dir.types.ts";

const { localPath, makeTempDirectory, removePath } = platform;

const withTempDir = ({ prefix, use }: tempDirTypes.TempDirUse): Promise<void> =>
  Effect.runPromise(
    Effect.acquireUseRelease(
      makeTempDirectory(prefix),
      (directory) => Effect.promise(() => use(directory)),
      removePath,
    ),
  );

const gitBash = (programFiles: string | undefined): string =>
  localPath.join(programFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");

const tempDir = {
  gitBash,
  withTempDir,
};

export default tempDir;
