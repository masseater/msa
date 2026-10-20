import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import jsonCodec from "./json-codec.ts";
import nodeProcess from "./node-process.ts";

const { decodeJson, encodeJson } = jsonCodec;
const { runNode } = nodeProcess;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const aiEntryUrl = new URL("../src/index.ts", import.meta.url).href;
const compatEntryUrl = new URL("../src/compat.ts", import.meta.url).href;
const providersAllUrl = new URL("../src/providers/all.ts", import.meta.url).href;

const SDK_SPECIFIERS = ["@anthropic-ai/sdk", "openai", "@google/genai"];

const probeScript = (action: string) =>
  Effect.gen(function* () {
    const targets = yield* encodeJson(SDK_SPECIFIERS);
    const entry = yield* encodeJson(aiEntryUrl);
    return `
		import { registerHooks } from "node:module";
		const targets = new Set(${targets});
		const loaded = [];
		registerHooks({
			resolve(specifier, context, nextResolve) {
				if (targets.has(specifier)) loaded.push(specifier);
				return nextResolve(specifier, context);
			},
		});
		const mod = await import(${entry});
		${action}
		console.log(JSON.stringify({ loadedSpecifiers: [...new Set(loaded)] }));
	`;
  });

const loadedSdks = (action: string) =>
  Effect.gen(function* () {
    const script = yield* probeScript(action);
    const result = yield* Effect.promise(() =>
      runNode(["--input-type=module", "--eval", script], {
        cwd: packageRoot,
        timeout: "30 seconds",
      }),
    );
    expect(result.exitCode, `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`).toBe(0);
    const lastLine = result.stdout.trim().split(/\r?\n/u).at(-1) ?? "";
    const probe = (yield* decodeJson(lastLine)) as { loadedSpecifiers: string[] };
    return probe.loadedSpecifiers;
  });

const expectLoadedSdks = (action: string, expected: readonly string[]) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(yield* loadedSdks(action)).toEqual(expected);
    }),
  );

const anthropicModelLiteral = `{
	id: "claude-test",
	name: "Claude Test",
	api: "anthropic-messages",
	provider: "anthropic-api",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
}`;

describe("lazy provider module loading", () => {
  it("does not load provider SDKs when importing the root barrel", expectLoadedSdks("", []));
  it(
    "does not load provider SDKs when building all builtin providers",
    expectLoadedSdks(
      `const all = await import("${providersAllUrl}");
			all.builtinModels().getModels();`,
      [],
    ),
  );
  it(
    "does not load provider SDKs when importing the compat entrypoint",
    expectLoadedSdks(`await import("${compatEntryUrl}");`, []),
  );
  it(
    "loads only the Anthropic SDK when streaming through the lazy API wrapper",
    expectLoadedSdks(
      `const compat = await import("${compatEntryUrl}");
			const context = { messages: [{ role: "user", content: "hi" }] };
			await compat.anthropicMessagesApi().streamSimple(${anthropicModelLiteral}, context).result();`,
      ["@anthropic-ai/sdk"],
    ),
  );
  it(
    "loads only the Anthropic SDK when dispatching through streamSimple",
    expectLoadedSdks(
      `const compat = await import("${compatEntryUrl}");
			const model = compat.getModels("anthropic-api").find((candidate) => candidate.api === "anthropic-messages");
			const context = { messages: [{ role: "user", content: "hi" }] };
			await compat.streamSimple(model, context).result();`,
      ["@anthropic-ai/sdk"],
    ),
  );
});
