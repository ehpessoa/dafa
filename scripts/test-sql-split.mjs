// Testa o divisor de instruções do Editor SQL (web/src/lib/sql.ts).
import assert from 'node:assert/strict';
import { splitStatements, pickStatement, stripComments, toCsv } from '../web/src/lib/sql.ts';

const texts = (s) => splitStatements(s).map((x) => x.text);
assert.deepEqual(texts('select 1; select 2;'), ['select 1', 'select 2']);
assert.deepEqual(texts("select ';' a; select \"x;y\" from t"), ["select ';' a", 'select "x;y" from t']);
assert.deepEqual(texts("select 'it''s; ok'; select 2"), ["select 'it''s; ok'", 'select 2']);
assert.deepEqual(texts('-- um; dois\nselect 1; /* a; b */ select 2'), ['-- um; dois\nselect 1', '/* a; b */ select 2']);
assert.deepEqual(texts('/* a /* b; */ c; */ select 1'), ['/* a /* b; */ c; */ select 1']);   // comentário aninhado
assert.deepEqual(texts(' ;; -- só comentário\n; '), []);
assert.deepEqual(texts('select 1;\n-- fim'), ['select 1']);                                   // comentário final não vira instrução
assert.equal(stripComments("select 1 -- x\n, '--não' /* y */"), "select 1 \n, '--não'  ");

// instrução sob o cursor
const doc = 'select 1;\nselect 2;\n\nselect 3';
assert.equal(pickStatement(doc, 3, 3), 'select 1');
assert.equal(pickStatement(doc, 12, 12), 'select 2');
assert.equal(pickStatement(doc, 9, 9), 'select 1');            // logo após o ";" ainda é a instrução 1
assert.equal(pickStatement(doc, 20, 20), 'select 2');          // linha em branco → a anterior
assert.equal(pickStatement(doc, doc.length, doc.length), 'select 3');
assert.equal(pickStatement(doc, 10, 18), 'select 2');   // seleção manda
assert.equal(pickStatement(doc, 0, 19), 'select 1;\nselect 2;');  // (o servidor recusa: mais de uma instrução)
assert.equal(pickStatement('   ', 0, 0), '');

assert.equal(toCsv(['a', 'b'], [{ a: 1.5, b: 'x;y' }, { a: null, b: 'diz "oi"' }]), '﻿a;b\r\n1,5;"x;y"\r\n;"diz ""oi"""');
console.log('✅ Divisor de instruções do Editor SQL: ok');
