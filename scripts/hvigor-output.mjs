const ESCAPE = String.fromCharCode(0x1b);
const ANSI_CSI_PATTERN = new RegExp(
  `${ESCAPE}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

export function stripAnsi(value) {
  return value.replace(ANSI_CSI_PATTERN, '');
}

export function inspectHvigorOutput(value) {
  const output = stripAnsi(value);
  return {
    reportsFailure:
      /\bBUILD FAILED\b/i.test(output) ||
      /COMPILE RESULT\s*:\s*FAIL/i.test(output),
    reportsSuccess: /\bBUILD SUCCESSFUL\b/i.test(output),
  };
}
