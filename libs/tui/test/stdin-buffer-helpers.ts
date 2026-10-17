// Helper to wait for async operations
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const replies = [
  // Ghostty's Ayu Light palette color 1.
  { header: "\x1b]4;1;", reply: "\x1b]4;1;rgb:eaea/6c6c/6d6d\x07" },
  { header: "\x1b]10;", reply: "\x1b]10;rgb:ffff/ffff/ffff\x1b\\" },
  { header: "\x1b]11;", reply: "\x1b]11;rgb:0000/0000/0000\x07" },
  // Another reported color-reply tail.
  { header: "\x1b]4;1;", reply: "\x1b]4;1;rgb:6464/6464/4d4d\x07" },
  { header: "\x1bP>|", reply: "\x1bP>|Ghostty 1.3.1\x1b\\" },
  { header: "\x1b_Gi=1;", reply: "\x1b_Gi=1;OK\x1b\\" },
  { header: "\x1b]7501;?", reply: "\x1b]7501;?\x1b\\" },
];
