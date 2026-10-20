import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import cliProcess from "./cli-process.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  readTextFile,
  realPath,
  removeDirs,
  runTest,
  writeTextFile,
} = testing;

const { runCli } = cliProcess;

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const createTempDir = Effect.fn("createTempDir")(function* () {
  const dir = yield* realPath(yield* makeTempDir("msa-session-file-invalid-"));
  tempDirs.push(dir);
  return dir;
});

const printsAFriendlyErrorAndPreservesNon = () =>
  runTest(
    Effect.gen(function* () {
      const tempRoot = yield* createTempDir();
      const agentDir = joinPath(tempRoot, "agent");
      const projectDir = joinPath(tempRoot, "project");
      const sessionFile = joinPath(tempRoot, "not-a-session.log");
      const originalContent = '{"type":"event","data":"not a session"}\n';
      yield* makeDirectory(agentDir);
      yield* makeDirectory(projectDir);
      yield* writeTextFile(sessionFile, originalContent);

      const result = yield* awaited(
        runCli(["--session", sessionFile, "-p", "hi"], { agentDir, cwd: projectDir }),
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        `Error: Session file is not a valid msa session: ${sessionFile}`,
      );
      expect(result.stderr).not.toContain("SessionManager.open");
      expect(result.stderr).not.toContain("at ");
      expect(yield* readTextFile(sessionFile)).toBe(originalContent);
    }),
  );

describe("--session invalid file handling", () => {
  it(
    "prints a friendly error and preserves non-session file content",
    printsAFriendlyErrorAndPreservesNon,
  );
});
