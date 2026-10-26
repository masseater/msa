import { Context } from "effect";

export default class S extends Context.Service<S, { readonly n: number }>()(
  "@msa/coding-agent/test/fixtures/class-seal/context-service/S",
) {}
