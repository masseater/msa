import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { lintProbes, msaCodesOnLine, probePath } = lintProbe;

const LOCAL_EXTENDS = "msa(no-local-class-extends)";

const HEADER = [
  'import tui from "@msa/tui";',
  'import { Data } from "effect";',
  'import ThemedText from "./modes/interactive/components/themed-text.ts";',
  'import statusIndicators from "./modes/interactive/components/status-indicators.ts";',
  "const { StatusIndicator } = statusIndicators;",
  "class Base {}",
  "const LocalExpression = class {};",
  "const withFoo = <T,>(base: T): T => base;",
  'import { Mixin } from "effect";',
  "function helper() { return Error; }",
  "const arrowHelper = () => Error;",
  "const arrowAlias = arrowHelper;",
  "const Local0 = Base;",
  ...Array.from({ length: 12 }, (_, index) => `const Local${index + 1} = Local${index};`),
  "const Native0 = Error;",
  ...Array.from({ length: 12 }, (_, index) => `const Native${index + 1} = Native${index};`),
  "const Loop1 = Loop2;",
  "const Loop2 = Loop1;",
];

const cases: readonly (readonly [statement: string, expected: string | undefined])[] = [
  ["export class A extends Base {}", LOCAL_EXTENDS],
  ["export class B extends ThemedText {}", LOCAL_EXTENDS],
  ["export class C extends StatusIndicator {}", LOCAL_EXTENDS],
  ["export class D extends statusIndicators.StatusIndicator {}", LOCAL_EXTENDS],
  ["export class E extends LocalExpression {}", LOCAL_EXTENDS],
  ["export const F = class extends Base {};", LOCAL_EXTENDS],
  ["export class J extends withFoo(Base) {}", LOCAL_EXTENDS],
  ["export class K extends withFoo(Error) {}", LOCAL_EXTENDS],
  ["export class L extends Mixin(Base) {}", LOCAL_EXTENDS],
  ["export class P extends Mixin(withFoo(Base)) {}", LOCAL_EXTENDS],
  ["export class Q extends Mixin(() => Error) {}", undefined],
  ["export class R extends Mixin(function () { return Error; }) {}", undefined],
  ["export class S extends Mixin(helper) {}", undefined],
  ["export class T extends Mixin(arrowHelper) {}", undefined],
  ["export class U extends Mixin(arrowHelper, arrowHelper()) {}", LOCAL_EXTENDS],
  ["export class V extends Mixin(arrowHelper(), arrowHelper) {}", LOCAL_EXTENDS],
  ["export class W extends Mixin(arrowAlias, arrowAlias()) {}", LOCAL_EXTENDS],
  ["export class X extends Mixin(arrowAlias, Mixin(arrowHelper())) {}", LOCAL_EXTENDS],
  ["export class Y extends Mixin(helper, helper()) {}", LOCAL_EXTENDS],
  ["export class M extends Local12 {}", LOCAL_EXTENDS],
  ["export class N extends Native12 {}", undefined],
  ["export class O extends Loop1 {}", undefined],
  ["export class G extends tui.Container {}", undefined],
  ['export class H extends Data.TaggedError("H")<{}> {}', undefined],
  ["export class I extends Error {}", undefined],
];

const PROBE = probePath("apps/coding-agent/src", "class-extends");

const probe = [...HEADER, ...cases.map(([statement]) => statement)].join("\n");

it("flags classes in coding-agent that extend a class defined in the same package", () =>
  lintProbes({ [PROBE]: probe }).then((report) => {
    for (const [index, [statement, expected]] of cases.entries()) {
      const codes = msaCodesOnLine(report, PROBE, HEADER.length + index + 1);
      expect({ codes, statement }).toEqual({
        codes: expected === undefined ? [] : [expected],
        statement,
      });
    }
    return undefined;
  }));
