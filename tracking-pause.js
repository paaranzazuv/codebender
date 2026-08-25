'use strict';

function stateSignature(entry) {
  if (!entry || entry.exists === false) return 'missing';
  // Preferir el hash normalizado: para archivos de texto, diferencias puramente
  // de EOL/BOM (p.ej. un checkout Git con autocrlf) no cuentan como cambio real.
  if (entry.reviewHash) return `review:${entry.reviewHash}`;
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

// Un session.json persistido de una versión anterior del esquema puede carecer
// de campos que el motor de refresco necesita para elegir el motor correcto
// (git-fast/hybrid vs. snapshot). Restaurarlo de todos modos hace que
// fullRefresh() caiga silenciosamente al escaneo de snapshot completo, y como
// el baseline de una sesión git-fast es disperso a propósito, cada archivo sin
// entrada de baseline se lee como "creado": todo el repositorio se marca como
// nuevo. Mejor rechazar la restauración que arriesgar ese falso positivo masivo.
function isRestorableBaselineMode(session) {
  const mode = session?.baselineMode;
  if (mode !== 'git-fast' && mode !== 'hybrid' && mode !== 'snapshot') return false;
  if (mode === 'git-fast' || mode === 'hybrid') {
    const repos = session?.git?.repos || [];
    if (!repos.length) return false;
    if (!repos.every((repo) => Boolean(repo?.baselineCommit))) return false;
  }
  return true;
}

module.exports = { buildResumePlan, stateSignature, isRestorableBaselineMode };
