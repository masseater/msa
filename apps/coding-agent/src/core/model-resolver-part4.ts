import modelResolverPart4Part1 from "./model-resolver-part4-part1.ts";
import modelResolverPart4Part2 from "./model-resolver-part4-part2.ts";

const { findInitialModel, restoreModelFromSessionPart5 } = modelResolverPart4Part2;
const { resolveCliModel } = modelResolverPart4Part1;

const modelResolverPart4 = {
  findInitialModel,
  resolveCliModel,
  restoreModelFromSessionPart5,
};

export default modelResolverPart4;
