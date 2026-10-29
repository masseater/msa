import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { codesOnLine, lintProbes, probePath } = lintProbe;

const UNDEFINED = "eslint(no-undef)";

const SCRIPT_URL = "eslint(no-script-url)";

const cases: readonly (readonly [expression: string, expected: string | undefined])[] = [
  ["document.title", UNDEFINED],
  ["window.innerWidth", UNDEFINED],
  ["getComputedStyle", UNDEFINED],
  ["HTMLElement", UNDEFINED],
  ['"javascript:void 0"', SCRIPT_URL],
  ["`javascript:void 0`", SCRIPT_URL],
  ['"https://example.com"', undefined],
];

const PROBE = probePath("apps/coding-agent/src/core/export-html", "browser-js");

const probe = [
  ...cases.map(([expression], index) => `const v${index} = ${expression};`),
  `export default [${cases.map((_case, index) => `v${index}`).join(", ")}];`,
].join("\n");

it("rejects browser globals and javascript: URLs in the repository's code", () =>
  lintProbes({ [PROBE]: probe }).then((report) => {
    const found = cases.map(
      ([, expected], index) =>
        [UNDEFINED, SCRIPT_URL].find(
          (code) => codesOnLine(report, PROBE, index + 1, code).length > 0,
        ) ?? (expected === undefined ? undefined : "none"),
    );
    expect(found).toEqual(cases.map(([, expected]) => expected));
    return undefined;
  }));
