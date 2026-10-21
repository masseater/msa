import pathsModule from "../../utils/paths.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import resourceFiles from "./resource-files.ts";

const { canonicalizePath } = pathsModule;
const { resourcePrecedenceRank } = resourceFiles;

function resolvedPathsOf(
  accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
): packageManagerTypes.ResolvedPaths {
  const mapToResolved = (
    entries: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
  ): packageManagerTypes.ResolvedResource[] => {
    const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
      enabled,
      metadata,
      path,
    }));
    resolved.sort(
      (a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata),
    );

    const seen = new Set<string>();
    return resolved.filter((entry) => {
      const canonicalPath = canonicalizePath(entry.path);
      if (seen.has(canonicalPath)) return false;
      seen.add(canonicalPath);
      return true;
    });
  };

  return {
    extensions: mapToResolved(accumulator.extensions),
    prompts: mapToResolved(accumulator.prompts),
    skills: mapToResolved(accumulator.skills),
    themes: mapToResolved(accumulator.themes),
  };
}

const resolvedResourcePaths = { resolvedPathsOf };

export default resolvedResourcePaths;
