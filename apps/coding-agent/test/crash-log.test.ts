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

const matchesStackFramesBeneathLoadedPackageRoots = () => {
  const memory = packageExtension(
    "npm:msa-observational-memory",
    "/home/fedora/.msa/agent/npm/node_modules/msa-observational-memory",
  );
  const unrelated = packageExtension(
    "npm:unrelated",
    "/home/fedora/.msa/agent/npm/node_modules/unrelated",
  );
  const stack =
    "TypeError: Cannot read properties of undefined (reading 'runtime')\n" +
    "    at streamSimple (file:///home/fedora/.local/lib/node_modules/@msa/coding-agent/dist/bundle/chunks/chunk-CMRUVXTE.js:1093:16944)\n" +
    "    at /home/fedora/.msa/agent/npm/node_modules/msa-observational-memory/src/agents/worker-stream.ts:43:45";

  expect(findExtensionStackMatches(stack, [memory, unrelated])).toEqual([
    "npm:msa-observational-memory",
  ]);
};

const normalizesWindowsPathsAndDeduplicatesPackageExtensions = () => {
  const root = "C:\\Users\\reporter\\.msa\\agent\\npm\\node_modules\\@scope\\memory";
  const first = packageExtension("npm:@scope/memory", root, "extensions/first.ts");
  const second = packageExtension("npm:@scope/memory", root, "extensions/second.ts");
  const stack =
    "Error: broken\n" +
    "    at run (c:\\users\\reporter\\.msa\\agent\\npm\\node_modules\\@scope\\memory\\src\\worker.ts:4:2)";

  expect(findExtensionStackMatches(stack, [first, second])).toEqual(["npm:@scope/memory"]);
};

const doesNotAttributeSiblingSingleFilePackages = () => {
  const extension = (name: string): StackExtension => ({
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
  const stack = "Error: broken\n    at run (file:///plugins/b.ts:4:2)";

  expect(findExtensionStackMatches(stack, [extension("a"), extension("b")])).toEqual([
    "/plugins/b.ts",
  ]);
};

const ignoresExtensionPathsInTheErrorMessage = () => {
  const extension = packageExtension("npm:memory", "/tmp/node_modules/memory");
  const stack = `Error: Failed to read ${extension.resolvedPath}\n    at run (file:///opt/msa/dist/core.js:4:2)`;

  expect(findExtensionStackMatches(stack, [extension])).toEqual([]);
};

const decodesFramePathsIndependentlyFromMalformedError = () => {
  const extension: StackExtension = {
    path: "/Users/reporter/.msa/agent/extensions/local memory/index.ts",
    resolvedPath: "/Users/reporter/.msa/agent/extensions/local memory/index.ts",
    sourceInfo: {
      baseDir: "/Users/reporter/.msa/agent/extensions",
      origin: "top-level",
      path: "/Users/reporter/.msa/agent/extensions/local memory/index.ts",
      scope: "user",
      source: "local",
    },
  };
  const stack =
    "Error: progress 100%\n    at run (file:///Users/reporter/.msa/agent/extensions/local%20memory/worker.ts:4:2)";

  expect(findExtensionStackMatches(stack, [extension])).toEqual([extension.path]);
};

describe("extension crash attribution", () => {
  test(
    "matches stack frames beneath loaded package roots",
    matchesStackFramesBeneathLoadedPackageRoots,
  );

  test(
    "normalizes Windows paths and deduplicates package extensions",
    normalizesWindowsPathsAndDeduplicatesPackageExtensions,
  );

  test(
    "does not attribute sibling single-file packages",
    doesNotAttributeSiblingSingleFilePackages,
  );

  test("ignores extension paths in the error message", ignoresExtensionPathsInTheErrorMessage);

  test(
    "decodes frame paths independently from malformed error text",
    decodesFramePathsIndependentlyFromMalformedError,
  );
});
