import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import cliProcess from "./cli-process.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, pathExists, realPath, removeDirs, runTest } =
  testing;
const { runCli } = cliProcess;

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const inspectWith = (flag: string) =>
  runTest(
    Effect.gen(function* () {
      const root = yield* realPath(yield* makeTempDir("msa-inspect-db-"));
      tempDirs.push(root);
      const agentDir = joinPath(root, "agent");
      const cwd = joinPath(root, "project");
      yield* makeDirectory(agentDir);
      yield* makeDirectory(cwd);
      const { code } = yield* awaited(runCli([flag], { agentDir, cwd }));
      expect(code).toBe(0);
      expect(yield* pathExists(joinPath(agentDir, "orchestrator.db"))).toBe(false);
    }),
  );

it("does not open the orchestrator database for --help", () => inspectWith("--help"));

it("does not open the orchestrator database for --list-models", () => inspectWith("--list-models"));
