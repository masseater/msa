import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

export interface TempDirUse {
  readonly prefix: string;
  readonly use: (directory: string) => Promise<void>;
}

export const withTempDir = ({ prefix, use }: TempDirUse): Promise<void> =>
  Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
      (directory) => Effect.promise(() => use(directory)),
      (directory) =>
        Effect.sync(() => {
          rmSync(directory, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
        }),
    ),
  );

export const gitBash = (programFiles: string | undefined): string =>
  join(programFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
