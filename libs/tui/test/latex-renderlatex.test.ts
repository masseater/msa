import assert from "node:assert";
import { describe, it } from "node:test";

import { renderLatex } from "../src/index.ts";

describe("renderLatex", () => {
  it("composes matrices with fractions and adjacent matrices", () => {
    assert.strictEqual(
      renderLatex(
        String.raw`R\left(\frac{\pi}{4}\right)
=
\begin{pmatrix}
\frac{\sqrt{2}}{2} & -\frac{\sqrt{2}}{2}\\
\frac{\sqrt{2}}{2} & \frac{\sqrt{2}}{2}
\end{pmatrix}.`,
        { display: true },
      ),
      "   π\nR( ─ ) = ⎛ (√2)/2 │ -(√2)/2 ⎞\n   4     ⎝ (√2)/2 │ (√2)/2  ⎠.",
    );
    assert.strictEqual(
      renderLatex(
        String.raw`\mathbf w
=
R\left(\frac{\pi}{4}\right)
\begin{pmatrix}1\\0\end{pmatrix}
=
\begin{pmatrix}\frac{\sqrt{2}}{2}\\\frac{\sqrt{2}}{2}\end{pmatrix}.`,
        { display: true },
      ),
      "       π\nw = R( ─ ) ⎛ 1 ⎞ = ⎛ (√2)/2 ⎞\n       4   ⎝ 0 ⎠   ⎝ (√2)/2 ⎠.",
    );
    assert.strictEqual(
      renderLatex(
        String.raw`A\mathbf e_1=\begin{pmatrix}\pi\\0\end{pmatrix},\qquad A\mathbf e_2=\begin{pmatrix}0\\\frac{1}{\pi}\end{pmatrix}.`,
        { display: true },
      ),
      "Ae₁ = ⎛ π ⎞, Ae₂ = ⎛ 0   ⎞\n      ⎝ 0 ⎠        ⎝ 1/π ⎠.",
    );
    assert.strictEqual(
      renderLatex(String.raw`\sum_{i=0}^n x_i=\begin{pmatrix}a&b\\c&d\end{pmatrix}.`, {
        display: true,
      }),
      " n\n ∑  xᵢ = ⎛ a │ b ⎞\ni=0      ⎝ c │ d ⎠.",
    );
  });
});

describe("renderLatex", () => {
  it("normalizes relation, multiplication, and named-operator spacing", () => {
    for (const source of ["x=y", "x =y", "x=\ny", "x\n=\ny"]) {
      assert.strictEqual(renderLatex(source), "x = y");
    }
    assert.strictEqual(renderLatex("x_{i=0}"), "xᵢ₌₀");
    assert.strictEqual(renderLatex(String.raw`x\neq0`), "x ≠ 0");
    assert.strictEqual(renderLatex(String.raw`A\to B`), "A → B");
    assert.strictEqual(renderLatex(String.raw`\pi\cdot\frac{1}{\pi}`), "π · 1/π");
    assert.strictEqual(renderLatex(String.raw`\sin\theta`), "sin θ");
    assert.strictEqual(renderLatex(String.raw`\sin^2 x`), "sin² x");
    assert.strictEqual(renderLatex(String.raw`-\sin\theta`), "-sin θ");
    assert.strictEqual(renderLatex(String.raw`i\sin\theta`), "i sin θ");
    assert.strictEqual(renderLatex(String.raw`\det(A)`), "det(A)");
  });

  it("treats a backslash followed by a line ending as control space", () => {
    const source = String.raw`\boxed{
(1,1,1),\ (1,1,2),\ (1,2,5),\ (1,5,13),\ (2,5,29),\
(1,13,34),\ (1,34,89)
}.`;
    assert.strictEqual(
      renderLatex(source, { display: true }),
      "[(1,1,1), (1,1,2), (1,2,5), (1,5,13), (2,5,29), (1,13,34), (1,34,89)].",
    );
    assert.strictEqual(renderLatex("a\\\r\nb"), "a b");
  });
});

describe("renderLatex", () => {
  it("stacks operator limits in display mode", () => {
    assert.strictEqual(
      renderLatex(String.raw`\sum_{i=0}^n x_i`, { display: true }),
      " n\n ∑  xᵢ\ni=0",
    );
    assert.strictEqual(
      renderLatex(String.raw`\min_{x\in X} f(x)`, { display: true }),
      "min f(x)\nx∈X",
    );
    assert.strictEqual(
      renderLatex(String.raw`\operatorname*{arg\,max}_{x\in X} f(x)`, {
        display: true,
      }),
      "arg max f(x)\n  x∈X",
    );
    assert.strictEqual(
      renderLatex(String.raw`\int\nolimits_0^1 f(x)\,dx`, { display: true }),
      "∫₀¹ f(x) dx",
    );
    assert.strictEqual(
      renderLatex(String.raw`\int\limits_0^1 f(x)\,dx`, { display: true }),
      "1\n∫ f(x) dx\n0",
    );
  });

  it("centers even case rows around a middle brace", () => {
    assert.strictEqual(
      renderLatex(String.raw`f(x) = \begin{cases} x^{2} & x \geq 0 \\ -x & x < 0 \end{cases}`),
      "       ⎧ x² if x ≥ 0\nf(x) = ⎨\n       ⎩ -x if x < 0",
    );
  });
});

describe("renderLatex", () => {
  it("stacks fractions in display mode", () => {
    assert.strictEqual(
      renderLatex(String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, {
        display: true,
      }),
      "    -b±√(b²-4ac)\nx = ────────────\n         2a",
    );
    assert.strictEqual(
      renderLatex(String.raw`\frac{x^2+1}{x-1}`, { display: true }),
      "x²+1\n────\nx-1",
    );
    assert.strictEqual(renderLatex("\\frac{1}\n{2}", { display: true }), "1\n─\n2");
  });

  it("keeps nested display fractions linear", () => {
    const cases: Array<[string, string]> = [
      [
        String.raw`\frac{\frac{x^2+1}{x-1}-\frac{2x}{x+1}}{\frac{x}{x^2-1}}`,
        "(x²+1)/(x-1)-2x/(x+1)\n─────────────────────\n      x/(x²-1)",
      ],
      [
        String.raw`\lim_{x\to 0}\frac{\frac{\sin x}{x}-1}{\frac{e^x-1}{x}-1}=0`,
        "     (sin x)/x-1\nlim  ─────────── = 0\nx→0  (eˣ-1)/x-1",
      ],
      [
        String.raw`\frac{1+\frac{1}{1+\frac{1}{x}}}{1-\frac{1}{1-\frac{1}{x}}}`,
        "1+1/(1+1/x)\n───────────\n1-1/(1-1/x)",
      ],
    ];
    for (const [source, expected] of cases) {
      assert.strictEqual(renderLatex(source, { display: true }), expected);
    }
  });
});

describe("renderLatex", () => {
  it("lays out unsupported and nested scripts while keeping script fractions linear", () => {
    assert.strictEqual(
      renderLatex(String.raw`\partial_tU_2(t,0)=Aj_*(1-t)^{-A-1}.\qquad x^{n^2}+x_{i_j}`, {
        display: true,
      }),
      "                            2\n                    -A-1   n\n∂ₜU₂(t,0) = Aj (1-t)    . x  +x\n              *                i\n                                j",
    );
    assert.strictEqual(
      renderLatex(String.raw`e^{\frac{1}{2}}+\tfrac{1}{2}`, { display: true }),
      "e^(1/2)+1/2",
    );
  });

  it("returns undefined for unsupported commands", () => {
    assert.strictEqual(renderLatex(String.raw`x + \unknown{y}`), undefined);
  });

  it("returns undefined for malformed groups and environments", () => {
    const malformed = [String.raw`\frac{1}{x`, "x}", String.raw`\begin{matrix}1 & 2`, "x\\"];
    for (const source of malformed) {
      assert.strictEqual(renderLatex(source), undefined);
    }
  });
});
