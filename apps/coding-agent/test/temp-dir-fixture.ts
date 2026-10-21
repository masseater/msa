import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach } from "vite-plus/test";

const { makeTempDir, removePath, runTest } = testing;

const useTempDir = (prefix: string): Effect.Effect<string> => {
  const created: string[] = [];
  afterEach(() => runTest(Effect.forEach(created.splice(0), removePath, { discard: true })));
  return Effect.tap(makeTempDir(prefix), (dir) => Effect.sync(() => created.push(dir)));
};

const tempDirFixture = { useTempDir };

export default tempDirFixture;
