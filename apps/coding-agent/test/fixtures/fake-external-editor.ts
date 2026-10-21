import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const edit = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const capturePath = process.argv[2];
  const filePath = process.argv.at(-1);
  if (typeof capturePath !== "string" || capturePath === "") return 1;
  if (typeof filePath !== "string" || filePath === "") return 1;
  const directory = path.dirname(filePath);
  const info = yield* fs.stat(directory);
  const capture = yield* encodeJson({
    content: yield* fs.readFileString(filePath),
    directoryMode: info.mode & 0o777,
    entries: yield* fs.readDirectory(directory),
    filePath,
  });
  yield* fs.writeFileString(capturePath, capture);
  if (process.argv.includes("--fail")) return 1;
  yield* fs.writeFileString(filePath, process.argv.includes("--empty") ? "" : "edited\n");
  return 0;
});

const runtime = ManagedRuntime.make(NodeServices.layer);

runtime.runPromise(edit.pipe(Effect.orDie)).then((code) => {
  process.exitCode = code;
  return code;
});
