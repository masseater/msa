import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { Type } from "typebox";

import { createHost, local, method } from "../../src/index.ts";
import { nodeLoader } from "../../src/loader.ts";
import { makeDirectory, removeAll, writeText } from "./platform.ts";

const dir = fileURLToPath(new URL(`../.tmp-plugins-${process.pid}/`, import.meta.url));
const plugins = fileURLToPath(new URL(`../.tmp-plugins-${process.pid}-order/`, import.meta.url));
const chord = new URL("../../src/index.ts", import.meta.url).href;

const Hello = local("t.hello", {
  version: 1,
  input: Type.Object({}),
  members: { greet: method(Type.String(), Type.String()) },
});

const facetSource = `
import { Type } from "typebox";
import { defineFacet, local, method } from ${JSON.stringify(chord)};
import { greeting } from "./greeting.ts";

const Hello = local("t.hello", {
	version: 1,
	input: Type.Object({}),
	members: { greet: method(Type.String(), Type.String()) },
});

export default defineFacet((host) => {
	host.serve(Hello, () => ({ greet: (name) => greeting + " " + name }));
});
`;

const chordSpecifier = JSON.stringify(chord);
const stateFacetSource = `import { defineFacet } from ${chordSpecifier};\nimport { state } from "./state.ts";\nexport const own = state;\nexport default defineFacet(() => {});\n`;

const writeGreeting = (text: string) =>
  writeText(`${dir}greeting.ts`, `export const greeting = ${JSON.stringify(text)};\n`);

const reloadsWithFreshImports = Effect.gen(function* () {
  yield* makeDirectory(dir);
  yield* writeText(`${dir}facet.ts`, facetSource);
  yield* writeGreeting("v1");
  const host = createHost({ self: { kind: "host" }, loader: nodeLoader, onError: () => {} });
  yield* Effect.promise(() => host.load([`${dir}facet.ts`]));
  const ref = host.hold(Hello, {});
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "v1 x");
  yield* writeGreeting("v2");
  const report = yield* Effect.promise(() => host.reload([`${dir}facet.ts`]));
  assert.deepEqual(report.changed, ["t.hello"]);
  assert.equal(yield* Effect.promise(() => ref.greet("x")), "v2 x");
  yield* Effect.promise(() => host.close());

  const Shared = local("t.shared", {
    version: 1,
    input: Type.Object({}),
    members: { same: method(undefined, Type.Boolean()) },
  });
  yield* makeDirectory(`${plugins}a`);
  yield* makeDirectory(`${plugins}b`);
  yield* writeText(`${plugins}b/state.ts`, "export const state = {};\n");
  yield* writeText(`${plugins}b/facet.ts`, stateFacetSource);
  yield* writeText(
    `${plugins}a/facet.ts`,
    `import { Type } from "typebox";\nimport { defineFacet, local, method } from ${chordSpecifier};\nimport { state } from "../b/state.ts";\n` +
      `const Shared = local("t.shared", { version: 1, input: Type.Object({}), members: { same: method(undefined, Type.Boolean()) } });\n` +
      `export default defineFacet((host) => host.serve(Shared, () => ({ same: async () => (await import(new URL("../b/facet.ts", import.meta.url).href)).own === state })));\n`,
  );
  const ordered = createHost({ self: { kind: "host" }, loader: nodeLoader, onError: () => {} });
  yield* Effect.promise(() => ordered.load([`${plugins}a/facet.ts`, `${plugins}b/facet.ts`]));
  assert.equal(yield* Effect.promise(() => ordered.hold(Shared, {}).same()), true);
  yield* Effect.promise(() => ordered.close());
});

await Effect.runPromise(
  reloadsWithFreshImports.pipe(Effect.ensuring(Effect.andThen(removeAll(dir), removeAll(plugins)))),
);
