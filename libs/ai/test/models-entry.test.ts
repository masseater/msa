import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import nodeProcess from "./node-process.ts";

const { runNode } = nodeProcess;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceEntry = new URL("../src/models.ts", import.meta.url).href;

const preload = `data:text/javascript,${encodeURIComponent(`
	import { registerHooks } from "node:module";
	const forbidden = [
		"/node_modules/typebox/",
		"/node_modules/@anthropic-ai/sdk/",
		"/node_modules/openai/",
		"/node_modules/@google/genai/",
		"/providers/data/",
		"/models.generated.",
	];
	registerHooks({
		load(url, context, nextLoad) {
			if (forbidden.some((part) => url.includes(part))) {
				throw new Error("Heavy dependency loaded by models entry: " + url);
			}
			return nextLoad(url, context);
		},
	});
`)}`;

const fauxCompletionScript = (entry: string) => `
	import assert from "node:assert/strict";
	import modelsEntry from "${entry}";
	import fauxModule from "@msa/ai/providers/faux";
	const { createModels, createProvider } = modelsEntry;
	const { fauxAssistantMessage, fauxProvider } = fauxModule;
	assert.equal(typeof createProvider, "function");
	const models = createModels();
	assert.deepEqual(models.getModels(), []);
	assert.deepEqual(models.getProviders(), []);
	const faux = fauxProvider();
	models.setProvider(faux.provider);
	faux.setResponses([fauxAssistantMessage("OK")]);
	const response = await models.completeSimple(faux.getModel(), { messages: [] });
	assert.equal(response.stopReason, "stop");
	assert.deepEqual(response.content, [{ type: "text", text: "OK" }]);
`;

const runsFauxCompletion = (entry: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        runNode(
          ["--import", preload, "--input-type=module", "--eval", fauxCompletionScript(entry)],
          {
            cwd: packageRoot,
            timeout: "10 seconds",
          },
        ),
      );
      expect(result.exitCode, result.stderr).toBe(0);
    }),
  );

describe("lightweight models entry", () => {
  it.each([sourceEntry, "@msa/ai/models"])(
    "runs a faux completion without TypeBox, catalogs, or SDKs through %s",
    runsFauxCompletion,
  );
});
