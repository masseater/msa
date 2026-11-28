import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";

const { discoverAndLoadExtensions } = loader;

const { awaited } = testing;

const extensionCode = `
		export default function(msa) {
			msa.registerCommand("test", { handler: async () => {} });
		}
	`;

const extensionCodeWithTool = (toolName: string) => `
		import { Type } from "typebox";
		export default function(msa) {
			msa.registerTool({
				name: "${toolName}",
				label: "${toolName}",
				description: "Test tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
			});
		}
	`;

const discoverCleanly = (
  root: { readonly path: string },
  expectedCount: number,
  configuredPaths: string[] = [],
) =>
  Effect.gen(function* () {
    const result = yield* awaited(discoverAndLoadExtensions(configuredPaths, root.path, root.path));
    expect(result.errors).toHaveLength(0);
    expect(result.extensions).toHaveLength(expectedCount);
    return result;
  });

const extensionsDiscoverySupport = {
  discoverCleanly,
  extensionCode,
  extensionCodeWithTool,
};

export default extensionsDiscoverySupport;
