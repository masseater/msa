import type { ClassifierContext, ImagesContext } from "@msa/ai";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function describeValue(value: unknown): string {
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

type Fail = (problem: string) => Error;

function checkClassifierImages(images: unknown, fail: Fail): void {
  if (images === undefined) return;
  if (!Array.isArray(images))
    throw fail(`context.images must be an array, got ${describeValue(images)}`);
  images.forEach((image: unknown, index) => {
    if (
      !isRecord(image) ||
      image["type"] !== "image" ||
      typeof image["data"] !== "string" ||
      typeof image["mimeType"] !== "string"
    ) {
      throw fail(`context.images[${index}] must be an image block, got ${describeValue(image)}`);
    }
  });
}

const isStrings = (values: unknown[]): boolean =>
  values.length > 0 && values.every((value) => typeof value === "string");

function checkQuestion(id: string, question: unknown, fail: Fail): void {
  const at = `context.questions.${id}`;
  if (!isRecord(question))
    throw fail(`${at} must be a question object, got ${describeValue(question)}`);
  if (typeof question["instructions"] !== "string")
    throw fail(`${at}.instructions must be a string`);
  const { criteria } = question;
  if (question["type"] === "choice") {
    if (!isRecord(criteria) || !isStrings(Object.values(criteria)))
      throw fail(`${at} is a "choice" question, so criteria must map each label to its meaning`);
  } else if (question["type"] === "score") {
    if (!Array.isArray(criteria) || !isStrings(criteria)) {
      throw fail(
        `${at} is a "score" question, so criteria must list the levels as strings, lowest first`,
      );
    }
  } else if (question["type"] === "bool") {
    if (
      !isRecord(criteria) ||
      typeof criteria["true"] !== "string" ||
      typeof criteria["false"] !== "string"
    ) {
      throw fail(`${at} is a "bool" question, so criteria must be { true: string, false: string }`);
    }
  } else {
    throw fail(
      `${at}.type must be "choice", "score", or "bool", got ${JSON.stringify(question["type"])}`,
    );
  }
}

export function checkClassifierContext(context: unknown): ClassifierContext {
  const fail: Fail = (problem) =>
    new Error(`models.classify() ${problem}. Expected context: ${CLASSIFIER_CONTEXT_SHAPE}.`);
  if (!isRecord(context))
    throw fail(`expects a context object as its second argument, got ${describeValue(context)}`);
  if (!isRecord(context["state"]))
    throw fail(`context.state must be an object, got ${describeValue(context["state"])}`);
  checkClassifierImages(context["images"], fail);
  const { questions } = context;
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    throw fail(
      `context.questions must map question IDs to questions, got ${describeValue(questions)}`,
    );
  }
  for (const [id, question] of Object.entries(questions)) checkQuestion(id, question, fail);
  return context as unknown as ClassifierContext;
}

export function checkImagesContext(context: unknown): ImagesContext {
  const fail = (problem: string) =>
    new Error(
      `models.generateImages() ${problem}. Expected context: { input: [{ type: "text", text: <prompt> }, ...optional { type: "image", data: <base64>, mimeType } references] }.`,
    );
  if (!isRecord(context))
    throw fail(`expects a context object as its second argument, got ${describeValue(context)}`);
  const { input } = context;
  if (!Array.isArray(input) || input.length === 0) {
    throw fail(`context.input must be a non-empty array of blocks, got ${describeValue(input)}`);
  }
  input.forEach((block: unknown, index) => {
    if (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string") return;
    if (
      isRecord(block) &&
      block["type"] === "image" &&
      typeof block["data"] === "string" &&
      typeof block["mimeType"] === "string"
    )
      return;
    throw fail(
      `context.input[${index}] must be a text or image block, got ${describeValue(block)}`,
    );
  });
  return context as unknown as ImagesContext;
}
