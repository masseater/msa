import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach } from "vite-plus/test";

const { awaited, gate, makeTempDir, pathExists, readBytesFile, removeDirs, runTest, sleep } =
  testing;

const delay = (ms: number): Promise<void> => runTest(sleep(ms));

const createDeferred = (): { promise: Promise<void>; resolve: () => void } => {
  const opened = gate();
  return { promise: opened, resolve: opened.release };
};

const accessFile = (path: string): Promise<void> =>
  runTest(
    Effect.flatMap(pathExists(path), (exists) =>
      exists ? Effect.void : Effect.die(new Error(`ENOENT: no such file, access '${path}'`)),
    ),
  );

const readFileBuffer = (path: string): Promise<Buffer> =>
  runTest(Effect.map(readBytesFile(path), (bytes) => Buffer.from(bytes)));

const resolvesWithin = (promise: Promise<unknown>, ms: number): Promise<boolean> =>
  runTest(awaited(Promise.race([promise.then(() => true), delay(ms).then(() => false)])));

const useTempDirs = (): (() => Promise<string>) => {
  const tempDirs: string[] = [];
  afterEach(() => runTest(removeDirs(tempDirs.splice(0))));
  return () =>
    runTest(
      Effect.gen(function* () {
        const dir = yield* makeTempDir("msa-file-mutation-queue-");
        tempDirs.push(dir);
        return yield* awaited(dir);
      }),
    );
};

const fileMutationQueueToolsSupport = {
  accessFile,
  createDeferred,
  delay,
  readFileBuffer,
  resolvesWithin,
  useTempDirs,
};

export default fileMutationQueueToolsSupport;
