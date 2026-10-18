import {
  OPENAI_COMPLETIONS_REASONING_FIELDS,
  type OpenAICompletionsReasoningField,
  type OpenAIEncryptedReasoningDetail,
  type OpenAIReasoningDetail,
  type OpenAIReasoningDetailBase,
} from "./openai-completions-types.ts";

function isReasoningDetailObject(detail: unknown): detail is Record<string, unknown> {
  return typeof detail === "object" && detail !== null && !Array.isArray(detail);
}

function hasValidCommonReasoningDetailFields(candidate: Record<string, unknown>): boolean {
  return (
    (candidate["id"] === undefined ||
      candidate["id"] === null ||
      typeof candidate["id"] === "string") &&
    (candidate["format"] === undefined || typeof candidate["format"] === "string") &&
    (candidate["index"] === undefined || typeof candidate["index"] === "number")
  );
}

function isOpenAIReasoningDetail(detail: unknown): detail is OpenAIReasoningDetail {
  if (!isReasoningDetailObject(detail) || !hasValidCommonReasoningDetailFields(detail)) {
    return false;
  }
  switch (detail["type"]) {
    case "reasoning.summary":
      return typeof detail["summary"] === "string";
    case "reasoning.encrypted":
      return typeof detail["data"] === "string";
    case "reasoning.text":
      return (
        typeof detail["text"] === "string" &&
        (detail["signature"] === undefined ||
          detail["signature"] === null ||
          typeof detail["signature"] === "string")
      );
    default:
      return false;
  }
}

function parseOpenAIReasoningDetails(
  signature: string | undefined,
): OpenAIReasoningDetail[] | undefined {
  if (signature === undefined || signature === "") return undefined;
  try {
    const parsed = JSON.parse(signature) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isOpenAIReasoningDetail)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function parseLegacyEncryptedReasoningDetail(
  signature: string | undefined,
): OpenAIEncryptedReasoningDetail | undefined {
  if (signature === undefined || signature === "") return undefined;
  try {
    const parsed = JSON.parse(signature) as unknown;
    return isOpenAIReasoningDetail(parsed) &&
      parsed.type === "reasoning.encrypted" &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0 &&
      parsed.data.length > 0
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function fillMissingCommonReasoningDetailFields(
  target: OpenAIReasoningDetailBase,
  source: OpenAIReasoningDetail,
): void {
  if (target.id === undefined || target.id === null) {
    if (source.id === undefined) delete target.id;
    else target.id = source.id;
  }
  if (target.format === undefined || target.format === "") {
    if (source.format === undefined) delete target.format;
    else target.format = source.format;
  }
  if (target.index === undefined) {
    if (source.index === undefined) delete target.index;
    else target.index = source.index;
  }
}

function mergeReasoningText(
  lastDetail: OpenAIReasoningDetail & { type: "reasoning.text" },
  detail: OpenAIReasoningDetail & { type: "reasoning.text" },
): void {
  lastDetail.text += detail.text;
  if (
    lastDetail.signature === undefined ||
    lastDetail.signature === null ||
    lastDetail.signature === ""
  ) {
    if (detail.signature === undefined) delete lastDetail.signature;
    else lastDetail.signature = detail.signature;
  }
  fillMissingCommonReasoningDetailFields(lastDetail, detail);
}

function appendOpenAIReasoningDetail(input: {
  details: OpenAIReasoningDetail[];
  detail: OpenAIReasoningDetail;
}): void {
  const { details, detail } = input;
  const lastDetail = details.at(-1);
  if (detail.type === "reasoning.text" && lastDetail?.type === "reasoning.text") {
    mergeReasoningText(lastDetail, detail);
    return;
  }
  if (detail.type === "reasoning.summary" && lastDetail?.type === "reasoning.summary") {
    lastDetail.summary += detail.summary;
    fillMissingCommonReasoningDetailFields(lastDetail, detail);
    return;
  }
  details.push({ ...detail });
}

function isOpenAICompletionsReasoningField(
  field: string,
): field is OpenAICompletionsReasoningField {
  return OPENAI_COMPLETIONS_REASONING_FIELDS.includes(field as OpenAICompletionsReasoningField);
}

export {
  appendOpenAIReasoningDetail,
  isOpenAICompletionsReasoningField,
  isOpenAIReasoningDetail,
  parseLegacyEncryptedReasoningDetail,
  parseOpenAIReasoningDetails,
};
