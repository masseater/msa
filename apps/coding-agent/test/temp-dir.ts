import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach } from "vite-plus/test";

const { awaited, joinPath, makeDirectory, makeTempDir, removeDir, removeDirIfSet, runTest } =
  testing;

interface TempDir {
  path: string;
}

interface AgentDir {
  agentDir: string;
  path: string;
}

const useTempDir = (prefix: string): TempDir => {
  const dir: TempDir = { path: "" };

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        dir.path = yield* makeTempDir(prefix);
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* removeDirIfSet(dir.path);
        dir.path = "";
      }),
    ),
  );

  return dir;
};

const useAgentDir = (prefix: string): AgentDir => {
  const temp = useTempDir(prefix);
  const dir: AgentDir = {
    agentDir: "",
    get path() {
      return temp.path;
    },
  };

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        dir.agentDir = joinPath(temp.path, "agent");
        yield* makeDirectory(dir.agentDir);
      }),
    ),
  );

  return dir;
};

const useRemovedDirs = (): string[] => {
  const dirs: string[] = [];

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        while (dirs.length > 0) yield* removeDir(dirs.pop() ?? "");
      }),
    ),
  );

  return dirs;
};

const useCleanups = (): { cleanup: () => Promise<void> | void }[] => {
  const cleanups: { cleanup: () => Promise<void> | void }[] = [];

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        while (cleanups.length > 0) yield* awaited(cleanups.pop()?.cleanup());
      }),
    ),
  );

  return cleanups;
};

const tempDirKit = {
  useAgentDir,
  useCleanups,
  useRemovedDirs,
  useTempDir,
};

export default tempDirKit;
