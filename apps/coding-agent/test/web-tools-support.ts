import testing from "@msa/testing";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import type tregTypes from "../src/core/treg.types.ts";

const { awaited, changeMode, joinPath, runTest, writeTextFile } = testing;

const fakeTreg = Effect.fn("fakeTreg")(function* (bin: string, loggedIn: boolean) {
  const path = joinPath(bin, "treg");
  yield* writeTextFile(
    path,
    `#!/bin/sh\necho '{"base_url": "https://treg.to", "logged_in": ${loggedIn}}'\n`,
  );
  yield* changeMode(path, 0o755);
  return path;
});

function cli(result: unknown, status = 200, chargedMicro?: number) {
  return vi.fn<tregTypes.TregRunner>(() =>
    runTest(
      awaited({
        exitCode: status >= 400 ? 1 : 0,
        stderr: "",
        stdout: `${JSON.stringify({
          _treg: {
            call_id: "call-1",
            http_status: status,
            ...(chargedMicro === undefined ? {} : { charged_micro: chargedMicro }),
          },
          result,
        })}\n`,
      }),
    ),
  );
}

function run(
  tool: { execute: (...args: any[]) => Promise<any> },
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return runTest(awaited(tool.execute("call-1", params, signal, undefined, undefined)));
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => block.text ?? "").join("");
}

const webToolsSupport = {
  cli,
  fakeTreg,
  run,
  text,
};

export default webToolsSupport;
