// Exact arithmetic for the AI assistant: numbers, + - * /, unary minus and
// brackets. A small recursive-descent parser, so no expression is ever run as
// code. Language models slip on mental arithmetic (a share computed against the
// wrong total, a growth rate off by a point); figures they report are worked
// out here instead.

/** Evaluate an arithmetic expression; throws an Error with a readable message. */
export function evaluate(expr) {
  const src = String(expr);
  if (/\d,\d/.test(src)) throw new Error('Write numbers without thousands separators (160840, not 160,840).');
  let i = 0;
  const peek = () => { while (/\s/.test(src[i] ?? '')) i++; return src[i]; };
  const fail = msg => { throw new Error(`${msg} at position ${i + 1} in "${src}"`); };

  function number() {
    const m = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) fail('Expected a number');
    i += m[0].length;
    return Number(m[0]);
  }
  function factor() {
    const c = peek();
    if (c === '-') { i++; return -factor(); }
    if (c === '+') { i++; return factor(); }
    if (c === '(') {
      i++;
      const v = sum();
      if (peek() !== ')') fail('Expected ")"');
      i++;
      return v;
    }
    return number();
  }
  function product() {
    let v = factor();
    for (let c = peek(); c === '*' || c === '/'; c = peek()) {
      i++;
      const r = factor();
      if (c === '/' && r === 0) fail('Division by zero');
      v = c === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    for (let c = peek(); c === '+' || c === '-'; c = peek()) {
      i++;
      v = c === '+' ? v + product() : v - product();
    }
    return v;
  }

  if (!src.trim()) fail('Empty expression');
  const v = sum();
  if (peek() !== undefined) fail(`Unexpected "${src[i]}"`);
  if (!Number.isFinite(v)) fail('Result is not a finite number');
  return v;
}
