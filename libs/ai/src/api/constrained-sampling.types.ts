import type constrainedSamplingGrammarTypes from "./constrained-sampling-grammar.types.ts";
import type constrainedSamplingSchemaTypes from "./constrained-sampling-schema.types.ts";

declare namespace constrainedSamplingTypes {
  type GrammarConstrainedSampling = constrainedSamplingGrammarTypes.GrammarConstrainedSampling;

  type GrammarToolInputJsonBuffer = constrainedSamplingGrammarTypes.GrammarToolInputJsonBuffer;

  type UnsupportedStrictSchemaKeywordCheck =
    constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck;
}

export type { constrainedSamplingTypes as default };
