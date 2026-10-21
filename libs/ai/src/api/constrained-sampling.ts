import constrainedSamplingGrammar from "./constrained-sampling-grammar.ts";
import constrainedSamplingSchema from "./constrained-sampling-schema.ts";

const constrainedSampling = {
  appendGrammarToolInputJsonDelta: constrainedSamplingGrammar.appendGrammarToolInputJsonDelta,
  createGrammarToolInputProperties: constrainedSamplingGrammar.createGrammarToolInputProperties,
  getGrammarToolInput: constrainedSamplingGrammar.getGrammarToolInput,
  getJsonSchemaToolParameters: constrainedSamplingSchema.getJsonSchemaToolParameters,
  makeStrictJsonSchema: constrainedSamplingSchema.makeStrictJsonSchema,
  resolveGrammarConstrainedSampling: constrainedSamplingGrammar.resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling: constrainedSamplingSchema.resolveJsonSchemaStrictSampling,
};

export default constrainedSampling;
