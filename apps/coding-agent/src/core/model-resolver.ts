import modelResolverPart1 from "./model-resolver-part1.ts";
import modelResolverPart2 from "./model-resolver-part2.ts";
import modelResolverPart3 from "./model-resolver-part3.ts";
import modelResolverPart4 from "./model-resolver-part4.ts";
import modelResolverPart5 from "./model-resolver-part5.ts";

const {
  defaultModelPerProvider,
  findExactModelReferenceMatch,
  findModelPolicyDenial,
  formatModelPolicyDenialError,
  resolveModelReference,
} = modelResolverPart1;
const { findInitialModel, resolveCliModel } = modelResolverPart4;
const { resolveModelScope, resolveModelScopeWithDiagnostics } = modelResolverPart3;
const { resolveModelScopeFromModels } = modelResolverPart2;
const { restoreModelFromSession } = modelResolverPart5;

const modelResolver = {
  defaultModelPerProvider,
  findExactModelReferenceMatch,
  findInitialModel,
  findModelPolicyDenial,
  formatModelPolicyDenialError,
  resolveCliModel,
  resolveModelReference,
  resolveModelScope,
  resolveModelScopeFromModels,
  resolveModelScopeWithDiagnostics,
  restoreModelFromSession,
};

export default modelResolver;
