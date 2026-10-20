import assert from "node:assert";
import { it } from "node:test";

import { renderLatex } from "../src/index.ts";
import type latexHelpersTypes from "./latex-helpers.types.ts";

function defineCases(cases: readonly latexHelpersTypes.LatexCase[]): void {
  for (const [source, expected] of cases) {
    it(`renders ${JSON.stringify(source)}`, () => {
      assert.strictEqual(renderLatex(source), expected);
    });
  }
}

export default defineCases;
