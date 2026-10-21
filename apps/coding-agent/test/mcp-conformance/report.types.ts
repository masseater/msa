declare namespace reportTypes {
  type CheckStatus = "pass" | "fail";

  interface ScenarioResult {
    mode: string;
    scenario: string;
    checks: Map<string, CheckStatus>;
    messages: Map<string, string>;
  }

  interface BaselineScenario {
    passing: string[];
    failing: string[];
  }

  interface Baseline {
    conformance: string;
    modes: Record<string, Record<string, BaselineScenario>>;
  }

  interface RawCheck {
    id?: unknown;
    name?: unknown;
    status?: unknown;
    description?: unknown;
    errorMessage?: unknown;
  }
}

export type { reportTypes as default };
