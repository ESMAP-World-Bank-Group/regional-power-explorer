// node --test src/chat/calc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './calc.js';

test('computes arithmetic exactly', () => {
  const cases = [
    ['(160840 - 137760) / 160840 * 100', 14.349664262621239], // Norway's net exports as % of generation, 2025
    ['6450 / 14040 * 100', 45.94017094017094], ['-(2 + 3) * 4', -20], ['2 - 3 - 4', -5],
    ['100 / 4 / 5', 5], ['1.5e3 + .5', 1500.5], ['\t( ( 1 ) )\n', 1], ['2*-3', -6],
  ];
  for (const [expr, want] of cases) assert.ok(Math.abs(evaluate(expr) - want) < 1e-9, expr);
});

test('refuses anything that is not arithmetic', () => {
  for (const expr of ['160,840 - 1', '1/0', 'alert(1)', '2 ** 3', '(1+2', '1+', '', 'Math.PI', '1; 2']) {
    assert.throws(() => evaluate(expr), Error, expr);
  }
});
