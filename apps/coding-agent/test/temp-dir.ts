import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach } from "vite-plus/test";

import type tempDirTypes from "./temp-dir.types.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, removeDir, removeDirIfSet, runTest } =
  testing;

const useTempDir = (prefix: string): tempDirTypes.TempDir => {
  const dir: tempDirTypes.TempDir = { path: "" };

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

const useSubdirectory = (temp: tempDirTypes.TempDir, name: string): tempDirTypes.TempDir => {
  const sub: tempDirTypes.TempDir = { path: "" };

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        sub.path = joinPath(temp.path, name);
        yield* makeDirectory(sub.path);
      }),
    ),
  );

  return sub;
};

const useAgentDir = (prefix: string): tempDirTypes.AgentDir => {
  const temp = useTempDir(prefix);
  const agent = useSubdirectory(temp, "agent");
  return {
    get agentDir() {
      return agent.path;
    },
    get path() {
      return temp.path;
    },
  };
};

const useExtensionsDir = (prefix: string): tempDirTypes.ExtensionsDir => {
  const temp = useTempDir(prefix);
  const extensions = useSubdirectory(temp, "extensions");
  return {
    get extensionsDir() {
      return extensions.path;
    },
    get path() {
      return temp.path;
    },
  };
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
  useExtensionsDir,
  useRemovedDirs,
  useTempDir,
};

export default tempDirKit;
