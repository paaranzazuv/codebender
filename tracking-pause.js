'use strict';

function stateSignature(entry) {
  if (!entry || entry.exists === false) return 'missing';
  if (entry.hash) return `hash:${entry.hash}`;
  return `meta:${Number(entry.size || 0)}:${Number(entry.mtime || 0)}`;
}

function buildResumePlan({ pausedByKey = {}, currentByKey = {}, pendingKeys = [], conflictStrategy = 'keep-pending' }) {
  const pending = new Set(pendingKeys);
  const keys = new Set([...Object.keys(pausedByKey), ...Object.keys(currentByKey)]);
  const absorbKeys = [];
  const preserveKeys = [];
  const conflictKeys = [];
  const unchangedPendingKeys = [];
  const unchangedKeys = [];

  for (const key of keys) {
    const before = pausedByKey[key] || { exists: false };
    const after = currentByKey[key] || { exists: false };
    const changedDuringPause = stateSignature(before) !== stateSignature(after);

    if (!pending.has(key)) {
      if (changedDuringPause) absorbKeys.push(key);
      else unchangedKeys.push(key);
      continue;
    }

    if (!changedDuringPause) {
      preserveKeys.push(key);
      unchangedPendingKeys.push(key);
      continue;
    }

    conflictKeys.push(key);
    if (conflictStrategy === 'absorb-all') absorbKeys.push(key);
    else preserveKeys.push(key);
  }

  return { absorbKeys, preserveKeys, conflictKeys, unchangedPendingKeys, unchangedKeys };
}

module.exports = { buildResumePlan, stateSignature };
