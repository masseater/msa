import type typesModule from "./types.types.ts";

function idFromNumber<I extends typesModule.Id<string>>(value: number): I {
  return value as I;
}

function seqFromNumber(value: number): typesModule.Seq {
  return value as typesModule.Seq;
}

const ids = {
  idFromNumber,
  seqFromNumber,
};

export default ids;
