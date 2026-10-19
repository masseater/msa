import type { Model } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import {
  type ModelReferenceRequest,
  resolveModelReference,
  resolveModelScope,
  resolveModelScopeWithDiagnostics,
} from "../src/core/model-resolver.ts";
import { referenceCases } from "./model-resolver-cases.ts";
import { allModels, mockModels, modelRef, referenceCatalog } from "./model-resolver-support.ts";

describe("resolveModelReference", () => {
  test.each(referenceCases)("$name", (testCase) => {
    const usable = new Set(testCase.usable);
    const request: ModelReferenceRequest = {
      text: testCase.text,
      ...(testCase.provider === undefined ? {} : { provider: testCase.provider }),
      thinkingSuffix: testCase.thinkingSuffix ?? "strict",
      fuzzy: testCase.fuzzy ?? true,
    };

    for (const models of [referenceCatalog, [...referenceCatalog].reverse()]) {
      const result = resolveModelReference(request, models, (provider) => usable.has(provider));
      const expected = testCase.expected;
      if (expected === "not-found") {
        expect(result.status).toBe("not-found");
      } else if ("ambiguous" in expected) {
        expect(result.status).toBe("ambiguous");
        if (result.status !== "ambiguous") continue;
        expect(result.candidates.map(modelRef).sort()).toEqual(expected.ambiguous);
        expect(result.usableCount).toBe(expected.usableCount);
      } else {
        expect(result.status).toBe("resolved");
        if (result.status !== "resolved") continue;
        expect(modelRef(result.model)).toBe(expected.model);
        expect(result.thinkingLevel).toBe(expected.thinkingLevel);
        if (expected.warning === undefined) expect(result.warning).toBeUndefined();
        else expect(result.warning).toContain(expected.warning);
      }
    }
  });
});

describe("resolveModelScopeWithDiagnostics", () => {
  test("returns scoped models and structured diagnostics without writing console warnings", () =>
    runTest(
      Effect.gen(function* () {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const registry = {
            getAvailable: () => allModels,
          } as unknown as Parameters<typeof resolveModelScopeWithDiagnostics>[1];

          const result = yield* awaited(
            resolveModelScopeWithDiagnostics(
              ["sonnet:high", "gpt-4o:invalid", "missing"],
              registry,
            ),
          );

          expect(result.scopedModels.map((scoped) => scoped.model.id)).toEqual([
            "claude-sonnet-4-5",
            "gpt-4o",
          ]);
          expect(result.scopedModels[0]?.thinkingLevel).toBe("high");
          expect(result.scopedModels[1]?.thinkingLevel).toBeUndefined();
          expect(result.diagnostics).toEqual([
            {
              type: "warning" as const,
              message:
                'Invalid thinking level "invalid" in pattern "gpt-4o:invalid". Using default instead.',
              code: "invalid-thinking-level",
              pattern: "gpt-4o:invalid",
            },
            {
              type: "warning" as const,
              message: 'No models match pattern "missing"',
              code: "no-match",
              pattern: "missing",
            },
          ]);
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      }),
    ));

  test("resolveModelScope preserves CLI warning output", () =>
    runTest(
      Effect.gen(function* () {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const registry = {
            getAvailable: () => allModels,
          } as unknown as Parameters<typeof resolveModelScope>[1];

          const scopedModels = yield* awaited(resolveModelScope(["missing"], registry));

          expect(scopedModels).toEqual([]);
          expect(warn).toHaveBeenCalledOnce();
          expect(warn.mock.calls[0]?.[0]).toContain('Warning: No models match pattern "missing"');
        } finally {
          warn.mockRestore();
        }
      }),
    ));

  test("adds every provider for a pattern matching the same id on several providers, with a warning", () =>
    runTest(
      Effect.gen(function* () {
        const registry = {
          getAvailable: () => [
            ...allModels,
            { ...mockModels[1], provider: "opencode" },
            { ...mockModels[1], provider: "openai-codex", id: "gpt-4o-mini" },
          ],
        } as unknown as Parameters<typeof resolveModelScopeWithDiagnostics>[1];

        for (const [pattern, thinkingLevel] of [
          ["gpt-4o:high", "high"],
          ["GPT-4o", undefined],
        ] as const) {
          const result = yield* awaited(resolveModelScopeWithDiagnostics([pattern], registry));

          expect(
            result.scopedModels.map((scoped) => [
              `${scoped.model.provider}/${scoped.model.id}`,
              scoped.thinkingLevel,
            ]),
          ).toEqual(
            expect.arrayContaining([
              ["opencode/gpt-4o", thinkingLevel],
              ["openai/gpt-4o", thinkingLevel],
            ]),
          );
          expect(result.scopedModels).toHaveLength(2);
          expect(result.diagnostics).toEqual([
            {
              type: "warning" as const,
              code: "ambiguous",
              message: `Pattern "${pattern}" matches several providers: openai, opencode. Use provider/id to choose one.`,
              pattern,
            },
          ]);
        }
      }),
    ));

  test("resolves bracketed model ids as exact references before glob matching", () =>
    runTest(
      Effect.gen(function* () {
        const bracketedModel: Model<"anthropic-messages"> = {
          id: "bracketed-model[1m]",
          name: "Bracketed Model",
          api: "anthropic-messages" as const,
          provider: "custom",
          baseUrl: "https://example.invalid",
          reasoning: true,
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
          contextWindow: 128000,
          maxTokens: 8192,
        };
        const registry = {
          getAvailable: () => [...allModels, bracketedModel],
        } as unknown as Parameters<typeof resolveModelScopeWithDiagnostics>[1];

        const result = yield* awaited(
          resolveModelScopeWithDiagnostics(["custom/bracketed-model[1m]"], registry),
        );

        expect(result.scopedModels.map((scoped) => scoped.model.id)).toEqual([
          "bracketed-model[1m]",
        ]);
        expect(result.diagnostics).toEqual([]);
      }),
    ));

  test("resolves bracketed model ids with thinking levels as exact references before glob matching", () =>
    runTest(
      Effect.gen(function* () {
        const bracketedModel: Model<"anthropic-messages"> = {
          id: "bracketed-model[1m]",
          name: "Bracketed Model",
          api: "anthropic-messages" as const,
          provider: "custom",
          baseUrl: "https://example.invalid",
          reasoning: true,
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
          contextWindow: 128000,
          maxTokens: 8192,
        };
        const registry = {
          getAvailable: () => [...allModels, bracketedModel],
        } as unknown as Parameters<typeof resolveModelScopeWithDiagnostics>[1];

        const result = yield* awaited(
          resolveModelScopeWithDiagnostics(["custom/bracketed-model[1m]:high"], registry),
        );

        expect(result.scopedModels.map((scoped) => scoped.model.id)).toEqual([
          "bracketed-model[1m]",
        ]);
        expect(result.scopedModels[0]?.thinkingLevel).toBe("high");
        expect(result.diagnostics).toEqual([]);
      }),
    ));
});
