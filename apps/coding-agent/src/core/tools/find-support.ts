import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import { ToolFailure, fromPromise, pathOperations } from "../platform/index.ts";
import { DEFAULT_MAX_BYTES, type TruncationResult, formatSize, truncateHead } from "./truncate.ts";

export const findSchema = Type.Object({
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  pattern: Type.String({
    description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
  }),
});

export const DEFAULT_FIND_LIMIT = 1000;

export interface FindToolDetails {
  truncation?: TruncationResult;
  resultLimitReached?: number;
}

export interface FindPathModule {
  readonly sep: string;
  readonly isAbsolute: (path: string) => boolean;
  readonly relative: (from: string, to: string) => string;
}

export interface FindRequest {
  pattern: string;
  searchPath: string;
  effectiveLimit: number;
}

export const noFilesFound = {
  content: [{ text: "No files found matching pattern", type: "text" as const }],
  details: undefined,
};

export interface FindOutputInput {
  results: string[];
  effectiveLimit: number;
  limitNotice: string;
}

export function formatFindOutput({ results, effectiveLimit, limitNotice }: FindOutputInput) {
  const truncation = truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
  const details: FindToolDetails = {};
  const notices: string[] = [];
  if (results.length >= effectiveLimit) {
    notices.push(limitNotice);
    details.resultLimitReached = effectiveLimit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  const text =
    notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return {
    content: [{ text, type: "text" as const }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}

export const relativizeFindResultPath: {
  (searchPath: string, pathModule?: FindPathModule): (resultPath: string) => string;
  (resultPath: string, searchPath: string, pathModule?: FindPathModule): string;
} = dual(
  (args) => typeof args[1] === "string",
  (resultPath: string, searchPath: string, pathModule: FindPathModule = pathOperations): string => {
    const hadTrailingSeparator =
      resultPath.endsWith(pathModule.sep) || (pathModule.sep === "\\" && resultPath.endsWith("/"));
    const relativePath = pathModule.isAbsolute(resultPath)
      ? pathModule.relative(searchPath, resultPath)
      : resultPath;
    const posixPath = relativePath.split(pathModule.sep).join("/");
    return hadTrailingSeparator && !posixPath.endsWith("/") ? `${posixPath}/` : posixPath;
  },
);

export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  glob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]> | string[];
}

export const globWithOperations = Effect.fn("findWithOperations")(function* (
  ops: FindOperations,
  { pattern, searchPath, effectiveLimit }: FindRequest,
) {
  const exists = yield* fromPromise(() => ops.exists(searchPath));
  if (!exists) return yield* new ToolFailure({ message: `Path not found: ${searchPath}` });
  const results = yield* fromPromise(() =>
    ops.glob(pattern, searchPath, {
      ignore: ["**/node_modules/**", "**/.git/**"],
      limit: effectiveLimit,
    }),
  );
  if (results.length === 0) return noFilesFound;
  return formatFindOutput({
    effectiveLimit,
    limitNotice: `${effectiveLimit} results limit reached`,
    results: results.map((result) => relativizeFindResultPath(result, searchPath)),
  });
});
