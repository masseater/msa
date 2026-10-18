import * as NodePath from "@effect/platform-node/NodePath";
import { ManagedRuntime, Path } from "effect";

const runtime = ManagedRuntime.make(NodePath.layer);

const usePath = <A>(use: (path: Path.Path) => A): A => runtime.runSync(Path.Path.useSync(use));

export const join = (...parts: string[]): string => usePath((path) => path.join(...parts));

export const dirname = (value: string): string => usePath((path) => path.dirname(value));

export const basename = (value: string): string => usePath((path) => path.basename(value));

export const stem = (value: string): string => usePath((path) => path.parse(value).name);

export const resolve = (...parts: string[]): string => usePath((path) => path.resolve(...parts));
