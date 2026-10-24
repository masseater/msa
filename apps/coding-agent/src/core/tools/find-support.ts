import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import platform from "../platform/index.ts";
import type findSupportTypes from "./find-support.types.ts";
import truncate from "./truncate.ts";

const { DEFAULT_MAX_BYTES, formatSize, truncateHead } = truncate;
const { ToolFailure, fromPromise } = platform;

const findSchema = Type.Object({
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  pattern: Type.String({
    description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
  }),
});

const DEFAULT_FIND_LIMIT = 1000;

const noFilesFound = {
  content: [{ text: "No files found matching pattern", type: "text" as const }],
  details: undefined,
};

function formatFindOutput({
  results,
  effectiveLimit,
  limitNotice,
}: findSupportTypes.FindOutputInput) {
  const truncation = truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
  const details: findSupportTypes.FindToolDetails = {};
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

const relativizeFindResultPath: {
  (
    searchPath: string,
    pathModule?: findSupportTypes.FindPathModule,
  ): (resultPath: string) => string;
  (resultPath: string, searchPath: string, pathModule?: findSupportTypes.FindPathModule): string;
} = dual(
  (args) => typeof args[1] === "string",
  (
    resultPath: string,
    searchPath: string,
    pathModule: findSupportTypes.FindPathModule = platform,
  ): string => {
    const hadTrailingSeparator =
      resultPath.endsWith(pathModule.sep) || (pathModule.sep === "\\" && resultPath.endsWith("/"));
    const relativePath = pathModule.isAbsolute(resultPath)
      ? pathModule.relative(searchPath, resultPath)
      : resultPath;
    const posixPath = relativePath.split(pathModule.sep).join("/");
    return hadTrailingSeparator && !posixPath.endsWith("/") ? `${posixPath}/` : posixPath;
  },
);

const globWithOperations = Effect.fn("findWithOperations")(function* (
  ops: findSupportTypes.FindOperations,
  { pattern, searchPath, effectiveLimit }: findSupportTypes.FindRequest,
) {
  const exists = yield* fromPromise(() => ops.exists(searchPath));
  if (!exists) return yield* ToolFailure.make({ message: `Path not found: ${searchPath}` });
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

const findSupport = {
  DEFAULT_FIND_LIMIT,
  findSchema,
  formatFindOutput,
  globWithOperations,
  noFilesFound,
  relativizeFindResultPath,
};

export default findSupport;
