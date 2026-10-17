import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { FileSystem } from "effect/FileSystem";
import * as ManagedRuntime from "effect/ManagedRuntime";

const runtime = ManagedRuntime.make(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  NodeFileSystem.layer,
);

export const readFileBytes = (path: string): Promise<Uint8Array> =>
  runtime.runPromise(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
    FileSystem.use((fs) => fs.readFile(path)).pipe(
      Effect.mapError((error) => error.cause ?? error),
    ),
  );
