import type aiTypes from "../index.types.ts";
import type jsonTypesModule from "../json-types.ts";
import type mediaTypesModule from "../media-types.ts";
import type messageTypesModule from "../message-types.types.ts";

declare namespace aiMessagesKitTypes {
  type IsJsonCompatible<T> = jsonTypesModule.IsJsonCompatible<T>;
  type JsonObject = jsonTypesModule.JsonObject;
  type JsonRepresentation<T> = jsonTypesModule.JsonRepresentation<T>;
  type JsonValue = jsonTypesModule.JsonValue;
  type AssistantImages = mediaTypesModule.AssistantImages;
  type ClassifierAnswer = mediaTypesModule.ClassifierAnswer;
  type ClassifierBoolAnswer = mediaTypesModule.ClassifierBoolAnswer;
  type ClassifierBoolQuestion = mediaTypesModule.ClassifierBoolQuestion;
  type ClassifierChoiceAnswer = mediaTypesModule.ClassifierChoiceAnswer;
  type ClassifierChoiceQuestion = mediaTypesModule.ClassifierChoiceQuestion;
  type ClassifierContext = mediaTypesModule.ClassifierContext;
  type ClassifierQuestion = mediaTypesModule.ClassifierQuestion;
  type ClassifierResult = mediaTypesModule.ClassifierResult;
  type ClassifierScoreAnswer = mediaTypesModule.ClassifierScoreAnswer;
  type ClassifierScoreQuestion = mediaTypesModule.ClassifierScoreQuestion;
  type ClassifierStopReason = mediaTypesModule.ClassifierStopReason;
  type ImagesContext = mediaTypesModule.ImagesContext;
  type ImagesInputContent = mediaTypesModule.ImagesInputContent;
  type ImagesOutputContent = mediaTypesModule.ImagesOutputContent;
  type ImagesStopReason = mediaTypesModule.ImagesStopReason;
  type AssistantMessage = messageTypesModule.AssistantMessage;
  type AssistantMessageEvent = messageTypesModule.AssistantMessageEvent;
  type ConstrainedSamplingConfig = messageTypesModule.ConstrainedSamplingConfig;
  type Context = messageTypesModule.Context;
  type DeferredHandle = messageTypesModule.DeferredHandle;
  type GrammarFormat = messageTypesModule.GrammarFormat;
  type GrammarVariants = messageTypesModule.GrammarVariants;
  type ImageContent = messageTypesModule.ImageContent;
  type Message = messageTypesModule.Message;
  type NestedToolCallRecord = messageTypesModule.NestedToolCallRecord;
  type NestedToolCalls = messageTypesModule.NestedToolCalls;
  type StopReason = messageTypesModule.StopReason;
  type SystemMessage = messageTypesModule.SystemMessage;
  type TextContent = messageTypesModule.TextContent;
  type TextSignatureV1 = messageTypesModule.TextSignatureV1;
  type ThinkingContent = messageTypesModule.ThinkingContent;
  type Tool<TParameters extends aiTypes.TSchema = aiTypes.TSchema> =
    messageTypesModule.Tool<TParameters>;
  type ToolCall = messageTypesModule.ToolCall;
  type ToolReference = messageTypesModule.ToolReference;
  type ToolResultMessage<TDetails = aiTypes.JsonValue> =
    messageTypesModule.ToolResultMessage<TDetails>;
  type TranscriptContext = messageTypesModule.TranscriptContext;
  type Usage = messageTypesModule.Usage;
  type UserMessage = messageTypesModule.UserMessage;
}

export type { aiMessagesKitTypes as default };
