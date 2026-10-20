const NESTED_CALL_LIMITS = {
  maxArgumentBytesPerCall: 8 * 1024,
  maxArgumentBytesTotal: 32 * 1024,
  maxCalls: 256,
  maxErrorChars: 500,
} as const;

const nestedToolCalls = {
  NESTED_CALL_LIMITS,
};

export default nestedToolCalls;
