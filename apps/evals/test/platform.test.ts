import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { readEnv, runCommand } from "../src/platform.ts";

const probeName = "MSA_EVAL_RUN_COMMAND_PROBE";

describe("runCommand", () => {
  it("passes an explicit environment to the child process", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* runCommand(
          process.execPath,
          [
            "--eval",
            `process.stdout.write([process.env.${probeName} ?? "", process.env.PATH ? "inherited" : "isolated"].join("|"))`,
          ],
          { cwd: process.cwd(), output: "capture", env: { [probeName]: "child-only" } },
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("child-only|inherited");
      }),
    ));

  it("leaves the parent environment unchanged", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* runCommand(process.execPath, ["--eval", ""], {
          cwd: process.cwd(),
          output: "ignore",
          env: { [probeName]: "child-only" },
        });
        expect(readEnv(probeName)).toBeUndefined();
      }),
    ));
});
