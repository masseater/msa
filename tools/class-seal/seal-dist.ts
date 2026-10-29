import remapping from "@jridgewell/remapping";
import { Effect, Layer, Schema } from "effect";

import scriptOutput from "../../libs/ai/src/utils/script-output.ts";
import classSealTransform from "./transform.ts";

const { runMainWith } = scriptOutput;
const { ScriptOutput } = scriptOutput;

class SealDistError extends Schema.TaggedError<SealDistError, { readonly brand: unique symbol }>()(
  "SealDistError",
  { message: Schema.String },
) {}

type Runtime = { readonly runtime: string; readonly shared: string };

const sealFile = (root: string, file: string, { runtime, shared }: Runtime) =>
  Effect.gen(function* () {
    const { files: fs } = yield* scriptOutput.ScriptOutput;
    const code = yield* fs.readText(file);
    const sealed = yield* Effect.try({
      catch: (error) => SealDistError.make({ message: String(error) }),
      try: () =>
        classSealTransform.sealModule(code, {
          filename: file,
          module: `src/${classSealTransform.moduleOf(root, file)}`,
          runtime: classSealTransform.relativeSpecifier(file, runtime),
          shared: classSealTransform.relativeSpecifier(file, shared),
        }),
    });
    if (sealed === undefined) return;
    yield* (yield* ScriptOutput).writeTextFile(file, sealed.code);
    const mapFile = `${file}.map`;
    if (!(yield* fs.exists(mapFile))) return;
    const previous = yield* fs.readText(mapFile);
    yield* (yield* ScriptOutput).writeTextFile(
      mapFile,
      remapping([sealed.map.toString(), previous], () => null).toString(),
    );
  });

const compiledFrom = (source: string) =>
  Effect.gen(function* () {
    const { files: fs } = yield* scriptOutput.ScriptOutput;
    return (yield* fs.readDirectory(source, { recursive: true }))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
      .map((file) => file.replace(/\.ts$/u, ".js"));
  });

const sealDist = (root: string, source: string) =>
  Effect.gen(function* () {
    const { files: fs, path } = yield* scriptOutput.ScriptOutput;
    const runtime = path.join(root, "core", "platform", "node", "class-seal.js");
    const shared = path.join(root, "core", "platform", "node", "class-seal-tui.js");
    const candidates = (yield* compiledFrom(source)).map((file) => path.join(root, file));
    const present = yield* Effect.forEach(candidates, (file) => fs.exists(file), {
      concurrency: 32,
    });
    const files = candidates.filter((file, index) => present[index] === true && file !== runtime);
    yield* Effect.forEach(files, (file) => sealFile(root, file, { runtime, shared }), {
      concurrency: 16,
      discard: true,
    });
    yield* scriptOutput.print(`class-seal: ${files.length} files`);
  });

const program = Effect.gen(function* () {
  const [root, source] = process.argv.slice(2);
  if (root === undefined || source === undefined)
    return yield* SealDistError.make({ message: "usage: seal-dist.ts <dist dir> <src dir>" });
  yield* sealDist(root, source);
});

runMainWith(program, Layer.empty);
