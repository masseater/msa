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
];

const cases: readonly (readonly [statement: string, expected: string | undefined])[] = [
  ["export class A extends Base {}", LOCAL_EXTENDS],
  ["export class B extends ThemedText {}", LOCAL_EXTENDS],
  ["export class C extends StatusIndicator {}", LOCAL_EXTENDS],
  ["export class D extends statusIndicators.StatusIndicator {}", LOCAL_EXTENDS],
  ["export class E extends LocalExpression {}", LOCAL_EXTENDS],
  ["export const F = class extends Base {};", LOCAL_EXTENDS],
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
