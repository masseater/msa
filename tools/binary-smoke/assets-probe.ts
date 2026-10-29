import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import { Effect, ManagedRuntime, Schema } from "effect";

import scriptOutput from "../../libs/ai/src/utils/script-output.ts";

const PROBE_IMAGE = "probe.png";
const PROBE_RESULT_FILE = "assets-probe.json";
const RESIZE_LIMITS = { maxHeight: 16, maxWidth: 16 } as const;
const CODEMODE_SCRIPT = "return [6 * 7, typeof process];";

const { ScriptOutput } = scriptOutput;

const runtime = ManagedRuntime.make(scriptOutput.scriptOutputLayer);

const workerResize = (image: Uint8Array) =>
  Effect.tryPromise(() => codingAgent.resizeImageInWorker(image, "image/png", RESIZE_LIMITS)).pipe(
    Effect.catch((cause) => Effect.succeed({ workerFailed: String(cause) })),
  );

const nativeClipboard = Effect.gen(function* () {
  const clipboard = tui.getNativeClipboard();
  if (clipboard === undefined) return { loaded: false };
  const text = yield* Effect.tryPromise(() => clipboard.getText()).pipe(
    Effect.map((value) => typeof value),
    Effect.catch((cause) => Effect.succeed(`failed: ${String(cause)}`)),
  );
  return { loaded: true, text };
});

const collect = Effect.gen(function* () {
  const { files: fs, path } = yield* ScriptOutput;
  const image = yield* fs.readBytes(path.resolve(PROBE_IMAGE));
  const changelog = yield* Effect.promise(() =>
    codingAgent.parseChangelog(codingAgent.getChangelogPath()),
  );
  const resized = yield* Effect.promise(() =>
    codingAgent.resizeImage(image, "image/png", RESIZE_LIMITS),
  );
  return {
    changelog,
    docs: codingAgent.getDocsPath(),
    examples: codingAgent.getExamplesPath(),
    nativeClipboard: yield* nativeClipboard,
    readme: codingAgent.getReadmePath(),
    resized,
    resizedInWorker: yield* workerResize(image),
    themes: codingAgent.getAvailableThemesWithPaths(),
    version: codingAgent.VERSION,
  };
});

const writeResult = (collected: Promise<object>, codemode: unknown) =>
  Effect.gen(function* () {
    const output = yield* ScriptOutput;
    const result = { ...(yield* Effect.promise(() => collected)), codemode };
    yield* output.writeTextFile(
      output.path.resolve(PROBE_RESULT_FILE),
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(result),
    );
  });

const assetsProbe = (msa: codingAgentTypes.ExtensionAPI) => {
  const collected = runtime.runPromise(collect);
  let codemode: unknown = null;
  codingAgent.createCodemodeExtension({ models: false })(msa);
  const scripted = ai.fauxProvider({
    api: "assets-probe-faux",
    models: [{ id: "scripted" }],
    provider: "probe",
  });
  const respond: aiTypes.FauxResponseFactory = () => {
    scripted.appendResponses([respond]);
    return ai.fauxAssistantMessage("Done.");
  };
  scripted.setResponses([
    () =>
      ai.fauxAssistantMessage([ai.fauxToolCall("codemode", { code: CODEMODE_SCRIPT })], {
        stopReason: "toolUse",
      }),
    respond,
  ]);
  msa.registerProvider(scripted.provider);
  msa.on("session_start", () => {
    msa.setActiveTools([...msa.getActiveTools(), "codemode"]);
  });
  msa.on("tool_result", (event) => {
    if (event.toolName === "codemode") {
      const output = event.content.at(-1);
      codemode = { isError: event.isError, output: output?.type === "text" ? output.text : null };
    }
  });
  msa.on("session_shutdown", () => runtime.runPromise(writeResult(collected, codemode)));
};

export default assetsProbe;
