import testing from "@msa/testing";
import { Array as Arr, Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { withEnv } = platform;
const { providerWithApiKey, useModelRegistryFixture } = modelRegistrySupport;
const { awaited, runTest } = testing;

const fixture = useModelRegistryFixture();

const resolvedKeyOf = (apiKey: string, variables: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    yield* fixture.writeRawModelsJson({ "custom-provider": providerWithApiKey(apiKey) });
    const registry = yield* fixture.registry();
    return yield* awaited(registry.getApiKeyForProvider("custom-provider"));
  }).pipe(withEnv(variables));

const ENV_KEY = "TEST_API_KEY_12345";
const NO_ENV = {};
const ENV_VALUE = { [ENV_KEY]: "env-api-key-value" };
const BRACED = ["$", "{TEST_BRACED_API_KEY_12345}"].join("");
const INTERPOLATED = [
  "$",
  "{TEST_INTERPOLATED_PART_A_12345}_$",
  "{TEST_INTERPOLATED_PART_B_12345}",
].join("");

const CASES = [
  [
    "apiKey with ! prefix executes command and uses stdout",
    "!echo test-api-key-from-command",
    NO_ENV,
    "test-api-key-from-command",
  ],
  [
    "apiKey with ! prefix trims whitespace from command output",
    "!echo '  spaced-key  '",
    NO_ENV,
    "spaced-key",
  ],
  [
    "apiKey with ! prefix handles multiline output (uses trimmed result)",
    "!printf 'line1\\nline2'",
    NO_ENV,
    "line1\nline2",
  ],
  ["apiKey with ! prefix returns undefined on command failure", "!exit 1", NO_ENV, undefined],
  [
    "apiKey with ! prefix returns undefined on nonexistent command",
    "!nonexistent-command-12345",
    NO_ENV,
    undefined,
  ],
  ["apiKey with ! prefix returns undefined on empty output", "!printf ''", NO_ENV, undefined],
  ["apiKey with $ prefix resolves to env value", "$" + ENV_KEY, ENV_VALUE, "env-api-key-value"],
  [
    "apiKey with braced env syntax resolves to env value",
    BRACED,
    { TEST_BRACED_API_KEY_12345: "braced-env-api-key-value" },
    "braced-env-api-key-value",
  ],
  [
    "apiKey interpolates braced env references inside literals",
    INTERPOLATED,
    { TEST_INTERPOLATED_PART_A_12345: "left", TEST_INTERPOLATED_PART_B_12345: "right" },
    "left_right",
  ],
  ["apiKey with $$ prefix escapes a leading dollar", "$$" + ENV_KEY, NO_ENV, "$" + ENV_KEY],
  [
    "apiKey with $! escapes a literal bang and still interpolates later env refs",
    "$!literal-$" + ENV_KEY,
    ENV_VALUE,
    "!literal-env-api-key-value",
  ],
  ["plain apiKey is used directly even when it matches an env var", ENV_KEY, ENV_VALUE, ENV_KEY],
  [
    "apiKey as literal value is used directly when not an env var",
    "literal_api_key_value",
    NO_ENV,
    "literal_api_key_value",
  ],
  [
    "apiKey command can use shell features like pipes",
    "!echo 'hello world' | tr ' ' '-'",
    NO_ENV,
    "hello-world",
  ],
] as const;

describe("ModelRegistry", () => {
  describe("API key resolution", () => {
    Arr.forEach(CASES, ([name, apiKey, variables, expected]) => {
      test(name, () =>
        runTest(
          Effect.map(resolvedKeyOf(apiKey, variables), (resolved) => {
            expect(resolved).toBe(expected);
          }),
        ),
      );
    });
  });
});
