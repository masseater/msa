import assert from "node:assert";
import { describe, it } from "node:test";

import { renderLatex } from "../src/index.ts";
import { defineCases, type LatexCase } from "./latex-helpers.ts";

const sessionCases1: readonly LatexCase[] = [
  [String.raw`e^{i\pi}+1=0`, "e^(iπ)+1 = 0"],
  [
    String.raw`\boxed{
\mathcal{Z}(\beta)
=
\int_{\mathcal M}
\exp\!\left(
-\beta\left[
\frac12 g^{ij}(x)\,\partial_i\phi\,\partial_j\phi
+V(\phi)
\right]\right)
\mathcal D\phi
}`,
    "[Z(β) = ∫_M exp( -β[ 1/2 gⁱʲ(x) ∂ᵢϕ ∂ⱼϕ +V(ϕ) ]) Dϕ]",
  ],
  [
    String.raw`\begin{aligned}
\nabla_\mu T^{\mu\nu}
&=
\frac{1}{\sqrt{-g}}
\partial_\mu\!\left(\sqrt{-g}\,T^{\mu\nu}\right)
+\Gamma^\nu_{\mu\lambda}T^{\mu\lambda}
=0, \\[4pt]
R_{\mu\nu}-\frac12 Rg_{\mu\nu}+\Lambda g_{\mu\nu}
&=
\frac{8\pi G}{c^4}T_{\mu\nu}.
\end{aligned}`,
    "∇_μ T^(μν) = 1/(√(-g)) ∂_μ(√(-g) T^(μν)) +Γ^ν_(μλ)T^(μλ) = 0,\nR_(μν)-1/2 Rg_(μν)+Λ g_(μν) = (8π G)/(c⁴)T_(μν).",
  ],
  [
    String.raw`f(z)
=
\frac{1}{2\pi i}
\oint_{\gamma}
\frac{f(\zeta)}{\zeta-z}\,d\zeta,
\qquad
\det\!\begin{pmatrix}
\lambda-a & -b & 0\\
-c & \lambda-d & -e\\
0 & -f & \lambda-g
\end{pmatrix}
=0.`,
    [
      "f(z) = 1/(2π i) ∮_γ (f(ζ))/(ζ-z) dζ, det⎛ λ-a │ -b  │ 0   ⎞ = 0.",
      `${" ".repeat(40)}⎜ -c  │ λ-d │ -e  ⎟`,
      `${" ".repeat(40)}⎝ 0   │ -f  │ λ-g ⎠`,
    ].join("\n"),
  ],
  [
    String.raw`\Psi(x,t)=
\sum_{n=1}^{\infty}
\underbrace{
c_n
\sqrt{\frac{2}{L}}
\sin\!\left(\frac{n\pi x}{L}\right)
}_{\text{spatial eigenmode}}
\exp\!\left(-\frac{i\hbar n^2\pi^2}{2mL^2}t\right),
\qquad
|\Psi(x,t)|^2
=
\begin{cases}
\Psi^\ast\Psi, & 0<x<L,\\
0, & \text{otherwise}.
\end{cases}`,
    `${" ".repeat(97)}⎧ Ψ^∗Ψ if 0 < x < L,\nΨ(x,t) = ∑ₙ₌₁^∞ cₙ √(2/L) sin((nπ x)/L)_(spatial eigenmode) exp(-(iℏ n²π²)/(2mL²)t), |Ψ(x,t)|² = ⎨\n${" ".repeat(97)}⎩ 0    otherwise.`,
  ],
  [String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, "x = (-b±√(b²-4ac))/(2a)"],
  [String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}`, "∫₀^∞ e^(-x²) dx = (√π)/2"],
  [String.raw`e^{i\theta}=\cos\theta+i\sin\theta`, "e^(iθ) = cos θ+i sin θ"],
  [String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}`, "∑ₙ₌₁^∞1/(n²) = π²/6"],
  [String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`, "lim[x→0] (sin x)/x = 1"],
  [
    String.raw`\lim_{n\to\infty}
\left(1+\frac{1}{n}\right)^n=e`,
    "lim[n→∞] (1+1/n)ⁿ = e",
  ],
  [
    String.raw`\int_0^1 \frac{x^2}{1+x^3}\,dx
=\frac{1}{3}\ln 2`,
    "∫₀¹ x²/(1+x³) dx = 1/3 ln 2",
  ],
  [
    String.raw`\sum_{k=1}^{n}\frac{k}{k+1}
=n+1-H_{n+1}`,
    "∑ₖ₌₁ⁿk/(k+1) = n+1-Hₙ₊₁",
  ],
  [
    String.raw`\frac{
  \displaystyle \frac{x^2+1}{x-1}
  -
  \displaystyle \frac{2x}{x+1}
}{
  \displaystyle \frac{x}{x^2-1}
}`,
    "((x²+1)/(x-1) - 2x/(x+1))/(x/(x²-1))",
  ],
  [
    String.raw`\lim_{x\to 0}
\frac{
  \displaystyle \frac{\sin x}{x}-1
}{
  \displaystyle \frac{e^x-1}{x}-1
}
=0`,
    "lim[x→0] ((sin x)/x-1)/((eˣ-1)/x-1) = 0",
  ],
  [
    String.raw`\frac{
  1+\displaystyle\frac{1}{1+\frac{1}{x}}
}{
  1-\displaystyle\frac{1}{1-\frac{1}{x}}
}`,
    "(1+1/(1+1/x))/(1-1/(1-1/x))",
  ],
  [
    String.raw`\sum_{n=1}^{\infty}
\frac{
  \displaystyle \frac{1}{n}-\frac{1}{n+1}
}{
  \displaystyle 1+\frac{1}{n^2}
}`,
    "∑ₙ₌₁^∞ (1/n-1/(n+1))/(1+1/(n²))",
  ],
];

describe("renderLatex", () => {
  describe("extended formulas from a renderer stress-test session", () => {
    defineCases(sessionCases1);
  });
});

describe("renderLatex", () => {
  it("renders common symbols, roots, sums, and integrals", () => {
    assert.strictEqual(
      renderLatex(String.raw`\sum_{i=0}^n \alpha_i + \int_0^\infty e^{-x^2}\,dx = \sqrt{\pi}`),
      "∑ᵢ₌₀ⁿ αᵢ + ∫₀^∞ e^(-x²) dx = √π",
    );
  });

  it("renders common accents and binomial notation", () => {
    assert.strictEqual(
      renderLatex(String.raw`\binom{n}{k}+\vec{x}+\hat{y}+\overline{AB}`),
      "(n choose k)+x⃗+ŷ+overline(AB)",
    );
  });

  it("renders extended symbols and negated relations", () => {
    assert.strictEqual(
      renderLatex(
        String.raw`\epsilon+\varepsilon+\varsigma+\varkappa+\oplus+\otimes+\therefore+\because`,
      ),
      "ϵ+ε+ς+ϰ+⊕+⊗+∴+∵",
    );
    assert.strictEqual(renderLatex(String.raw`A\not\subseteq B,\quad x\not\in X`), "A ⊈ B, x ∉ X");
  });

  it("renders relational algebra join operators", () => {
    assert.strictEqual(renderLatex(String.raw`R\bowtie S,\quad R\Join S`), "R ⋈ S, R ⋈ S");
    assert.strictEqual(renderLatex(String.raw`R\ltimes S,\quad R\rtimes S`), "R ⋉ S, R ⋊ S");
    assert.strictEqual(
      renderLatex(String.raw`R\leftouterjoin S,\quad R\rightouterjoin S,\quad R\fullouterjoin S`),
      "R ⟕ S, R ⟖ S, R ⟗ S",
    );
  });

  it("renders delimiter commands and invisible delimiters", () => {
    assert.strictEqual(
      renderLatex(String.raw`\lvert{x}\rvert+\lVert{v}\rVert+\left.\frac{dy}{dx}\right|_{x=0}`),
      "|x|+‖v‖+dy/(dx)|ₓ₌₀",
    );
    assert.strictEqual(
      renderLatex(String.raw`\left\lbrace x \middle| x>0 \right\rbrace`),
      "{ x | x > 0 }",
    );
  });
});

describe("renderLatex", () => {
  it("renders named, modular, overlaid, and underlaid operators", () => {
    assert.strictEqual(
      renderLatex(String.raw`\operatorname*{arg\,max}_{x\in X} f(x)`),
      "arg max[x∈X] f(x)",
    );
    assert.strictEqual(
      renderLatex(String.raw`a\bmod n,\quad a\equiv b\pmod n`),
      "a mod n, a ≡ b (mod n)",
    );
    assert.strictEqual(
      renderLatex(String.raw`\overset{!}{=}+\underset{n}{x}+\stackrel{def}{=}`),
      "=^!+xₙ+=ᵈᵉᶠ",
    );
  });

  it("renders indexed roots and additional accents and wrappers", () => {
    assert.strictEqual(
      renderLatex(String.raw`\sqrt[2]{x}+\sqrt[3]{x}+\sqrt[4]{x}+\sqrt[n]{x}+\sqrt[k]{x+1}`),
      "√x+∛x+∜x+ⁿ√x+ᵏ√(x+1)",
    );
    assert.strictEqual(
      renderLatex(String.raw`\acute{x}+\grave{y}+\widehat{xyz}+\overrightarrow{AB}`),
      "x́+ỳ+widehat(xyz)+overrightarrow(AB)",
    );
    assert.strictEqual(
      renderLatex(
        String.raw`\textnormal{hello}+\mbox{world}+\boldsymbol{x}+{\rm roman}+{\bf bold}+{\it italic}+{\sf sans}+{\tt mono}+{\cal calligraphic}+{\sl slanted}`,
      ),
      "hello+world+x+roman+bold+italic+sans+mono+calligraphic+slanted",
    );
  });

  it("renders additional display environments", () => {
    assert.strictEqual(
      renderLatex(String.raw`\begin{equation}\begin{split}a&=b\\&=c\end{split}\end{equation}`),
      "a = b\n= c",
    );
    assert.strictEqual(
      renderLatex(String.raw`\begin{alignedat}{2}a&=b&\quad c&=d\\e&=f&g&=h\end{alignedat}`),
      "a = b c = d\ne = f g = h",
    );
  });
});

describe("renderLatex", () => {
  it("uses natural case conditions and aligns matrix columns", () => {
    assert.strictEqual(
      renderLatex(
        String.raw`f(x)=\begin{cases}a & x<0 \\ b & \text{if }x=0 \\ c & \text{otherwise}\end{cases}`,
      ),
      "       ⎧ a if x < 0\nf(x) = ⎨ b if x = 0\n       ⎩ c otherwise",
    );
    assert.strictEqual(
      renderLatex(String.raw`\begin{pmatrix}1&200\\3000&4\end{pmatrix}`),
      "⎛ 1    │ 200 ⎞\n⎝ 3000 │ 4   ⎠",
    );
  });
});
