import type { ClassifierContext, ClassifierModel, ClassifierQuestion } from "../src/types.ts";

interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

interface FakeServerOptions {
  next?: (prompt: string, depth: number) => Record<string, number>;
  template?: (messages: Array<{ role: string; content: string }>) => string;
  tokenize?: (content: string) => number[];
}

let serverCount = 0;

function model(): ClassifierModel<"llama-cpp-classify"> {
  serverCount++;
  return {
    api: "llama-cpp-classify",
    baseUrl: `http://llama-${serverCount}.test:8080/v1`,
    contextWindow: 32768,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "qwen",
    input: ["text"],
    name: "qwen",
    provider: "llama.cpp",
    type: "classifier",
  };
}

function charTokens(content: string): number[] {
  return [...content].map((char) => char.codePointAt(0)!);
}

function fakeServer(options: FakeServerOptions = {}) {
  const requests: RecordedRequest[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ body, headers: new Headers(init?.headers), url });
    const path = new URL(url).pathname;
    if (path === "/tokenize") {
      const content = String(body["content"]);
      return Promise.resolve(Response.json({ tokens: (options.tokenize ?? charTokens)(content) }));
    }
    if (path === "/apply-template") {
      const messages = body["messages"] as Array<{ role: string; content: string }>;
      const prompt =
        options.template?.(messages) ??
        `${messages.map((message) => `<|${message.role}|>\n${message.content}\n`).join("")}<|assistant|>\n`;
      return Promise.resolve(Response.json({ prompt }));
    }
    if (path === "/completion") {
      const next = options.next?.(String(body["prompt"]), Number(body["n_probs"])) ?? {
        A: -0.1,
        B: -2.5,
      };
      const top_logprobs = Object.entries(next).map(([token, logprob]) => ({
        bytes: [],
        id: token.codePointAt(0),
        logprob,
        token,
      }));
      return Promise.resolve(
        Response.json({
          completion_probabilities: [{ id: 65, token: "A", top_logprobs }],
          content: "A",
        }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return { fetch, requests };
}

const context: ClassifierContext = {
  questions: Object.fromEntries<ClassifierQuestion>([
    [
      "team",
      {
        criteria: Object.fromEntries([
          ["billing", "Payments and refunds"],
          ["technical", "Bugs and outages"],
          ["sales", ""],
        ]),
        instructions: "Which team should handle this?",
        type: "choice",
      },
    ],
    [
      "urgent",
      {
        criteria: { false: "No time pressure", true: "The user needs help soon" },
        instructions: "Does this convey urgency?",
        type: "bool",
      },
    ],
    [
      "severity",
      {
        criteria: ["low", "medium", "high"],
        instructions: "How severe is this?",
        type: "score",
      },
    ],
  ]),
  state: { message: "Help! My payouts have been failing for 3 days." },
};

const llamaCppClassifySupport = {
  charTokens,
  context,
  fakeServer,
  model,
};

export default llamaCppClassifySupport;
