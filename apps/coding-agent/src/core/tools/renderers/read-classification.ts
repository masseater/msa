import config from "../../../config.ts";
import paths from "../../../utils/paths.ts";
import platform from "../../platform/index.ts";
import pathUtils from "../path-utils.ts";
import renderUtils from "../render-utils.ts";
import type readClassificationTypes from "./read-classification.types.ts";

const { pathOperations } = platform;
const { getReadmePath } = config;
const { str } = renderUtils;
const { resolveToCwd } = pathUtils;
const { formatPathRelativeToCwdOrAbsolute } = paths;

const COMPACT_RESOURCE_FILE_NAMES = new Set([
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
]);
type ClassificationArgs = { path?: string; file_path?: string };

function toPosixPath(filePath: string): string {
  return filePath.split(pathOperations.sep).join("/");
}
function getMsaDocsClassification(
  absolutePath: string,
): readClassificationTypes.CompactReadClassification | undefined {
  const packageRoot = pathOperations.dirname(getReadmePath());
  const relativePath = pathOperations.relative(
    pathOperations.resolve(packageRoot),
    pathOperations.resolve(absolutePath),
  );
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${pathOperations.sep}`) ||
    pathOperations.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  const label = toPosixPath(relativePath);
  if (label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/")) {
    return { kind: "docs", label };
  }
  return undefined;
}
function getCompactReadClassification({
  args,
  cwd,
}: {
  args: ClassificationArgs | undefined;
  cwd: string;
}): readClassificationTypes.CompactReadClassification | undefined {
  const rawPath = str(args?.file_path ?? args?.path);
  if (rawPath === null || rawPath === "") return undefined;

  const absolutePath = resolveToCwd(rawPath, cwd);
  const fileName = pathOperations.basename(absolutePath);
  if (fileName === "SKILL.md") {
    return {
      kind: "skill",
      label: pathOperations.basename(pathOperations.dirname(absolutePath)) || fileName,
    };
  }

  const docsClassification = getMsaDocsClassification(absolutePath);
  if (docsClassification !== undefined) return docsClassification;

  if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
    return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
  }

  return undefined;
}

const readClassification = {
  getCompactReadClassification,
};

export default readClassification;
