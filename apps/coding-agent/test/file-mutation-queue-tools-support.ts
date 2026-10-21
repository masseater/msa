import testing from "@msa/testing";
import { Effect } from "effect";

const { gate, pathExists, readBytesFile, runTest, sleep } = testing;

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

const fileMutationQueueToolsSupport = {
  accessFile,
  createDeferred,
  delay,
  readFileBuffer,
};

export default fileMutationQueueToolsSupport;
