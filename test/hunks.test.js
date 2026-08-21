'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeHunks, acceptHunkIntoBaseline, rejectHunkFromCurrent } = require('../hunks');

test('varios cambios separados producen varios bloques independientes', () => {
  const original = 'uno\ndos\ntres\ncuatro\ncinco\n';
  const current = 'UNO\ndos\ntres\nCUATRO\ncinco\n';
  const hunks = computeHunks(original, current);
  assert.equal(hunks.length, 2);

  const afterAcceptFirst = acceptHunkIntoBaseline(original, current, hunks[0]);
  const remaining = computeHunks(afterAcceptFirst, current);
  assert.equal(remaining.length, 1);
  assert.match(remaining[0].newText, /CUATRO/);
});

test('rechazar un bloque no altera los demás cambios pendientes', () => {
  const original = 'uno\ndos\ntres\ncuatro\ncinco\n';
  const current = 'UNO\ndos\ntres\nCUATRO\ncinco\n';
  const hunks = computeHunks(original, current);
  const afterRejectFirst = rejectHunkFromCurrent(original, current, hunks[0]);
  assert.equal(afterRejectFirst, 'uno\ndos\ntres\nCUATRO\ncinco\n');
  assert.equal(computeHunks(original, afterRejectFirst).length, 1);
});

test('abrir un archivo con CRLF frente a baseline Git LF no crea un cambio gigante', () => {
  const original = 'uno\ndos\ntres\n';
  const current = 'uno\r\ndos\r\ntres\r\n';
  const hunks = computeHunks(original, current);
  assert.equal(hunks.length, 0);
});

test('CRLF frente a LF conserva únicamente el bloque de código realmente cambiado', () => {
  const original = 'uno\ndos\ntres\ncuatro\n';
  const current = 'uno\r\nDOS\r\ntres\r\ncuatro\r\n';
  const hunks = computeHunks(original, current);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldText, 'dos\n');
  assert.equal(hunks[0].newText, 'DOS\r\n');
});

test('rechazar un bloque mantiene el EOL del archivo de trabajo', () => {
  const original = 'uno\ndos\ntres\n';
  const current = 'uno\r\nDOS\r\ntres\r\n';
  const [hunk] = computeHunks(original, current);
  const rejected = rejectHunkFromCurrent(original, current, hunk);
  assert.equal(rejected, 'uno\r\ndos\r\ntres\r\n');
  assert.equal(computeHunks(original, rejected).length, 0);
});

test('BOM en baseline no convierte la primera línea en cambio fantasma', () => {
  const original = '\ufeffuno\ndos\n';
  const current = 'uno\ndos\n';
  assert.equal(computeHunks(original, current).length, 0);
});
