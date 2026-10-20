import type defaultPackageManagerInternalTypes from "../src/core/default-package-manager-internal.types.ts";

type ParsedSource = defaultPackageManagerInternalTypes.ParsedSource;

function narrow<T extends ParsedSource["type"]>(
  parsed: ParsedSource,
  type: T,
): Extract<ParsedSource, { type: T }> {
  if (parsed.type !== type) throw new Error(`expected a ${type} source, got ${parsed.type}`);
  return parsed as Extract<ParsedSource, { type: T }>;
}

const parsedSource = {
  asGit: (parsed: ParsedSource) => narrow(parsed, "git"),
  asLocal: (parsed: ParsedSource) => narrow(parsed, "local"),
};

export default parsedSource;
