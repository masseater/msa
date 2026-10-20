import testing from "@msa/testing";
import { Effect } from "effect";

import cli from "../src/extensions/mcp/cli.ts";

const { runMcpCommand } = cli;

const {
  awaited,
  joinPath,
  makeTempDir,
  removePath,
  resolvePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const FIXTURE = resolvePath(
  import.meta.dirname,
  "../../../libs/mcp/test/fixtures/stdio-server.mjs",
);

const dirs: string[] = [];

function run(args: string[], servers: Record<string, unknown> | undefined, dir?: string) {
  return runTest(
    Effect.gen(function* () {
      const agentDir = dir ?? (yield* makeTempDir("msa-mcp-command-"));
      if (!(dir !== undefined && dir.length > 0)) dirs.push(agentDir);
      if (servers !== undefined)
        yield* writeTextFile(
          joinPath(agentDir, "mcp.json"),
          yield* toJsonText({ mcpServers: servers }),
        );
      const output: string[] = [];
      const exitCode = yield* awaited(
        runMcpCommand(args, {
          agentDir,
          cwd: agentDir,
          error: (line) => output.push(line),
          log: (line) => output.push(line),
        }),
      );
      return yield* awaited({ agentDir, exitCode, output: output.join("\n") });
    }),
  );
}

const fixtureServer = { args: [FIXTURE], command: process.execPath };

const parkedServer = { args: [FIXTURE], command: process.execPath, enabled: false };

const servers2: Record<string, unknown> = Object.fromEntries([
  ["fixture", fixtureServer],
  ["broken", { command: "msa-test-missing-mcp-server" }],
  ["parked", parkedServer],
  ["bad", { args: ["no command"] }],
]);

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      while (dirs.length > 0) yield* removePath(dirs.pop() ?? "");
    }),
  );

const mcpCommandSupport = {
  FIXTURE,
  afterEachHook,
  dirs,
  fixtureServer,
  parkedServer,
  run,
  servers2,
};

export default mcpCommandSupport;
