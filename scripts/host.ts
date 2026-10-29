import { Context, Effect, Layer, Stream } from "effect";

import type htmlDocumentTypes from "../libs/ai/src/utils/html-document.types.ts";
import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import type hostTypes from "./host.types.ts";

const { ScriptOutput, print, printError, runMainWith, scriptOutputLayer } = scriptOutput;

class Host extends Context.Service<Host, hostTypes.HostShape>()("msa-monorepo/scripts/host") {}

const makeFiles = Effect.gen(function* () {
  const output = yield* ScriptOutput;
  const fs = output.files;
  return {
    chmod: (target: string, mode: number) => Effect.orDie(fs.chmod(target, mode)),
    exists: (target: string) => Effect.orDie(fs.exists(target)),
    interactive: output.interactive,
    lines: (target: string) => Stream.orDie(fs.lines(target)),
    makeDirectory: (target: string) => Effect.orDie(fs.makeDirectory(target)),
    makeTempDirectory: (prefix: string) => Effect.orDie(fs.makeTempDirectory(prefix)),
    readDirectory: (target: string, options?: { readonly recursive?: boolean }) =>
      Effect.orDie(fs.readDirectory(target, options)),
    readText: (target: string) => Effect.orDie(fs.readText(target)),
    remove: (target: string) => Effect.orDie(fs.remove(target)),
    stat: (target: string) => Effect.orDie(fs.stat(target)),
    writeHtmlReport: (target: string, document: htmlDocumentTypes.HtmlDocument) =>
      output.writeHtmlReport(target, document),
    writeTextFile: (target: string, data: string) => output.writeTextFile(target, data),
  };
});

const hostLayer: Layer.Layer<Host> = Layer.effect(
  Host,
  Effect.gen(function* () {
    const { path, processes } = yield* ScriptOutput;
    return Host.of({ ...(yield* makeFiles), ...path, ...processes });
  }),
).pipe(Layer.provide(scriptOutputLayer));

const runScript = runMainWith(hostLayer);

const runScriptWith = <ROut, E>(layer: Layer.Layer<ROut, E>) =>
  runMainWith(Layer.mergeAll(hostLayer, layer));

const host = {
  Host,
  hostLayer,
  print,
  printError,
  runScript,
  runScriptWith,
};

export default host;
