import assert from "node:assert";
import { it } from "node:test";

import { renderLatex } from "../src/index.ts";

export type LatexCase = readonly [source: string, expected: string];

export function defineCases(cases: readonly LatexCase[]): void {
  for (const [source, expected] of cases) {
    it(`renders ${JSON.stringify(source)}`, () => {
      assert.strictEqual(renderLatex(source), expected);
    });
  }
}
