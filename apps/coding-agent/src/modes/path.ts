import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, ManagedRuntime, Path } from "effect";
import { dual } from "effect/Function";

import platformNode from "../core/platform-node.ts";

const pathService = ManagedRuntime.make(NodePath.layer).runSync(
  Path.Path.use((service) => Effect.succeed(service)),
);

const isAbsolute = (path: string): boolean => pathService.isAbsolute(path);

const posixService = ManagedRuntime.make(NodePath.layerPosix).runSync(
  Path.Path.use((service) => Effect.succeed(service)),
);

const posixRelative: {
  (to: string): (from: string) => string;
  (from: string, to: string): string;
} = dual(2, (from: string, to: string): string => posixService.relative(from, to));

const posixParse = (path: string): Path.Path.Parsed => posixService.parse(path);

const path = {
  basename: platformNode.basename,
  dirname: platformNode.dirname,
  isAbsolute,
  join: platformNode.join,
  posixParse,
  posixRelative,
  randomUuid: platformNode.randomUuid,
  relative: platformNode.relative,
  resolve: platformNode.resolve,
  sep: platformNode.sep,
};

export default path;
