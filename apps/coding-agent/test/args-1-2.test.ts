import { describe, expect, test } from "vite-plus/test";

import args from "../src/cli/args.ts";

const { normalizeSessionName, parseArgs } = args;

const reportsAMissingModeValue = () => {
  const result = parseArgs(["--mode"]);
  expect(result.mode).toBeUndefined();
  expect(result.unknownFlags.size).toBe(0);
  expect(result.diagnostics).toEqual([
    { message: "--mode requires text, json, or rpc", type: "error" as const },
  ]);
};

const doesNotConsumeAnotherOptionAsA = () => {
  const result = parseArgs(["--mode", "--version"]);
  expect(result.mode).toBeUndefined();
  expect(result.version).toBe(true);
  expect(result.unknownFlags.size).toBe(0);
  expect(result.diagnostics).toEqual([
    { message: "--mode requires text, json, or rpc", type: "error" as const },
  ]);
};

const reportsAnInvalidModeValueAfterA = () => {
  const result = parseArgs(["--mode", "json", "--mode", "yaml"]);
  expect(result.diagnostics).toEqual([
    { message: 'Invalid mode "yaml". Valid values: text, json, rpc', type: "error" as const },
  ]);
};

const parsesNameFlagWithValue = () => {
  const result = parseArgs(["--name", "my-session"]);
  expect(result.name).toBe("my-session");
};

const parsesNShorthand = () => {
  const result = parseArgs(["-n", "quick-session"]);
  expect(result.name).toBe("quick-session");
};

const preservesEmptyValuesForMainValidation = () => {
  const result = parseArgs(["--name", ""]);
  expect(result.name).toBe("");
};

const normalizesDisplayNamesAndRejectsWhitespaceOnly = () => {
  expect(normalizeSessionName("  named session  ")).toBe("named session");
  expect(normalizeSessionName("   ")).toBeUndefined();
};

const reportsMissingValue = () => {
  const result = parseArgs(["--name"]);
  expect(result.diagnostics).toEqual([
    { message: "--name requires a value", type: "error" as const },
  ]);
};

const worksAlongsideOtherFlags = () => {
  const result = parseArgs(["--name", "named-run", "--print", "--model", "gpt-4o", "hello"]);
  expect(result.name).toBe("named-run");
  expect(result.print).toBe(true);
  expect(result.model).toBe("gpt-4o");
  expect(result.messages).toEqual(["hello"]);
};

describe("parseArgs", () => {
  describe("--mode flag", () => {
    test.each(["text", "json", "rpc"] as const)("parses --mode %s", (mode) => {
      const result = parseArgs(["--mode", mode]);
      expect(result.mode).toBe(mode);
      expect(result.diagnostics).toEqual([]);
    });

    test.each(["yaml", ""])("rejects invalid --mode value %j", (mode) => {
      const result = parseArgs(["--mode", mode, "--version"]);
      expect(result.mode).toBeUndefined();
      expect(result.version).toBe(true);
      expect(result.messages).toEqual([]);
      expect(result.unknownFlags.size).toBe(0);
      expect(result.diagnostics).toEqual([
        {
          message: `Invalid mode "${mode}". Valid values: text, json, rpc`,
          type: "error" as const,
        },
      ]);
    });

    test("reports a missing --mode value", reportsAMissingModeValue);

    test("does not consume another option as a --mode value", doesNotConsumeAnotherOptionAsA);

    test("reports an invalid --mode value after a valid one", reportsAnInvalidModeValueAfterA);
  });
});

describe("parseArgs", () => {
  describe("--name flag", () => {
    test("parses --name flag with value", parsesNameFlagWithValue);

    test("parses -n shorthand", parsesNShorthand);

    test("preserves empty values for main validation", preservesEmptyValuesForMainValidation);

    test(
      "normalizes display names and rejects whitespace-only values",
      normalizesDisplayNamesAndRejectsWhitespaceOnly,
    );

    test("reports missing value", reportsMissingValue);

    test("works alongside other flags", worksAlongsideOtherFlags);
  });
});
