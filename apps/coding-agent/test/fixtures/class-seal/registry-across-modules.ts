import type Local from "./local.ts";
import writer from "./writer.ts";

writer.install();

export default class X extends ((globalThis as Record<symbol, unknown>)[
  Symbol.for("msa.class-seal-fixture")
] as typeof Local) {}
