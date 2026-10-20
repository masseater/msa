import { describe } from "node:test";

import defineCases from "./latex-helpers.ts";
import type latexHelpersTypes from "./latex-helpers.types.ts";

const sessionCases1: readonly latexHelpersTypes.LatexCase[] = [
  [String.raw`\mathbb{C}^3 \to \mathbb{C}^3`, "ℂ³ → ℂ³"],
  [
    String.raw`\{3x+2y,\; 27x^2-4z-1,\; x(x-1)(x+1)\} \quad\Rightarrow\quad x \in \{0, \pm 1\},`,
    "{3x+2y, 27x²-4z-1, x(x-1)(x+1)} ⇒ x ∈ {0, ± 1},",
  ],
  [String.raw`F_1 = -\frac{1}{4x^2}.`, "F₁ = -1/(4x²)."],
  ["-2", "-2"],
  ["(0,0,-1/4)", "(0,0,-1/4)"],
  ["(1,-3/2,13/2)", "(1,-3/2,13/2)"],
  ["(1,1,1)", "(1,1,1)"],
  ["(2,1,0)", "(2,1,0)"],
  ["(-1/4, 0, 0)", "(-1/4, 0, 0)"],
  [
    String.raw`\{(0,0,-1/4), (1,-3/2,13/2), (-1,3/2,13/2)\}`,
    "{(0,0,-1/4), (1,-3/2,13/2), (-1,3/2,13/2)}",
  ],
  ["(2,1,1)", "(2,1,1)"],
  ["(7/3,-2/5,11/7)", "(7/3,-2/5,11/7)"],
  [String.raw`\{y - p(x),\; q(x)\}`, "{y - p(x), q(x)}"],
  [String.raw`\deg q = 3`, "deg q = 3"],
  [String.raw`[\mathbb{C}(x,y,z):\mathbb{C}(F_1,F_2,F_3)] = 3`, "[ℂ(x,y,z):ℂ(F₁,F₂,F₃)] = 3"],
  ["u = 1+xy", "u = 1+xy"],
  ["G = u^2 z + y^2(4+3xy)", "G = u² z + y²(4+3xy)"],
  ["F_1 = uG", "F₁ = uG"],
  ["F_2 = y + 3xG", "F₂ = y + 3xG"],
  ["x=0", "x = 0"],
  ["F_2 = F_3 = 0", "F₂ = F₃ = 0"],
  ["xy = -3/2", "xy = -3/2"],
  ["x^2 z = 13/2", "x² z = 13/2"],
  [String.raw`\mathbb{C}^*`, "ℂ^*"],
  [String.raw`s \mapsto (s,\, -\tfrac{3}{2s},\, \tfrac{13}{2s^2})`, "s ↦ (s, -3/(2s), 13/(2s²))"],
  ["X", "X"],
  [String.raw`p_\pm`, "p_±"],
  ["F(-x,-y,z) = (F_1, -F_2, -F_3)", "F(-x,-y,z) = (F₁, -F₂, -F₃)"],
  ["p_0", "p₀"],
  [String.raw`s \to \infty`, "s → ∞"],
  ["(0,0,0)", "(0,0,0)"],
  [String.raw`\Rightarrow`, "⇒"],
  [String.raw`\ge 2`, "≥ 2"],
  [String.raw`\ge 3`, "≥ 3"],
  ["1", "1"],
  [
    String.raw`\mathrm{diag}(-1/2,1,1),\quad F_{\rm intrinsic}(\lambda)`,
    "diag(-1/2,1,1), F_intrinsic(λ)",
  ],
  ["4+3xy", "4+3xy"],
];

const sessionCases2: readonly latexHelpersTypes.LatexCase[] = [
  [
    String.raw`E \approx \frac{0.1\ \text{lux}}{100\ \text{lm/W}} = 0.001\ \text{W/m}^2`,
    "E ≈ (0.1 lux)/(100 lm/W) = 0.001 W/m²",
  ],
  [String.raw`\boxed{1\ \text{milliwatt per square metre}}`, "[1 milliwatt per square metre]"],
  [String.raw`5\ \text{km}^2 = 5{,}000{,}000\ \text{m}^2`, "5 km² = 5,000,000 m²"],
  [
    String.raw`P_{\text{light}} = 0.001 \times 5{,}000{,}000
= \boxed{5{,}000\ \text{W}}`,
    "P_light = 0.001 × 5,000,000 = [5,000 W]",
  ],
  [
    String.raw`P_{\text{electric}} = 5\ \text{kW} \times 0.2
= \boxed{1\ \text{kW}}`,
    "P_electric = 5 kW × 0.2 = [1 kW]",
  ],
  [String.raw`\pi(2.5\ \text{km})^2 = 19.6\ \text{km}^2`, "π(2.5 km)² = 19.6 km²"],
  [
    String.raw`0.001\ \text{W/m}^2 \times 19.6 \times 10^6\ \text{m}^2
\approx \boxed{20\ \text{kW optical}}`,
    "0.001 W/m² × 19.6 × 10⁶ m² ≈ [20 kW optical]",
  ],
  [
    String.raw`1\ \text{kW} \times \frac{1}{3600}\ \text{hour}
= \boxed{0.28\ \text{Wh}}`,
    "1 kW × 1/3600 hour = [0.28 Wh]",
  ],
];

const sessionCases3: readonly latexHelpersTypes.LatexCase[] = [
  [
    String.raw`\det\!\left(\frac{\partial(F_1,F_2,F_3)}{\partial(x,y,z)}\right)=-2.`,
    "det((∂(F₁,F₂,F₃))/(∂(x,y,z))) = -2.",
  ],
  [
    String.raw`\begin{aligned}
F(0,0,-\tfrac14)&=(-\tfrac14,0,0),\\
F(1,-\tfrac32,\tfrac{13}2)&=(-\tfrac14,0,0),\\
F(-1,\tfrac32,\tfrac{13}2)&=(-\tfrac14,0,0).
\end{aligned}`,
    "F(0,0,-1/4) = (-1/4,0,0),\nF(1,-3/2,13/2) = (-1/4,0,0),\nF(-1,3/2,13/2) = (-1/4,0,0).",
  ],
  ["F=(F_1,F_2,F_3)", "F = (F₁,F₂,F₃)"],
  ["F", "F"],
  ["3", "3"],
];

const sessionCases4: readonly latexHelpersTypes.LatexCase[] = [
  [
    String.raw`J = \begin{pmatrix}
\frac{\partial f_1}{\partial x} & \frac{\partial f_1}{\partial y} & \frac{\partial f_1}{\partial z} \\
\frac{\partial f_2}{\partial x} & \frac{\partial f_2}{\partial y} & \frac{\partial f_2}{\partial z} \\
\frac{\partial f_3}{\partial x} & \frac{\partial f_3}{\partial y} & \frac{\partial f_3}{\partial z}
\end{pmatrix}`,
    "J = ⎛ (∂ f₁)/(∂ x) │ (∂ f₁)/(∂ y) │ (∂ f₁)/(∂ z) ⎞\n    ⎜ (∂ f₂)/(∂ x) │ (∂ f₂)/(∂ y) │ (∂ f₂)/(∂ z) ⎟\n    ⎝ (∂ f₃)/(∂ x) │ (∂ f₃)/(∂ y) │ (∂ f₃)/(∂ z) ⎠",
  ],
  [
    String.raw`\begin{aligned}
f_1 &= (1+xy)^3 z + y^2(1+xy)(4+3xy) \\
f_2 &= y + 3x(1+xy)^2 z + 3xy^2(4+3xy) \\
f_3 &= 2x - 3x^2y - x^3z
\end{aligned}`,
    "f₁ = (1+xy)³ z + y²(1+xy)(4+3xy)\nf₂ = y + 3x(1+xy)² z + 3xy²(4+3xy)\nf₃ = 2x - 3x²y - x³z",
  ],
  ["x, y, z", "x, y, z"],
  ["(x, y, z)", "(x, y, z)"],
  [String.raw`(0,\; 0,\; -\tfrac14)`, "(0, 0, -1/4)"],
  [String.raw`(-\tfrac14,\; 0,\; 0)`, "(-1/4, 0, 0)"],
  [String.raw`(1,\; -\tfrac32,\; \tfrac{13}{2})`, "(1, -3/2, 13/2)"],
  [String.raw`(-1,\; \tfrac32,\; \tfrac{13}{2})`, "(-1, 3/2, 13/2)"],
  [String.raw`(-\frac14, 0, 0)`, "(-1/4, 0, 0)"],
  [String.raw`F: \mathbb{C}^3 \to \mathbb{C}^3`, "F: ℂ³ → ℂ³"],
  [
    String.raw`F(0,0,-\tfrac14) = F(1,-\tfrac32,\tfrac{13}{2}) = F(-1,\tfrac32,\tfrac{13}{2}) = (-\tfrac14, 0, 0)`,
    "F(0,0,-1/4) = F(1,-3/2,13/2) = F(-1,3/2,13/2) = (-1/4, 0, 0)",
  ],
  [String.raw`\mathbb{C}^3`, "ℂ³"],
  [
    String.raw`\begin{aligned}
f_1 &= \frac{f_1^{\text{ut}}(u,t)}{x^2}, \quad
f_2 = \frac{f_2^{\text{ut}}(u,t)}{x}, \quad
f_3 = x\,(2 - 3u - t)
\end{aligned}`,
    "f₁ = (f₁ᵘᵗ(u,t))/(x²), f₂ = (f₂ᵘᵗ(u,t))/x, f₃ = x (2 - 3u - t)",
  ],
  [String.raw`\det J_F`, "det J_F"],
  [String.raw`(-\tfrac14, 0, 0)`, "(-1/4, 0, 0)"],
  ["u = xy", "u = xy"],
  ["t = x^2z", "t = x²z"],
  [String.raw`x \neq 0`, "x ≠ 0"],
  [String.raw`f_1^{\text{ut}}, f_2^{\text{ut}}`, "f₁ᵘᵗ, f₂ᵘᵗ"],
  ["u,t", "u,t"],
  ["x", "x"],
  ["x, x^2", "x, x²"],
  [String.raw`\mathbb{C}^n \to \mathbb{C}^n`, "ℂⁿ → ℂⁿ"],
  [String.raw`n \geq 2`, "n ≥ 2"],
  [String.raw`\mathbb{P}^3`, "ℙ³"],
];

describe("renderLatex", () => {
  describe("Jacobian conjecture session using dollar delimiters", () => {
    defineCases(sessionCases1);
  });
});

describe("renderLatex", () => {
  describe("satellite calculation session using bracket delimiters", () => {
    defineCases(sessionCases2);
  });
});

describe("renderLatex", () => {
  describe("Jacobian conjecture sessions using parenthesis and bracket delimiters", () => {
    defineCases(sessionCases3);
  });
});

describe("renderLatex", () => {
  describe("Jacobian matrix session using dollar delimiters", () => {
    defineCases(sessionCases4);
  });
});
