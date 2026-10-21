import { Path } from "effect";

import type platformTypes from "./index.types.ts";
import nodePath from "./node/path.ts";
import platformRuntime from "./runtime.ts";

const pathService = platformRuntime.runSync(Path.Path);

const lastWindowsSeparator = (path: string): { trimmed: string; index: number } => {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return { index: Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")), trimmed };
};

const windowsBasename = (path: string): string => {
  const { trimmed, index } = lastWindowsSeparator(path);
  return trimmed.slice(index + 1);
};

const windowsDirname = (path: string): string => {
  const { trimmed, index } = lastWindowsSeparator(path);
  if (index < 0) return ".";
  const parent = trimmed.slice(0, index);
  return parent === "" || /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent;
};

const platformPath = {
  basename: (path: string, suffix?: string): string => pathService.basename(path, suffix),
  delimiter: nodePath.delimiter,
  dirname: (path: string): string => pathService.dirname(path),
  extname: (path: string): string => pathService.extname(path),
  isAbsolute: (path: string): boolean => pathService.isAbsolute(path),
  join: (...segments: readonly string[]): string => pathService.join(...segments),
  normalize: (path: string): string => pathService.normalize(path),
  parse: (path: string): platformTypes.ParsedPath => pathService.parse(path),
  posix: nodePath.posix,
  relative: (from: string, to: string): string => pathService.relative(from, to),
  resolve: (...segments: readonly string[]): string => pathService.resolve(...segments),
  sep: pathService.sep,
  toNamespacedPath: (path: string): string => pathService.toNamespacedPath(path),
  windowsBasename,
  windowsDirname,
};

export default platformPath;
