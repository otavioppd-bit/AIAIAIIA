/**
 * CSV export escaping.
 *
 * Two opposing requirements: a cell must never execute as a formula when the
 * file is opened in a spreadsheet, and a legitimate value must never be turned
 * into text by an over-eager guard.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// The module pulls in browser-only helpers at call time, not at import time,
// so the escaping logic is re-declared here against the same source of truth.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/export.ts', import.meta.url), 'utf8');

/** Extracts the live `escape` implementation so the test cannot drift from it. */
function loadEscape(): (value: unknown) => string {
  const match = source.match(/const escape = \(value: unknown\): string => \{[\s\S]*?\n  \};/);
  assert.ok(match, 'não foi possível localizar a função de escape em export.ts');
  const body = match[0]
    .replace('const escape = (value: unknown): string =>', 'return (value) =>')
    .replace(/: string/g, '')
    .replace(/: unknown/g, '')
    .replace(/;$/, ';');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}`)() as (value: unknown) => string;
}

const escape = loadEscape();

test('neutraliza gatilhos de fórmula', () => {
  for (const hostile of ['=SUM(A1:A9)', '@cmd', '=cmd|\'/c calc\'!A1', '\tvalor', '\rvalor']) {
    assert.ok(
      escape(hostile).startsWith("'") || escape(hostile).startsWith('"'),
      `“${hostile}” não foi neutralizado: ${escape(hostile)}`,
    );
    assert.ok(!/^[=@]/.test(escape(hostile).replace(/^"/, '')));
  }
});

test('não transforma números negativos em texto', () => {
  // The `-` trigger overlaps with every negative number; the guard has to tell
  // them apart or an export silently corrupts its own numbers.
  for (const value of ['-1234.5', '-42', '+10', '3.14', '-.5']) {
    assert.equal(escape(value), value, `“${value}” foi alterado na exportação`);
  }
  // A decimal comma still gets quoted — that is CSV quoting, not neutralising:
  // the value survives round-tripping, which the apostrophe prefix would break.
  assert.equal(escape('-0,75'), '"-0,75"');
  assert.ok(!escape('-0,75').includes("'"));
});

test('neutraliza sinais seguidos de texto', () => {
  for (const hostile of ['-cmd', '+cmd|calc', '-1+1=2)*cmd']) {
    assert.ok(escape(hostile).startsWith("'"), `“${hostile}” não foi neutralizado`);
  }
});

test('cita valores que contêm separadores ou quebras de linha', () => {
  assert.equal(escape('a,b'), '"a,b"');
  assert.equal(escape('a;b'), '"a;b"');
  assert.equal(escape('linha1\nlinha2'), '"linha1\nlinha2"');
  assert.equal(escape('diz "oi"'), '"diz ""oi"""');
});

test('valores vazios viram célula vazia', () => {
  assert.equal(escape(null), '');
  assert.equal(escape(undefined), '');
});
