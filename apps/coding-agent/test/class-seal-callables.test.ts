import { expect, it } from "vite-plus/test";

import classSealVariants from "./class-seal-variants.ts";

const { kinds, outcomesOf, staticallyPassed } = classSealVariants;

const reachRoutes = [
  "cast",
  "direct",
  "dynamic-proto-key",
  "external-subclass",
  "function-prototype",
  "iife",
  "live-binding",
  "map-registry",
  "mixin",
  "prototype-after",
  "proxy",
  "proxy-prototype",
  "receiver-register",
  "registry-across-modules",
  "set-prototype-of-after",
  "set-prototype-of-function",
  "shared-after-error-base",
  "shared-after-factory-product",
  "shared-after-tui-prototype",
  "shared-context-service",
  "shared-error-base",
  "shared-error-base-prototype",
  "shared-error-global",
  "shared-function-prototype",
  "shared-tui-container",
  "shared-tui-text-prototype",
  "shared-yieldable-error",
  "static-local-before-seal",
  "static-reparent",
];

const constructible = [
  "class",
  "functionDeclaration",
  "functionExpression",
  "proxyClass",
  "proxyFunction",
];

const STOPPED = new Set([
  "no-prototype",
  "not-constructor",
  "not-extensible",
  "read-only",
  "refused",
  "write-refused",
]);

const pick = (outcomes: Readonly<Record<string, string>>, keep: (outcome: string) => boolean) =>
  Object.keys(outcomes)
    .filter((name) => keep(outcomes[name] ?? ""))
    .toSorted();

it("keeps every local callable out of the chain on every route, with the routes reaching it when the seal is off", () =>
  Promise.all([outcomesOf("sealed"), outcomesOf("plain")]).then(([sealed, plain]) => {
    const routes = reachRoutes.flatMap((route) =>
      constructible.map((kind) => `fixture/${route}/${kind}`),
    );
    const forms = staticallyPassed.flatMap(({ name }) =>
      Object.keys(kinds).map((kind) => `form/${name}/${kind}`),
    );
    expect({
      formsReachedWithoutSeal: forms.filter((name) => plain[name] !== "loads"),
      formsWithSeal: forms.filter((name) => sealed[name] !== "loads"),
      reachedWithSeal: pick(sealed, (outcome) => outcome !== "loads" && !STOPPED.has(outcome)),
      reachedWithoutSealButLoadsWithSeal: pick(plain, (outcome) => outcome === "reached").filter(
        (name) => sealed[name] === "loads",
      ),
      routesWithoutSeal: routes.filter((name) => plain[name] !== "reached"),
    }).toEqual({
      formsReachedWithoutSeal: [],
      formsWithSeal: [],
      reachedWithSeal: [],
      reachedWithoutSealButLoadsWithSeal: [],
      routesWithoutSeal: [],
    });
    expect(staticallyPassed).toHaveLength(44);
    expect(Object.keys(kinds)).toHaveLength(10);
    const checked = (outcomes: Readonly<Record<string, string>>) =>
      Object.groupBy(Object.keys(outcomes), (name) => name.split("/")[0] ?? "");
    expect(
      [sealed, plain].map((outcomes) => ({
        fixture: checked(outcomes)["fixture"]?.length,
        form: checked(outcomes)["form"]?.length,
      })),
    ).toEqual([
      { fixture: 520, form: 440 },
      { fixture: 520, form: 440 },
    ]);
    return undefined;
  }));
