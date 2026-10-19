import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, ManagedRuntime, Path } from "effect";
import { dual } from "effect/Function";

export {
  basename,
  dirname,
  join,
  randomUuid,
  relative,
  resolve,
  sep,
} from "../core/platform-node.ts";

const pathService = ManagedRuntime.make(NodePath.layer).runSync(
  Path.Path.use((service) => Effect.succeed(service)),
);

export const isAbsolute = (path: string): boolean => pathService.isAbsolute(path);

const posixService = ManagedRuntime.make(NodePath.layerPosix).runSync(
  Path.Path.use((service) => Effect.succeed(service)),
);

export const posixRelative: {
  (to: string): (from: string) => string;
  (from: string, to: string): string;
} = dual(2, (from: string, to: string): string => posixService.relative(from, to));

export const posixParse = (path: string): Path.Path.Parsed => posixService.parse(path);
