import tui from "@msa/tui";
import { Context, Data } from "effect";

const parentOf = (value: object): object => Object.getPrototypeOf(value) as object;

const errorBase = parentOf(Data.TaggedError("msa/class-seal/fixture")) as new () => object;

const sharedBases = {
  errorBase,
  serviceBase: parentOf(Context.Service()("msa/class-seal/fixture")),
  textPrototype: parentOf(tui.Loader.prototype),
  yieldableError: parentOf(errorBase),
};

export default sharedBases;
