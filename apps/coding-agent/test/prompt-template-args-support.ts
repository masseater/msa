import { expect } from "vite-plus/test";

import promptTemplateArgs from "../src/core/prompt-template-args.ts";

const { parseCommandArgs, substituteArgs } = promptTemplateArgs;

type SubstitutionRow = readonly [template: string, args: readonly string[], expected: string];
type ParseRow = readonly [input: string, expected: readonly string[]];

const substitutes =
  (...rows: readonly SubstitutionRow[]) =>
  (): void => {
    for (const [template, args, expected] of rows) {
      expect(substituteArgs(template, [...args])).toBe(expected);
    }
  };

const parses =
  (...rows: readonly ParseRow[]) =>
  (): void => {
    for (const [input, expected] of rows) {
      expect(parseCommandArgs(input)).toEqual(expected);
    }
  };

const promptTemplateArgsSupport = {
  parses,
  substitutes,
};

export default promptTemplateArgsSupport;
