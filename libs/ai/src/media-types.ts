import type { JsonObject } from "./json-types.ts";
import type { ImageContent, TextContent, Usage } from "./message-types.ts";
import type { ClassifierApi, ImageApi, ProviderId } from "./types.ts";

export type ImagesInputContent = TextContent | ImageContent;
export type ImagesOutputContent = TextContent | ImageContent;

export interface ImagesContext {
  input: ImagesInputContent[];
}

export type ImagesStopReason = "stop" | "error" | "aborted";

export interface AssistantImages {
  api: ImageApi;
  provider: ProviderId;
  model: string;
  output: ImagesOutputContent[];
  responseId?: string;
  usage?: Usage;
  stopReason: ImagesStopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ClassifierChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface ClassifierScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export interface ClassifierBoolQuestion {
  type: "bool";
  instructions: string;
  criteria: { true: string; false: string };
}

export type ClassifierQuestion =
  | ClassifierChoiceQuestion
  | ClassifierScoreQuestion
  | ClassifierBoolQuestion;

export interface ClassifierContext {
  state: JsonObject;
  images?: ImageContent[];
  questions: Record<string, ClassifierQuestion>;
}

export interface ClassifierChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ClassifierScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
}

export interface ClassifierBoolAnswer {
  type: "bool";
  probability: number;
}

export type ClassifierAnswer =
  | ClassifierChoiceAnswer
  | ClassifierScoreAnswer
  | ClassifierBoolAnswer;
export type ClassifierStopReason = "stop" | "error" | "aborted";

export interface ClassifierResult {
  api: ClassifierApi;
  provider: ProviderId;
  model: string;
  answers: Record<string, ClassifierAnswer>;
  usage?: Usage;
  stopReason: ClassifierStopReason;
  errorMessage?: string;
  timestamp: number;
}
