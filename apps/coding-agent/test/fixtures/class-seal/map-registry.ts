import Local from "./local.ts";

const registry = new Map<string, unknown>([["base", Local]]);

export default class X extends (registry.get("base") as typeof Local) {}
