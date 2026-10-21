import type jsonTypesModule from "./json-types.ts";
import type messageTypesModule from "./message-types.types.ts";
import type typesModule from "./types.types.ts";

declare namespace mediaTypesModule {
  type ImagesInputContent = messageTypesModule.TextContent | messageTypesModule.ImageContent;

  type ImagesOutputContent = messageTypesModule.TextContent | messageTypesModule.ImageContent;

  interface ImagesContext {
    input: ImagesInputContent[];
  }

  type ImagesStopReason = "stop" | "error" | "aborted";

  interface AssistantImages {
    api: typesModule.ImageApi;
    provider: typesModule.ProviderId;
    model: string;
    output: ImagesOutputContent[];
    responseId?: string;
    usage?: messageTypesModule.Usage;
    stopReason: ImagesStopReason;
    errorMessage?: string;
    timestamp: number;
  }

  interface ClassifierChoiceQuestion {
    type: "choice";
    instructions: string;
    criteria: Record<string, string>;
  }

  interface ClassifierScoreQuestion {
    type: "score";
    instructions: string;
    criteria: string[];
  }

  interface ClassifierBoolQuestion {
    type: "bool";
    instructions: string;
    criteria: { true: string; false: string };
  }

  type ClassifierQuestion =
    | ClassifierChoiceQuestion
    | ClassifierScoreQuestion
    | ClassifierBoolQuestion;

  interface ClassifierContext {
    state: jsonTypesModule.JsonObject;
    images?: messageTypesModule.ImageContent[];
    questions: Record<string, ClassifierQuestion>;
  }

  interface ClassifierChoiceAnswer {
    type: "choice";
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
  }

  interface ClassifierScoreAnswer {
    type: "score";
    score: number;
    confidence: number;
  }

  interface ClassifierBoolAnswer {
    type: "bool";
    probability: number;
  }

  type ClassifierAnswer = ClassifierChoiceAnswer | ClassifierScoreAnswer | ClassifierBoolAnswer;

  type ClassifierStopReason = "stop" | "error" | "aborted";

  interface ClassifierResult {
    api: typesModule.ClassifierApi;
    provider: typesModule.ProviderId;
    model: string;
    answers: Record<string, ClassifierAnswer>;
    usage?: messageTypesModule.Usage;
    stopReason: ClassifierStopReason;
    errorMessage?: string;
    timestamp: number;
  }
}

export type { mediaTypesModule as default };
