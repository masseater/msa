import { Path } from "effect";
import { dual } from "effect/Function";

import runtime from "./runtime.ts";

const { provideNode, runTestSync } = runtime;

const path = runTestSync(provideNode(Path.Path.useSync((service) => service)));

const joinPath = (...parts: readonly string[]): string => path.join(...parts);

const dirnameOf = (file: string): string => path.dirname(file);

const basenameOf = (file: string): string => path.basename(file);

const resolvePath = (...parts: readonly string[]): string => path.resolve(...parts);

const isAbsolutePath = (file: string): boolean => path.isAbsolute(file);

const pathDelimiter = path.sep === "\\" ? ";" : ":";

const relativePath: {
  (to: string): (from: string) => string;
  (from: string, to: string): string;
} = dual(2, (from: string, to: string): string => path.relative(from, to));

const paths = {
  basenameOf,
  dirnameOf,
  isAbsolutePath,
  joinPath,
  pathDelimiter,
  relativePath,
  resolvePath,
};

export default paths;
