import * as NodeServices from "@effect/platform-node/NodeServices";
import { ManagedRuntime } from "effect";

export const nodeRuntime = ManagedRuntime.make(NodeServices.layer);
