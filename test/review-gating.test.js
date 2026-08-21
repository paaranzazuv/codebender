'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldExposeInlineReview } = require('../review-state');

test('iniciar sesión sin cambio nuevo no muestra acciones inline', () => {
  assert.equal(shouldExposeInlineReview({ active: true, paused: false, trackedChange: false }), false);
});

test('solo un cambio registrado después del inicio muestra acciones inline', () => {
  assert.equal(shouldExposeInlineReview({ active: true, paused: false, trackedChange: true }), true);
});

test('seguimiento pausado oculta las acciones aunque exista un cambio', () => {
  assert.equal(shouldExposeInlineReview({ active: true, paused: true, trackedChange: true }), false);
});
