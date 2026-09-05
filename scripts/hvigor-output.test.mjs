import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectHvigorOutput, stripAnsi } from './hvigor-output.mjs';

test('strips ANSI CSI color sequences from Hvigor output', () => {
  assert.equal(
    stripAnsi('> hvigor \u001B[32mBUILD SUCCESSFUL\u001B[39m'),
    '> hvigor BUILD SUCCESSFUL',
  );
});

test('recognizes a colorized successful build', () => {
  assert.deepEqual(
    inspectHvigorOutput('> hvigor \u001B[32mBUILD SUCCESSFUL in 6 s\u001B[39m'),
    { reportsFailure: false, reportsSuccess: true },
  );
});

test('recognizes colorized failure markers', () => {
  assert.deepEqual(
    inspectHvigorOutput('> hvigor \u001B[31mBUILD FAILED\u001B[39m'),
    { reportsFailure: true, reportsSuccess: false },
  );
  assert.deepEqual(
    inspectHvigorOutput('\u001B[31mCOMPILE RESULT : FAIL\u001B[39m'),
    { reportsFailure: true, reportsSuccess: false },
  );
});
