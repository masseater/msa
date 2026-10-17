interface EntryBudget {
  readonly forbid?: ReadonlyArray<string>;
  readonly maxFiles: number;
}

const WORKSPACE: Readonly<Record<string, string>> = {
  "@msa/chord": "libs/chord/src",
  "@msa/ai": "libs/ai/src",
  "@msa/durable": "libs/durable/src",
  "@msa/agent-core": "libs/agent/src",
  "@msa/codemode": "libs/codemode/src",
  "@msa/telemetry": "libs/telemetry/src",
  "@msa/mcp": "libs/mcp/src",
  "@msa/tui": "libs/tui/src",
};

const codemodeIsolatedEntryForbids: ReadonlyArray<string> = [
  "codemode/src/index.ts",
  "runtime/host.ts",
  "runtime/worker.ts",
  "codemode/src/wasm.ts",
];

const BUDGETS: Readonly<Record<string, Readonly<Record<string, EntryBudget>>>> = {
  "libs/ai": {
    "./models": {
      maxFiles: 15,
      forbid: [
        "providers/",
        "models.generated.ts",
        "index.ts",
        "utils/validation.ts",
        "utils/typebox-helpers.ts",
      ],
    },
    "./utils/*": { maxFiles: 3, forbid: ["providers/", "api/", "index.ts"] },
  },
  "libs/codemode": {
    ".": { maxFiles: 12, forbid: ["codemode/src/cloudflare.ts"] },
    "./portable": { maxFiles: 8, forbid: codemodeIsolatedEntryForbids },
    "./cloudflare": { maxFiles: 9, forbid: codemodeIsolatedEntryForbids },
  },
  "libs/durable": {
    ".": {
      maxFiles: 66,
      forbid: [
        "libs/ai/src/index.ts",
        "libs/ai/src/utils/typebox-helpers.ts",
        "libs/durable/src/images/",
      ],
    },
    "./tools": { maxFiles: 17, forbid: ["libs/durable/src/images/"] },
  },
};

export type { EntryBudget };
export { BUDGETS, WORKSPACE };
