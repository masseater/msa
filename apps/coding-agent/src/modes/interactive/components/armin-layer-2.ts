import platform from "../../../core/platform.ts";
import arminHelpers from "./armin-helpers.ts";
import ArminComponentLayer1 from "./armin-layer-1.ts";
import arminSupport from "./armin-support.ts";

const { WIDTH } = arminSupport;
const { randomUnit } = platform;
const { DISPLAY_HEIGHT, shuffle } = arminHelpers;

export default abstract class ArminComponentLayer2 extends ArminComponentLayer1 {
  protected initEffect(): void {
    switch (this.effect) {
      case "typewriter":
        this.effectState = { pos: 0 };
        break;
      case "scanline":
        this.effectState = { row: 0 };
        break;
      case "rain":
        this.initEffectPart1();
        break;
      case "fade": {
        const positions: [number, number][] = [];
        for (let row = 0; row < DISPLAY_HEIGHT; row++) {
          for (let x = 0; x < WIDTH; x++) {
            positions.push([row, x]);
          }
        }
        shuffle(positions);
        this.effectState = { idx: 0, positions };
        break;
      }
      case "crt":
        this.effectState = { expansion: 0 };
        break;
      case "glitch":
        this.effectState = { glitchFrames: 8, phase: 0 };
        break;
      case "dissolve": {
        this.currentGrid = Array.from({ length: DISPLAY_HEIGHT }, () =>
          Array.from({ length: WIDTH }, () => {
            const chars = [" ", "░", "▒", "▓", "█", "▀", "▄"];
            return chars[Math.floor(randomUnit() * chars.length)] ?? " ";
          }),
        );
        const dissolvePositions: [number, number][] = [];
        for (let row = 0; row < DISPLAY_HEIGHT; row++) {
          for (let x = 0; x < WIDTH; x++) {
            dissolvePositions.push([row, x]);
          }
        }
        shuffle(dissolvePositions);
        this.effectState = { idx: 0, positions: dissolvePositions };
        break;
      }
    }
  }
}
