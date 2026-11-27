import { describe, expect, test } from "vite-plus/test";

import promptTemplateArgs from "../src/core/prompt-template-args.ts";
import promptTemplateArgsSupport from "./prompt-template-args-support.ts";

const { substituteArgs } = promptTemplateArgs;
const { substitutes } = promptTemplateArgsSupport;

const shouldReplaceArgumentsWithAllArgsJoined = substitutes([
  "Test: $ARGUMENTS",
  ["a", "b", "c"],
  "Test: a b c",
]);

const shouldReplaceWithAllArgsJoined = substitutes(["Test: $@", ["a", "b", "c"], "Test: a b c"]);

const shouldReplaceAndArgumentsIdentically = () => {
  const args = ["foo", "bar", "baz"];
  expect(substituteArgs("Test: $@", args)).toBe(substituteArgs("Test: $ARGUMENTS", args));
};

const shouldNotRecursivelySubstitutePatternsInArgument = substitutes(
  ["$ARGUMENTS", ["$1", "$ARGUMENTS"], "$1 $ARGUMENTS"],
  ["$@", ["$100", "$1"], "$100 $1"],
  ["$ARGUMENTS", ["$100", "$1"], "$100 $1"],
);

const shouldSupportMixed12AndArguments = substitutes([
  "$1: $ARGUMENTS",
  ["prefix", "a", "b"],
  "prefix: prefix a b",
]);

const shouldSupportMixed12And = substitutes(["$1: $@", ["prefix", "a", "b"], "prefix: prefix a b"]);

const shouldHandleEmptyArgumentsArrayWithArguments = substitutes([
  "Test: $ARGUMENTS",
  [],
  "Test: ",
]);

const shouldHandleEmptyArgumentsArrayWith = substitutes(["Test: $@", [], "Test: "]);

const shouldHandleEmptyArgumentsArrayWith1 = substitutes(["Test: $1", [], "Test: "]);

const shouldHandleMultipleOccurrencesOfArguments = substitutes([
  "$ARGUMENTS and $ARGUMENTS",
  ["a", "b"],
  "a b and a b",
]);

const shouldHandleMultipleOccurrencesOf = substitutes(["$@ and $@", ["a", "b"], "a b and a b"]);

const shouldHandleMixedOccurrencesOfAndArguments = substitutes([
  "$@ and $ARGUMENTS",
  ["a", "b"],
  "a b and a b",
]);

const shouldHandleSpecialCharactersInArguments = substitutes([
  "$1 $2: $ARGUMENTS",
  ["arg100", "@user"],
  "arg100 @user: arg100 @user",
]);

const shouldHandleOutOfRangeNumberedPlaceholders = substitutes([
  "$1 $2 $3 $4 $5",
  ["a", "b"],
  "a b   ",
]);

const shouldHandleUnicodeCharacters = substitutes([
  "$ARGUMENTS",
  ["日本語", "🎉", "café"],
  "日本語 🎉 café",
]);

const shouldPreserveNewlinesAndTabsInArgument = substitutes([
  "$1 $2",
  ["line1\nline2", "tab\tthere"],
  "line1\nline2 tab\tthere",
]);

const shouldHandleConsecutiveDollarPatterns = substitutes(["$1$2", ["a", "b"], "ab"]);

const shouldHandleQuotedArgumentsWithSpaces = substitutes([
  "$ARGUMENTS",
  ["first arg", "second arg"],
  "first arg second arg",
]);

const shouldHandleSingleArgumentWithArguments = substitutes([
  "Test: $ARGUMENTS",
  ["only"],
  "Test: only",
]);

const shouldHandleSingleArgumentWith = substitutes(["Test: $@", ["only"], "Test: only"]);

const shouldHandle0ZeroIndex = substitutes(["$0", ["a", "b"], ""]);

const shouldHandleDecimalNumberInPatternOnly = substitutes(["$1.5", ["a"], "a.5"]);

const shouldHandleArgumentsAsPartOfWord = substitutes(["pre$ARGUMENTS", ["a", "b"], "prea b"]);

const shouldHandleAsPartOfWord = substitutes(["pre$@", ["a", "b"], "prea b"]);

const shouldHandleEmptyArgumentsInMiddleOf = substitutes(["$ARGUMENTS", ["a", "", "c"], "a  c"]);

const shouldHandleTrailingAndLeadingSpacesIn = substitutes([
  "$ARGUMENTS",
  ["  leading  ", "trailing  "],
  "  leading   trailing  ",
]);

const shouldHandleArgumentContainingPatternPartially = substitutes([
  "Prefix $ARGUMENTS suffix",
  ["ARGUMENTS"],
  "Prefix ARGUMENTS suffix",
]);

const shouldHandleNonMatchingPatterns = substitutes(["$A $$ $ $ARGS", ["a"], "$A $$ $ $ARGS"]);

const shouldHandleCaseVariationsCaseSensitive = substitutes([
  "$arguments $Arguments $ARGUMENTS",
  ["a", "b"],
  "$arguments $Arguments a b",
]);

const shouldHandleBothSyntaxesInSameCommand = () => {
  const args = ["x", "y", "z"];
  const result1 = substituteArgs("$@ and $ARGUMENTS", args);
  const result2 = substituteArgs("$ARGUMENTS and $@", args);
  expect(result1).toBe(result2);
  expect(result1).toBe("x y z and x y z");
};

const shouldHandleVeryLongArgumentLists = () => {
  const args = Array.from({ length: 100 }, (_, i) => `arg${i}`);
  const result = substituteArgs("$ARGUMENTS", args);
  expect(result).toBe(args.join(" "));
};

const shouldHandleNumberedPlaceholdersWithSingleDigit = substitutes([
  "$1 $2 $3",
  ["a", "b", "c"],
  "a b c",
]);

const shouldHandleNumberedPlaceholdersWithMultipleDigits = () => {
  const args = Array.from({ length: 15 }, (_, i) => `val${i}`);
  expect(substituteArgs("$10 $12 $15", args)).toBe("val9 val11 val14");
};

const shouldHandleEscapedDollarSignsLiteralBackslash = substitutes([
  "Price: \\$100",
  [],
  "Price: \\",
]);

const shouldHandleMixedNumberedAndWildcardPlaceholders = substitutes([
  "$1: $@ ($ARGUMENTS)",
  ["first", "second", "third"],
  "first: first second third (first second third)",
]);

const shouldHandleCommandWithNoPlaceholders = substitutes([
  "Just plain text",
  ["a", "b"],
  "Just plain text",
]);

const shouldHandleCommandWithOnlyPlaceholders = substitutes([
  "$1 $2 $@",
  ["a", "b", "c"],
  "a b a b c",
]);

const substituteArgsCases: ReadonlyArray<readonly [string, () => void]> = [
  ["should replace $ARGUMENTS with all args joined", shouldReplaceArgumentsWithAllArgsJoined],
  ["should replace $@ with all args joined", shouldReplaceWithAllArgsJoined],
  ["should replace $@ and $ARGUMENTS identically", shouldReplaceAndArgumentsIdentically],
  [
    "should NOT recursively substitute patterns in argument values",
    shouldNotRecursivelySubstitutePatternsInArgument,
  ],
  ["should support mixed $1, $2, and $ARGUMENTS", shouldSupportMixed12AndArguments],
  ["should support mixed $1, $2, and $@", shouldSupportMixed12And],
  [
    "should handle empty arguments array with $ARGUMENTS",
    shouldHandleEmptyArgumentsArrayWithArguments,
  ],
  ["should handle empty arguments array with $@", shouldHandleEmptyArgumentsArrayWith],
  ["should handle empty arguments array with $1", shouldHandleEmptyArgumentsArrayWith1],
  ["should handle multiple occurrences of $ARGUMENTS", shouldHandleMultipleOccurrencesOfArguments],
  ["should handle multiple occurrences of $@", shouldHandleMultipleOccurrencesOf],
  [
    "should handle mixed occurrences of $@ and $ARGUMENTS",
    shouldHandleMixedOccurrencesOfAndArguments,
  ],
  ["should handle special characters in arguments", shouldHandleSpecialCharactersInArguments],
  ["should handle out-of-range numbered placeholders", shouldHandleOutOfRangeNumberedPlaceholders],
  ["should handle unicode characters", shouldHandleUnicodeCharacters],
  ["should preserve newlines and tabs in argument values", shouldPreserveNewlinesAndTabsInArgument],
  ["should handle consecutive dollar patterns", shouldHandleConsecutiveDollarPatterns],
  ["should handle quoted arguments with spaces", shouldHandleQuotedArgumentsWithSpaces],
  ["should handle single argument with $ARGUMENTS", shouldHandleSingleArgumentWithArguments],
  ["should handle single argument with $@", shouldHandleSingleArgumentWith],
  ["should handle $0 (zero index)", shouldHandle0ZeroIndex],
  [
    "should handle decimal number in pattern (only integer part matches)",
    shouldHandleDecimalNumberInPatternOnly,
  ],
  ["should handle $ARGUMENTS as part of word", shouldHandleArgumentsAsPartOfWord],
  ["should handle $@ as part of word", shouldHandleAsPartOfWord],
  ["should handle empty arguments in middle of list", shouldHandleEmptyArgumentsInMiddleOf],
  [
    "should handle trailing and leading spaces in arguments",
    shouldHandleTrailingAndLeadingSpacesIn,
  ],
  [
    "should handle argument containing pattern partially",
    shouldHandleArgumentContainingPatternPartially,
  ],
  ["should handle non-matching patterns", shouldHandleNonMatchingPatterns],
  ["should handle case variations (case-sensitive)", shouldHandleCaseVariationsCaseSensitive],
  [
    "should handle both syntaxes in same command with same result",
    shouldHandleBothSyntaxesInSameCommand,
  ],
  ["should handle very long argument lists", shouldHandleVeryLongArgumentLists],
  [
    "should handle numbered placeholders with single digit",
    shouldHandleNumberedPlaceholdersWithSingleDigit,
  ],
  [
    "should handle numbered placeholders with multiple digits",
    shouldHandleNumberedPlaceholdersWithMultipleDigits,
  ],
  [
    "should handle escaped dollar signs (literal backslash preserved)",
    shouldHandleEscapedDollarSignsLiteralBackslash,
  ],
  [
    "should handle mixed numbered and wildcard placeholders",
    shouldHandleMixedNumberedAndWildcardPlaceholders,
  ],
  ["should handle command with no placeholders", shouldHandleCommandWithNoPlaceholders],
  ["should handle command with only placeholders", shouldHandleCommandWithOnlyPlaceholders],
];

describe("substituteArgs", () => {
  for (const [name, run] of substituteArgsCases) test(name, run);
});
