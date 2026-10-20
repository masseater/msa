import { Effect } from "effect";

import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createHarness } = harnessModule;

const harnesses3: harnessTypes.Harness[] = [];

function setup3() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          extensionFactories: [createCodemodeExtension()],
          initialActiveToolNames: ["codemode"],
        }),
      );
      harnesses3.push(harness);
      return harness;
    }),
  );
}

const increment = `const next = (load("count") ?? 0) + 1;\nstore("count", next);\nreturn next;`;

const agentSessionCodemode2Support = {
  harnesses3,
  increment,
  setup3,
};

export default agentSessionCodemode2Support;
