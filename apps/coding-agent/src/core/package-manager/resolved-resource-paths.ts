import pathsModule from "../../utils/paths.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import resourceFiles from "./resource-files.ts";

const { canonicalizePath } = pathsModule;
const { resourcePrecedenceRank } = resourceFiles;

function mapToResolved(
  entries: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
): Promise<packageManagerTypes.ResolvedResource[]> {
  const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
    enabled,
    metadata,
    path,
  }));
  resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata));
  return Promise.all(resolved.map((entry) => canonicalizePath(entry.path))).then(
    (canonicalPaths) => {
      const seen = new Set<string>();
      return resolved.filter((_entry, index) => {
        const canonicalPath = canonicalPaths[index]!;
        if (seen.has(canonicalPath)) return false;
        seen.add(canonicalPath);
        return true;
      });
    },
  );
}

function resolvedPathsOf(
  accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
): Promise<packageManagerTypes.ResolvedPaths> {
  return Promise.all([
    mapToResolved(accumulator.extensions),
    mapToResolved(accumulator.prompts),
    mapToResolved(accumulator.skills),
    mapToResolved(accumulator.themes),
  ]).then(([extensions, prompts, skills, themes]) => ({ extensions, prompts, skills, themes }));
}

const resolvedResourcePaths = { resolvedPathsOf };

export default resolvedResourcePaths;
