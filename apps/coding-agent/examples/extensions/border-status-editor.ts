import env from "@msa/ai/utils/env";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@msa/coding-agent";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, type Fiber, Option } from "effect";

const { readProcessEnv } = env;

const { truncateToWidth, visibleWidth } = tuiModule;

function fitBorder(
  left: string,
  right: string,
  width: number,
  border: (text: string) => string,
  fill: (text: string) => string = border,
): string {
  if (width <= 0) return "";
  if (width === 1) return border("─");

  let leftText = left;
  let rightText = right;
  const fixedWidth = 2;
  const minimumGap = 3;

  while (
    fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
    visibleWidth(rightText) > 0
  ) {
    rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
  }
  while (
    fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
    visibleWidth(leftText) > 0
  ) {
    leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
  }

  const gapWidth = Math.max(
    0,
    width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText),
  );
  return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

function formatCwd(cwd: string): string {
  const home = readProcessEnv("HOME");
  if (home !== undefined && home.length > 0 && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

function formatContext(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  if (contextWindow === undefined || usage === undefined || usage.percent === null) {
    return "ctx ?";
  }
  return `ctx ${Math.round(usage.percent)}%/${(contextWindow / 1000).toFixed(0)}k`;
}

function formatThinking(level: string): string {
  return level === "off" ? "off" : level;
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface StatusState {
  isWorking: boolean;
  spinnerIndex: number;
  branch: string | undefined;
  activeTui: tuiTypes.TUI | undefined;
  spinnerFiber: Fiber.Fiber<never> | undefined;
}

interface EditorDeps {
  readonly msa: ExtensionAPI;
  readonly ctx: ExtensionContext;
  readonly state: StatusState;
}

class BorderStatusEditor extends CustomEditor {
  private readonly deps: EditorDeps;

  constructor(
    tui: tuiTypes.TUI,
    theme: tuiTypes.EditorTheme,
    keybindings: KeybindingsManager,
    deps: EditorDeps,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    this.deps = deps;
    deps.state.activeTui = tui;
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;

    const { msa, ctx, state } = this.deps;
    const thm = ctx.ui.theme;
    const model = ctx.model === undefined ? "no model" : `${ctx.model.provider}/${ctx.model.id}`;
    const thinking = msa.getThinkingLevel();
    const topLeft = state.isWorking
      ? thm.fg("accent", ` ${spinnerFrames[state.spinnerIndex]} `)
      : "";
    const topRight = "";
    const bottomLeft = thm.fg("muted", ` ${model} · ${formatThinking(thinking)} `);
    const bottomRight = thm.fg(
      "muted",
      ` ${formatContext(ctx)} · ${formatCwd(ctx.cwd)}${state.branch !== undefined && state.branch.length > 0 ? ` (${state.branch})` : ""} `,
    );
    const borderColor = (text: string) => this.borderColor(text);

    lines[0] = fitBorder(topLeft, topRight, width, borderColor);
    lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, borderColor);
    return lines;
  }
}

const startSpinner = (state: StatusState) => {
  state.spinnerFiber?.interruptUnsafe();
  state.spinnerFiber = Effect.runFork(
    Effect.forever(
      Effect.sync(() => {
        state.spinnerIndex = (state.spinnerIndex + 1) % spinnerFrames.length;
        state.activeTui?.requestRender();
      }).pipe(Effect.andThen(Effect.sleep(80))),
    ),
  );
};

const stopSpinner = (state: StatusState) => {
  state.spinnerFiber?.interruptUnsafe();
  state.spinnerFiber = undefined;
};

const refreshBranch = (msa: ExtensionAPI, ctx: ExtensionContext, state: StatusState) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        msa.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd }),
      ).pipe(Effect.option);
      const stdout = Option.isSome(result) ? result.value.stdout.trim() : undefined;
      state.branch = stdout !== undefined && stdout.length > 0 ? stdout : undefined;
      state.activeTui?.requestRender();
    }),
  );

const registerAgentEvents = (msa: ExtensionAPI, state: StatusState): void => {
  msa.on("agent_start", () => {
    state.isWorking = true;
    startSpinner(state);
    state.activeTui?.requestRender();
  });

  msa.on("agent_settled", () => {
    state.isWorking = false;
    stopSpinner(state);
    state.activeTui?.requestRender();
  });

  msa.on("session_shutdown", () => {
    stopSpinner(state);
    state.activeTui = undefined;
  });
};

const registerSessionStart = (msa: ExtensionAPI, state: StatusState): void => {
  msa.on("session_start", (_event, ctx) => {
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter(() => ({ invalidate: () => {}, render: () => [] }));

    void refreshBranch(msa, ctx, state);

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new BorderStatusEditor(tui, theme, keybindings, { ctx, msa, state }),
    );
  });
};

export default function (msa: ExtensionAPI) {
  const state: StatusState = {
    activeTui: undefined,
    branch: undefined,
    isWorking: false,
    spinnerFiber: undefined,
    spinnerIndex: 0,
  };

  registerAgentEvents(msa, state);
  registerSessionStart(msa, state);
}
