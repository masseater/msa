import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, type Fiber } from "effect";
const COLORS: [number, number, number][] = [
  [233, 137, 115],
  [228, 186, 103],
  [141, 192, 122],
  [102, 194, 179],
  [121, 157, 207],
  [157, 134, 195],
  [206, 130, 172],
];
const RESET = "\x1b[0m";

function brighten(rgb: [number, number, number], factor: number): string {
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * factor));
  return `\x1b[38;2;${r};${g};${b}m`;
}

function colorize(text: string, shinePos: number): string {
  return (
    [...text]
      .map((c, i) => {
        const baseColor = COLORS[i % COLORS.length]!;

        let factor = 0;
        if (shinePos >= 0) {
          const dist = Math.abs(i - shinePos);
          if (dist === 0) factor = 0.7;
          else if (dist === 1) factor = 0.35;
        }
        return `${brighten(baseColor, factor)}${c}`;
      })
      .join("") + RESET
  );
}

class RainbowEditor extends codingAgent.CustomEditor {
  private animationFiber?: Fiber.Fiber<never> | undefined;
  private frame = 0;

  private hasUltrathink(): boolean {
    return /ultrathink/iu.test(this.getText());
  }

  private startAnimation(): void {
    if (this.animationFiber !== undefined) return;
    this.animationFiber = Effect.runFork(
      Effect.forever(
        Effect.sync(() => {
          this.frame++;
          this.tui.requestRender();
        }).pipe(Effect.andThen(Effect.sleep(60))),
      ),
    );
  }

  private stopAnimation(): void {
    this.animationFiber?.interruptUnsafe();
    this.animationFiber = undefined;
  }

  override handleInput(data: string): void {
    super.handleInput(data);
    if (this.hasUltrathink()) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }

  override render(width: number): string[] {
    const cycle = this.frame % 20;
    const shinePos = cycle < 10 ? cycle : -1;
    return super
      .render(width)
      .map((line) => line.replace(/ultrathink/giu, (m) => colorize(m, shinePos)));
  }
}

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, kb) => new RainbowEditor(tui, theme, kb));
  });
}
