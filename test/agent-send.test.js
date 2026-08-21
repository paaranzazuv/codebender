'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAgentPrompt,
  sanitizePromptText,
  encodeBracketedPaste
} = require('../agent-send');

test('el prompt pone primero la instrucción exacta del revisor y limita el cambio al bloque', () => {
  const prompt = buildAgentPrompt({
    rootName: 'demo',
    relativePath: 'src/app.ts',
    languageId: 'typescript',
    kind: 'modified',
    oldStart: 10,
    oldEnd: 11,
    newStart: 10,
    newEnd: 11,
    oldText: 'const value = 1;\n',
    newText: 'const value = 2;\n',
    annotation: 'Valida que el valor nunca sea negativo'
  });
  assert.match(prompt, /^CORRECCIÓN SOLICITADA POR EL REVISOR/);
  assert.match(prompt, /Instrucción: Valida que el valor nunca sea negativo/);
  assert.match(prompt, /Corrige únicamente este bloque pendiente de CodeBender/);
  assert.match(prompt, /src\/app\.ts/);
  assert.match(prompt, /const value = 2/);
});

test('sanitiza controles de terminal sin destruir saltos de línea del comentario', () => {
  const value = sanitizePromptText('línea 1\r\nlínea 2\u001b[31m');
  assert.equal(value, 'línea 1\nlínea 2[31m');
});

test('el transporte usa una única transacción bracketed paste para mensajes multilínea', () => {
  const encoded = encodeBracketedPaste('uno\ndos\ntres');
  assert.equal(encoded, '\u001b[200~uno\ndos\ntres\u001b[201~');
  assert.equal((encoded.match(/\u001b\[200~/g) || []).length, 1);
  assert.equal((encoded.match(/\u001b\[201~/g) || []).length, 1);
});
