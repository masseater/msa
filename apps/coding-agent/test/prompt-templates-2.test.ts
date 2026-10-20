import { describe, expect, test } from "vite-plus/test";

import { substituteArgs } from "../src/core/prompt-templates.ts";

const shouldUseDefaultWhenPositionalArgIs = () => {
  expect(substituteArgs(`List exactly \${1:-7} next steps`, [])).toBe("List exactly 7 next steps");
};

const shouldSupportDefaultsForAllArguments = () => {
  const template = `\${@:-default}\n\${ARGUMENTS:-default}`;

  expect(substituteArgs(template, [])).toBe("default\ndefault");
  expect(substituteArgs(template, ["This", "would", "be", "the", "arguments"])).toBe(
    "This would be the arguments\nThis would be the arguments",
  );
};

const shouldUsePositionalArgWhenPresent = () => {
  expect(substituteArgs(`List exactly \${1:-7} next steps`, ["3"])).toBe(
    "List exactly 3 next steps",
  );
};

const shouldUseDefaultWhenPositionalArgIs2 = () => {
  expect(substituteArgs(`Mode: \${1:-brief}`, [""])).toBe("Mode: brief");
};

const shouldSupportMultiplePositionalDefaults = () => {
  expect(substituteArgs(`\${1:-7} \${2:-brief}`, [])).toBe("7 brief");
  expect(substituteArgs(`\${1:-7} \${2:-brief}`, ["3"])).toBe("3 brief");
  expect(substituteArgs(`\${1:-7} \${2:-brief}`, ["3", "verbose"])).toBe("3 verbose");
};

const shouldNotRecursivelySubstitutePatternsInArg = () => {
  expect(substituteArgs(`\${1:-7}`, ["$ARGUMENTS"])).toBe("$ARGUMENTS");
  expect(substituteArgs(`\${1:-7}`, ["$1"])).toBe("$1");
};

const shouldNotRecursivelySubstitutePatternsInDefault = () => {
  expect(substituteArgs(`\${1:-$ARGUMENTS}`, ["a", "b"])).toBe("a");
  expect(substituteArgs(`\${3:-$ARGUMENTS}`, ["a", "b"])).toBe("$ARGUMENTS");
};

const shouldSupportDefaultsWithSpaces = () => {
  expect(substituteArgs(`\${1:-seven steps}`, [])).toBe("seven steps");
};

const shouldSupportOutOfRangePositionalDefaults = () => {
  expect(substituteArgs(`\${3:-fallback}`, ["a", "b"])).toBe("fallback");
};

const shouldMixPositionalDefaultsWithExistingPlaceholders = () => {
  expect(substituteArgs(`$1 \${2:-x} $ARGUMENTS`, ["a"])).toBe("a x a");
};

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

const shouldSliceFromIndex = () => {
  expect(substituteArgs(`\${@:2}`, ["a", "b", "c", "d"])).toBe("b c d");
  expect(substituteArgs(`\${@:1}`, ["a", "b", "c"])).toBe("a b c");
  expect(substituteArgs(`\${@:3}`, ["a", "b", "c", "d"])).toBe("c d");
};

const shouldSliceWithLength = () => {
  expect(substituteArgs(`\${@:2:2}`, ["a", "b", "c", "d"])).toBe("b c");
  expect(substituteArgs(`\${@:1:1}`, ["a", "b", "c"])).toBe("a");
  expect(substituteArgs(`\${@:3:1}`, ["a", "b", "c", "d"])).toBe("c");
  expect(substituteArgs(`\${@:2:3}`, ["a", "b", "c", "d", "e"])).toBe("b c d");
};

const shouldHandleOutOfRangeSlices = () => {
  expect(substituteArgs(`\${@:99}`, ["a", "b"])).toBe("");
  expect(substituteArgs(`\${@:5}`, ["a", "b"])).toBe("");
  expect(substituteArgs(`\${@:10:5}`, ["a", "b"])).toBe("");
};

const shouldHandleZeroLengthSlices = () => {
  expect(substituteArgs(`\${@:2:0}`, ["a", "b", "c"])).toBe("");
  expect(substituteArgs(`\${@:1:0}`, ["a", "b"])).toBe("");
};

const shouldHandleLengthExceedingArray = () => {
  expect(substituteArgs(`\${@:2:99}`, ["a", "b", "c"])).toBe("b c");
  expect(substituteArgs(`\${@:1:10}`, ["a", "b"])).toBe("a b");
};

const shouldProcessSliceBeforeSimple = () => {
  expect(substituteArgs(`\${@:2} vs $@`, ["a", "b", "c"])).toBe("b c vs a b c");
  expect(substituteArgs(`First: \${@:1:1}, All: $@`, ["x", "y", "z"])).toBe("First: x, All: x y z");
};

const shouldNotRecursivelySubstituteSlicePatternsIn = () => {
  expect(substituteArgs(`\${@:1}`, [`\${@:2}`, "test"])).toBe(`\${@:2} test`);
  expect(substituteArgs(`\${@:2}`, ["a", `\${@:3}`, "c"])).toBe(`\${@:3} c`);
};

const shouldHandleMixedUsageWithPositionalArgs = () => {
  expect(substituteArgs(`$1: \${@:2}`, ["cmd", "arg1", "arg2"])).toBe("cmd: arg1 arg2");
  expect(substituteArgs(`$1 $2 \${@:3}`, ["a", "b", "c", "d"])).toBe("a b c d");
};

const shouldTreatAsAllArgs = () => {
  expect(substituteArgs(`\${@:0}`, ["a", "b", "c"])).toBe("a b c");
};

const shouldHandleEmptyArgsArray = () => {
  expect(substituteArgs(`\${@:2}`, [])).toBe("");
  expect(substituteArgs(`\${@:1}`, [])).toBe("");
};

const shouldHandleSingleArgArray = () => {
  expect(substituteArgs(`\${@:1}`, ["only"])).toBe("only");
  expect(substituteArgs(`\${@:2}`, ["only"])).toBe("");
};

const shouldHandleSliceInMiddleOfText = () => {
  expect(substituteArgs(`Process \${@:2} with $1`, ["tool", "file1", "file2"])).toBe(
    "Process file1 file2 with tool",
  );
};

const shouldHandleMultipleSlicesInOneTemplate = () => {
  expect(substituteArgs(`\${@:1:1} and \${@:2}`, ["a", "b", "c"])).toBe("a and b c");
  expect(substituteArgs(`\${@:1:2} vs \${@:3:2}`, ["a", "b", "c", "d", "e"])).toBe("a b vs c d");
};

const shouldHandleQuotedArgumentsInSlices = () => {
  expect(substituteArgs(`\${@:2}`, ["cmd", "first arg", "second arg"])).toBe(
    "first arg second arg",
  );
};

const shouldHandleSpecialCharactersInSlicedArgs = () => {
  expect(substituteArgs(`\${@:2}`, ["cmd", "$100", "@user", "#tag"])).toBe("$100 @user #tag");
};

const shouldHandleUnicodeInSlicedArgs = () => {
  expect(substituteArgs(`\${@:1}`, ["日本語", "🎉", "café"])).toBe("日本語 🎉 café");
};

const shouldCombinePositionalSliceAndWildcardPlaceholders = () => {
  const template = `Run $1 on \${@:2:2}, then process $@`;
  const args = ["eslint", "file1.ts", "file2.ts", "file3.ts"];
  expect(substituteArgs(template, args)).toBe(
    "Run eslint on file1.ts file2.ts, then process eslint file1.ts file2.ts file3.ts",
  );
};

const shouldHandleSliceWithNoSpacing = () => {
  expect(substituteArgs(`prefix\${@:2}suffix`, ["a", "b", "c"])).toBe("prefixb csuffix");
};

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
