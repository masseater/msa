import * as NodeServices from "@effect/platform-node/NodeServices";
import { ManagedRuntime } from "effect";

const platformRuntime = ManagedRuntime.make(NodeServices.layer);

export default platformRuntime;
