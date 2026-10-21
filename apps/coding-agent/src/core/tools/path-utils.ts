import { Effect, FileSystem } from "effect";
import { dual } from "effect/Function";

import paths from "../../utils/paths.ts";
import nodeRuntime from "../platform/runtime.ts";

const { normalizePath, resolvePath } = paths;

const NARROW_NO_BREAK_SPACE = "\u202F";

const tryMacOSScreenshotPath = (filePath: string): string =>
  filePath.replace(/ (AM|PM)\./giu, `${NARROW_NO_BREAK_SPACE}$1.`);

const tryNFDVariant = (filePath: string): string => filePath.normalize("NFD");

const tryCurlyQuoteVariant = (filePath: string): string => filePath.replace(/'/gu, "\u2019");

const exists = (filePath: string) =>
  FileSystem.FileSystem.use((fs) => fs.exists(filePath)).pipe(Effect.orElseSucceed(() => false));

const pathExists = (filePath: string): Promise<boolean> => nodeRuntime.runPromise(exists(filePath));

function expandPath(filePath: string): string {
  return normalizePath(filePath, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

const resolveToCwdImpl = (filePath: string, cwd: string): string =>
  resolvePath(filePath, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true });

const resolveToCwd: {
  (cwd: string): (filePath: string) => string;
  (filePath: string, cwd: string): string;
} = dual(2, resolveToCwdImpl);

const resolveReadPathEffect = Effect.fn("resolveReadPath")(function* (
  filePath: string,
  cwd: string,
) {
  const resolved = resolveToCwdImpl(filePath, cwd);
  const nfdVariant = tryNFDVariant(resolved);
  const candidates = [
    resolved,
    tryMacOSScreenshotPath(resolved),
    nfdVariant,
    tryCurlyQuoteVariant(resolved),
    tryCurlyQuoteVariant(nfdVariant),
  ];
  for (const [index, candidate] of candidates.entries()) {
    if (index > 0 && candidate === resolved) continue;
    if (yield* exists(candidate)) return candidate;
  }
  return resolved;
});

const resolveReadPathAsync: {
  (cwd: string): (filePath: string) => Promise<string>;
  (filePath: string, cwd: string): Promise<string>;
} = dual(2, (filePath: string, cwd: string) =>
  nodeRuntime.runPromise(resolveReadPathEffect(filePath, cwd)),
);

const resolveReadPath = resolveReadPathAsync;

const pathUtils = {
  expandPath,
  pathExists,
  resolveReadPath,
  resolveReadPathAsync,
  resolveToCwd,
};

export default pathUtils;
