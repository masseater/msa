import type contractTypes from "./contract.types.ts";
import type typesModule from "./types.types.ts";

const stateMembers = (contract: contractTypes.AnyContract, shape: typesModule.Shape): string[] => {
  const members =
    shape.variant === undefined ? undefined : contract.description.variants[shape.variant];
  if (members === undefined) return [];
  return shape.members.filter((name) => members[name]?.kind === "state");
};

const remoteShape = {
  stateMembers,
};

export default remoteShape;
