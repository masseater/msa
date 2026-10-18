import { Path } from "effect";
import { dual } from "effect/Function";

import { testRuntime } from "./runtime.ts";

const path = testRuntime.runSync(Path.Path);

export const joinPath = (...parts: readonly string[]): string => path.join(...parts);

export const dirnameOf = (file: string): string => path.dirname(file);

export const basenameOf = (file: string): string => path.basename(file);

export const resolvePath = (...parts: readonly string[]): string => path.resolve(...parts);

export const isAbsolutePath = (file: string): boolean => path.isAbsolute(file);

export const pathDelimiter = path.sep === "\\" ? ";" : ":";

export const relativePath: {
  (to: string): (from: string) => string;
  (from: string, to: string): string;
} = dual(2, (from: string, to: string): string => path.relative(from, to));
