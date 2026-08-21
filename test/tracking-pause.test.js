'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildResumePlan } = require('../tracking-pause');
const { canonicalizeTextForReview } = require('../hunks');

function reviewHashOf(text) {
  return crypto.createHash('sha256').update(canonicalizeTextForReview(text), 'utf8').digest('hex');
}

function hashOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

test('un archivo cuyo unico cambio durante la pausa es el fin de linea no se marca como cambiado', () => {
  const lfContent = 'uno\ndos\ntres\n';
  const crlfContent = 'uno\r\ndos\r\ntres\r\n';

  const pausedByKey = {
    'file:///repo::a.txt': { exists: true, hash: hashOf(lfContent), reviewHash: reviewHashOf(lfContent), size: lfContent.length, mtime: 1000 }
  };
  // Durante la pausa, algo (checkout de Git, autocrlf, etc.) reescribe el archivo con CRLF
  // pero el contenido real (texto) es idéntico.
  const currentByKey = {
    'file:///repo::a.txt': { exists: true, hash: hashOf(crlfContent), reviewHash: reviewHashOf(crlfContent), size: crlfContent.length, mtime: 2000 }
  };

  const plan = buildResumePlan({ pausedByKey, currentByKey, pendingKeys: [], conflictStrategy: 'keep-pending' });

  assert.deepEqual(plan.absorbKeys, []);
  assert.deepEqual(plan.unchangedKeys, ['file:///repo::a.txt']);
});

test('un archivo con un cambio de contenido real durante la pausa si se absorbe', () => {
  const before = 'uno\ndos\ntres\n';
  const after = 'uno\nDOS\ntres\n';

  const pausedByKey = {
    'file:///repo::a.txt': { exists: true, hash: hashOf(before), reviewHash: reviewHashOf(before), size: before.length, mtime: 1000 }
  };
  const currentByKey = {
    'file:///repo::a.txt': { exists: true, hash: hashOf(after), reviewHash: reviewHashOf(after), size: after.length, mtime: 2000 }
  };

  const plan = buildResumePlan({ pausedByKey, currentByKey, pendingKeys: [], conflictStrategy: 'keep-pending' });

  assert.deepEqual(plan.absorbKeys, ['file:///repo::a.txt']);
});
