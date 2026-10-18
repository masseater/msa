// oxlint-disable-next-line effecttsgo/node-builtin-import -- the condition is a user shell command
import { execFile } from "node:child_process";

import { Effect } from "effect";

function runCondition(command: string, cwd: string): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
    execFile("/bin/sh", ["-c", command], { cwd, timeout: 60_000 }, (error) => {
      resume(Effect.succeed(error === null));
    });
  });
}

export const conditions = { runCondition };
