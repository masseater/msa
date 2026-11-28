import { describe, expect, test } from "vite-plus/test";

import crashLog from "../src/core/crash-log.ts";

const { findExtensionStackMatches } = crashLog;

type StackExtension = Parameters<typeof findExtensionStackMatches>[1][number];

function packageExtension(
  source: string,
  baseDir: string,
  entry = "extensions/index.ts",
): StackExtension {
  const normalizedBaseDir = baseDir.replace(/\\/gu, "/");
  const resolvedPath = `${normalizedBaseDir}/${entry}`;
  return {
    path: resolvedPath,
    resolvedPath,
    sourceInfo: {
      baseDir,
      origin: "package",
      path: resolvedPath,
      scope: "user",
      source,
    },
  };
}

const pluginExtension = (name: string): StackExtension => ({
  path: `/plugins/${name}.ts`,
  resolvedPath: `/plugins/${name}.ts`,
  sourceInfo: {
    baseDir: "/plugins",
    origin: "package",
    path: `/plugins/${name}.ts`,
    scope: "user",
    source: `/plugins/${name}.ts`,
  },
});

const windowsRoot = "C:\\Users\\reporter\\.msa\\agent\\npm\\node_modules\\@scope\\memory";
const memoryPackage = packageExtension("npm:memory", "/tmp/node_modules/memory");
const localMemoryPath = "/Users/reporter/.msa/agent/extensions/local memory/index.ts";
const localMemory: StackExtension = {
  path: localMemoryPath,
  resolvedPath: localMemoryPath,
  sourceInfo: {
    baseDir: "/Users/reporter/.msa/agent/extensions",
    origin: "top-level",
    path: localMemoryPath,
    scope: "user",
    source: "local",
  },
};

const attributionCases = [
  {
    expected: ["npm:msa-observational-memory"],
    extensions: [
      packageExtension(
        "npm:msa-observational-memory",
        "/home/fedora/.msa/agent/npm/node_modules/msa-observational-memory",
      ),
      packageExtension("npm:unrelated", "/home/fedora/.msa/agent/npm/node_modules/unrelated"),
    ],
    name: "matches stack frames beneath loaded package roots",
    stack:
      "TypeError: Cannot read properties of undefined (reading 'runtime')\n" +
      "    at streamSimple (file:///home/fedora/.local/lib/node_modules/@msa/coding-agent/dist/bundle/chunks/chunk-CMRUVXTE.js:1093:16944)\n" +
      "    at /home/fedora/.msa/agent/npm/node_modules/msa-observational-memory/src/agents/worker-stream.ts:43:45",
  },
  {
    expected: ["npm:@scope/memory"],
    extensions: [
      packageExtension("npm:@scope/memory", windowsRoot, "extensions/first.ts"),
      packageExtension("npm:@scope/memory", windowsRoot, "extensions/second.ts"),
    ],
    name: "normalizes Windows paths and deduplicates package extensions",
    stack:
      "Error: broken\n" +
      "    at run (c:\\users\\reporter\\.msa\\agent\\npm\\node_modules\\@scope\\memory\\src\\worker.ts:4:2)",
  },
  {
    expected: ["/plugins/b.ts"],
    extensions: [pluginExtension("a"), pluginExtension("b")],
    name: "does not attribute sibling single-file packages",
    stack: "Error: broken\n    at run (file:///plugins/b.ts:4:2)",
  },
  {
    expected: [],
    extensions: [memoryPackage],
    name: "ignores extension paths in the error message",
    stack: `Error: Failed to read ${memoryPackage.resolvedPath}\n    at run (file:///opt/msa/dist/core.js:4:2)`,
  },
  {
    expected: [localMemoryPath],
    extensions: [localMemory],
    name: "decodes frame paths independently from malformed error text",
    stack:
      "Error: progress 100%\n    at run (file:///Users/reporter/.msa/agent/extensions/local%20memory/worker.ts:4:2)",
  },
];

describe("extension crash attribution", () => {
  test.each(attributionCases)("$name", ({ expected, extensions, stack }) => {
    expect(findExtensionStackMatches(stack, extensions)).toEqual(expected);
  });
});
