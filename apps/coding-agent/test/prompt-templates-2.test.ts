import { describe, expect, test } from "vite-plus/test";

import promptTemplateArgs from "../src/core/prompt-template-args.ts";
import promptTemplateArgsSupport from "./prompt-template-args-support.ts";

const { substituteArgs } = promptTemplateArgs;
const { substitutes } = promptTemplateArgsSupport;

const shouldUseDefaultWhenPositionalArgIs = substitutes([
  `List exactly \${1:-7} next steps`,
  [],
  "List exactly 7 next steps",
]);

const shouldSupportDefaultsForAllArguments = () => {
  const template = `\${@:-default}\n\${ARGUMENTS:-default}`;

  expect(substituteArgs(template, [])).toBe("default\ndefault");
  expect(substituteArgs(template, ["This", "would", "be", "the", "arguments"])).toBe(
    "This would be the arguments\nThis would be the arguments",
  );
};

const shouldUsePositionalArgWhenPresent = substitutes([
  `List exactly \${1:-7} next steps`,
  ["3"],
  "List exactly 3 next steps",
]);

const shouldUseDefaultWhenPositionalArgIs2 = substitutes([
  `Mode: \${1:-brief}`,
  [""],
  "Mode: brief",
]);

const shouldSupportMultiplePositionalDefaults = substitutes(
  [`\${1:-7} \${2:-brief}`, [], "7 brief"],
  [`\${1:-7} \${2:-brief}`, ["3"], "3 brief"],
  [`\${1:-7} \${2:-brief}`, ["3", "verbose"], "3 verbose"],
);

const shouldNotRecursivelySubstitutePatternsInArg = substitutes(
  [`\${1:-7}`, ["$ARGUMENTS"], "$ARGUMENTS"],
  [`\${1:-7}`, ["$1"], "$1"],
);

const shouldNotRecursivelySubstitutePatternsInDefault = substitutes(
  [`\${1:-$ARGUMENTS}`, ["a", "b"], "a"],
  [`\${3:-$ARGUMENTS}`, ["a", "b"], "$ARGUMENTS"],
);

const shouldSupportDefaultsWithSpaces = substitutes([`\${1:-seven steps}`, [], "seven steps"]);

const shouldSupportOutOfRangePositionalDefaults = substitutes([
  `\${3:-fallback}`,
  ["a", "b"],
  "fallback",
]);

const shouldMixPositionalDefaultsWithExistingPlaceholders = substitutes([
  `$1 \${2:-x} $ARGUMENTS`,
  ["a"],
  "a x a",
]);

describe("substituteArgs - positional defaults", () => {
  test("should use default when positional arg is missing", shouldUseDefaultWhenPositionalArgIs);

  test("should support defaults for all arguments", shouldSupportDefaultsForAllArguments);

  test("should use positional arg when present", shouldUsePositionalArgWhenPresent);

  test("should use default when positional arg is empty", shouldUseDefaultWhenPositionalArgIs2);

  test("should support multiple positional defaults", shouldSupportMultiplePositionalDefaults);

  test(
    "should not recursively substitute patterns in arg values",
    shouldNotRecursivelySubstitutePatternsInArg,
  );

  test(
    "should not recursively substitute patterns in default values",
    shouldNotRecursivelySubstitutePatternsInDefault,
  );

  test("should support defaults with spaces", shouldSupportDefaultsWithSpaces);

  test(
    "should support out-of-range positional defaults",
    shouldSupportOutOfRangePositionalDefaults,
  );

  test(
    "should mix positional defaults with existing placeholders",
    shouldMixPositionalDefaultsWithExistingPlaceholders,
  );
});

const shouldSliceFromIndex = substitutes(
  [`\${@:2}`, ["a", "b", "c", "d"], "b c d"],
  [`\${@:1}`, ["a", "b", "c"], "a b c"],
  [`\${@:3}`, ["a", "b", "c", "d"], "c d"],
);

const shouldSliceWithLength = substitutes(
  [`\${@:2:2}`, ["a", "b", "c", "d"], "b c"],
  [`\${@:1:1}`, ["a", "b", "c"], "a"],
  [`\${@:3:1}`, ["a", "b", "c", "d"], "c"],
  [`\${@:2:3}`, ["a", "b", "c", "d", "e"], "b c d"],
);

const shouldHandleOutOfRangeSlices = substitutes(
  [`\${@:99}`, ["a", "b"], ""],
  [`\${@:5}`, ["a", "b"], ""],
  [`\${@:10:5}`, ["a", "b"], ""],
);

const shouldHandleZeroLengthSlices = substitutes(
  [`\${@:2:0}`, ["a", "b", "c"], ""],
  [`\${@:1:0}`, ["a", "b"], ""],
);

const shouldHandleLengthExceedingArray = substitutes(
  [`\${@:2:99}`, ["a", "b", "c"], "b c"],
  [`\${@:1:10}`, ["a", "b"], "a b"],
);

const shouldProcessSliceBeforeSimple = substitutes(
  [`\${@:2} vs $@`, ["a", "b", "c"], "b c vs a b c"],
  [`First: \${@:1:1}, All: $@`, ["x", "y", "z"], "First: x, All: x y z"],
);

const shouldNotRecursivelySubstituteSlicePatternsIn = substitutes(
  [`\${@:1}`, [`\${@:2}`, "test"], `\${@:2} test`],
  [`\${@:2}`, ["a", `\${@:3}`, "c"], `\${@:3} c`],
);

const shouldHandleMixedUsageWithPositionalArgs = substitutes(
  [`$1: \${@:2}`, ["cmd", "arg1", "arg2"], "cmd: arg1 arg2"],
  [`$1 $2 \${@:3}`, ["a", "b", "c", "d"], "a b c d"],
);

const shouldTreatAsAllArgs = substitutes([`\${@:0}`, ["a", "b", "c"], "a b c"]);

const shouldHandleEmptyArgsArray = substitutes([`\${@:2}`, [], ""], [`\${@:1}`, [], ""]);

const shouldHandleSingleArgArray = substitutes(
  [`\${@:1}`, ["only"], "only"],
  [`\${@:2}`, ["only"], ""],
);

const shouldHandleSliceInMiddleOfText = substitutes([
  `Process \${@:2} with $1`,
  ["tool", "file1", "file2"],
  "Process file1 file2 with tool",
]);

const shouldHandleMultipleSlicesInOneTemplate = substitutes(
  [`\${@:1:1} and \${@:2}`, ["a", "b", "c"], "a and b c"],
  [`\${@:1:2} vs \${@:3:2}`, ["a", "b", "c", "d", "e"], "a b vs c d"],
);

const shouldHandleQuotedArgumentsInSlices = substitutes([
  `\${@:2}`,
  ["cmd", "first arg", "second arg"],
  "first arg second arg",
]);

const shouldHandleSpecialCharactersInSlicedArgs = substitutes([
  `\${@:2}`,
  ["cmd", "$100", "@user", "#tag"],
  "$100 @user #tag",
]);

const shouldHandleUnicodeInSlicedArgs = substitutes([
  `\${@:1}`,
  ["日本語", "🎉", "café"],
  "日本語 🎉 café",
]);

const shouldCombinePositionalSliceAndWildcardPlaceholders = () => {
  const template = `Run $1 on \${@:2:2}, then process $@`;
  const args = ["eslint", "file1.ts", "file2.ts", "file3.ts"];
  expect(substituteArgs(template, args)).toBe(
    "Run eslint on file1.ts file2.ts, then process eslint file1.ts file2.ts file3.ts",
  );
};

const shouldHandleSliceWithNoSpacing = substitutes([
  `prefix\${@:2}suffix`,
  ["a", "b", "c"],
  "prefixb csuffix",
]);

const shouldHandleLargeSliceLengthsGracefully = () => {
  const args = Array.from({ length: 10 }, (_, i) => `arg${i + 1}`);
  expect(substituteArgs(`\${@:5:100}`, args)).toBe("arg5 arg6 arg7 arg8 arg9 arg10");
};

describe("substituteArgs - array slicing", () => {
  test(`should slice from index (\${@:N})`, shouldSliceFromIndex);

  test(`should slice with length (\${@:N:L})`, shouldSliceWithLength);

  test("should handle out of range slices", shouldHandleOutOfRangeSlices);

  test("should handle zero-length slices", shouldHandleZeroLengthSlices);

  test("should handle length exceeding array", shouldHandleLengthExceedingArray);

  test("should process slice before simple $@", shouldProcessSliceBeforeSimple);

  test(
    "should not recursively substitute slice patterns in args",
    shouldNotRecursivelySubstituteSlicePatternsIn,
  );

  test("should handle mixed usage with positional args", shouldHandleMixedUsageWithPositionalArgs);

  test(`should treat \${@:0} as all args`, shouldTreatAsAllArgs);

  test("should handle empty args array", shouldHandleEmptyArgsArray);

  test("should handle single arg array", shouldHandleSingleArgArray);

  test("should handle slice in middle of text", shouldHandleSliceInMiddleOfText);

  test("should handle multiple slices in one template", shouldHandleMultipleSlicesInOneTemplate);

  test("should handle quoted arguments in slices", shouldHandleQuotedArgumentsInSlices);

  test(
    "should handle special characters in sliced args",
    shouldHandleSpecialCharactersInSlicedArgs,
  );

  test("should handle unicode in sliced args", shouldHandleUnicodeInSlicedArgs);

  test(
    "should combine positional, slice, and wildcard placeholders",
    shouldCombinePositionalSliceAndWildcardPlaceholders,
  );

  test("should handle slice with no spacing", shouldHandleSliceWithNoSpacing);

  test("should handle large slice lengths gracefully", shouldHandleLargeSliceLengthsGracefully);
});
