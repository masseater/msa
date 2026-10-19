import { Effect } from "effect";

import { localPath, makeTempDirectory, removePath } from "./platform.ts";

export interface TempDirUse {
  readonly prefix: string;
  readonly use: (directory: string) => Promise<void>;
}

export const withTempDir = ({ prefix, use }: TempDirUse): Promise<void> =>
  Effect.runPromise(
    Effect.acquireUseRelease(
      makeTempDirectory(prefix),
      (directory) => Effect.promise(() => use(directory)),
      removePath,
    ),
  );

export const gitBash = (programFiles: string | undefined): string =>
  localPath.join(programFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
