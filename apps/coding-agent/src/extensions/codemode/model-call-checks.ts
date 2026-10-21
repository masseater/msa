import type aiTypes from "@msa/ai/index.types";

import toolModule from "./tool.ts";

const { CODEMODE_DOCS_PATH } = toolModule;

const MODEL_TYPES: ReadonlySet<string> = new Set<aiTypes.ModelType>([
  "chat",
  "image",
  "classifier",
]);

function toModelType(value: unknown): aiTypes.ModelType {
  if (typeof value === "string" && MODEL_TYPES.has(value)) return value as aiTypes.ModelType;
  throw new Error(
    `Unknown model type ${JSON.stringify(value)}. Use "chat", "image", or "classifier".`,
  );
}

function toProvider(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("provider must be a string");
  return value;
}

function toModelInfo(model: aiTypes.AnyModel): Record<string, unknown> {
  const info: Record<string, unknown> = { ...model };
  delete info["headers"];
  return info;
}

function withArticle(word: string): string {
  return `${/^[aeiou]/u.test(word) ? "an" : "a"} ${word}`;
}

type ScriptValue = { readonly [key: string]: unknown } | null | undefined;

function describeValue(value: unknown): string {
  if (value === undefined || value === null) return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "an empty array" : "an array";
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return `{ ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", ..." : ""} }`;
  }
  return typeof value === "string" ? "a string" : `a ${typeof value}`;
}

const CLASSIFIER_CONTEXT_SHAPE =
  '{ state: { ... }, images?: [{ type: "image", data: <base64>, mimeType }], questions: { <id>: { type: "choice", instructions, criteria: { <label>: <meaning> } } | { type: "score", instructions, criteria: [<lowest level>, ..., <highest level>] } | { type: "bool", instructions, criteria: { true: <meaning>, false: <meaning> } } } }';

function checkClassifierContext(context: unknown): aiTypes.ClassifierContext {
  const fail = (problem: string) =>
    new Error(
      `models.classify() ${problem}. Expected context: ${CLASSIFIER_CONTEXT_SHAPE}. See "Classify" in ${CODEMODE_DOCS_PATH}.`,
    );
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw fail(`expects a context object as its second argument, got ${describeValue(context)}`);
  }
  const { state, images, questions } = context as Record<string, unknown>;
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw fail(`context.state must be an object, got ${describeValue(state)}`);
  }
  if (images !== undefined) {
    if (!Array.isArray(images))
      throw fail(`context.images must be an array, got ${describeValue(images)}`);
    images.forEach((image: ScriptValue, index) => {
      if (
        image?.["type"] !== "image" ||
        typeof image["data"] !== "string" ||
        typeof image["mimeType"] !== "string"
      ) {
        throw fail(`context.images[${index}] must be an image block, got ${describeValue(image)}`);
      }
    });
  }
  if (
    typeof questions !== "object" ||
    questions === null ||
    Array.isArray(questions) ||
    Object.keys(questions).length === 0
  ) {
    throw fail(
      `context.questions must map question IDs to questions, got ${describeValue(questions)}`,
    );
  }
  const isStrings = (values: unknown[]) =>
    values.length > 0 && values.every((value) => typeof value === "string");
  for (const [id, question] of Object.entries(questions)) {
    const at = `context.questions.${id}`;
    if (typeof question !== "object" || question === null || Array.isArray(question)) {
      throw fail(`${at} must be a question object, got ${describeValue(question)}`);
    }
    const { type, instructions, criteria } = question as Record<string, unknown>;
    checkClassifierQuestion(instructions, fail, at, type, criteria, isStrings);
  }
  return context as unknown as aiTypes.ClassifierContext;
}

function checkClassifierQuestion(
  instructions: unknown,
  fail: (problem: string) => Error,
  at: string,
  type: unknown,
  criteria: unknown,
  isStrings: (values: unknown[]) => boolean,
) {
  if (typeof instructions !== "string") throw fail(`${at}.instructions must be a string`);
  if (type === "choice") {
    if (
      typeof criteria !== "object" ||
      criteria === null ||
      Array.isArray(criteria) ||
      !isStrings(Object.values(criteria))
    ) {
      throw fail(`${at} is a "choice" question, so criteria must map each label to its meaning`);
    }
  } else if (type === "score") {
    if (!Array.isArray(criteria) || !isStrings(criteria)) {
      throw fail(
        `${at} is a "score" question, so criteria must list the levels as strings, lowest first`,
      );
    }
  } else if (type === "bool") {
    const labels = criteria as ScriptValue;
    if (typeof labels?.["true"] !== "string" || typeof labels["false"] !== "string") {
      throw fail(`${at} is a "bool" question, so criteria must be { true: string, false: string }`);
    }
  } else {
    throw fail(`${at}.type must be "choice", "score", or "bool", got ${JSON.stringify(type)}`);
  }
}

function checkImagesContext(context: unknown): aiTypes.ImagesContext {
  const fail = (problem: string) =>
    new Error(
      `models.generateImages() ${problem}. Expected context: { input: [{ type: "text", text: <prompt> }, ...optional { type: "image", data: <base64>, mimeType } references] }. See "Generate images" in ${CODEMODE_DOCS_PATH}.`,
    );
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw fail(`expects a context object as its second argument, got ${describeValue(context)}`);
  }
  const { input } = context as Record<string, unknown>;
  if (!Array.isArray(input) || input.length === 0) {
    throw fail(`context.input must be a non-empty array of blocks, got ${describeValue(input)}`);
  }
  input.forEach((block: ScriptValue, index) => {
    if (block?.["type"] === "text" && typeof block["text"] === "string") return;
    if (
      block?.["type"] === "image" &&
      typeof block["data"] === "string" &&
      typeof block["mimeType"] === "string"
    )
      return;
    throw fail(
      `context.input[${index}] must be a text or image block, got ${describeValue(block)}`,
    );
  });
  return context as unknown as aiTypes.ImagesContext;
}

function modelReference(model: unknown, name: string, type: string, listHint: string) {
  const given = model as ScriptValue;
  if (typeof given?.["provider"] !== "string" || typeof given["id"] !== "string") {
    const undefinedHint =
      model === undefined || model === null
        ? " models.getModelOfType() returns undefined for an unknown provider or id."
        : "";
    throw new Error(
      `${name}() expects ${withArticle(type)} model as its first argument, got ${describeValue(model)}.${undefinedHint} ${listHint}`,
    );
  }
  const provider = given["provider"];
  const id = given["id"];
  return { id, provider };
}

const modelCallChecks = {
  MODEL_TYPES,
  checkClassifierContext,
  checkImagesContext,
  describeValue,
  modelReference,
  toModelInfo,
  toModelType,
  toProvider,
  withArticle,
};

export default modelCallChecks;
