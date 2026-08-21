'use strict';

const crypto = require('crypto');

/**
 * Divide texto en líneas conservando exactamente sus terminadores.
 * Esto permite reconstruir el archivo sin modificar CRLF/LF ni el salto final.
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  if (!text) return [];
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) || [];
}

/**
 * Diff Myers por líneas. Devuelve una secuencia mínima de equal/delete/insert.
 * @param {string[]} original
 * @param {string[]} current
 * @returns {{type:'equal'|'delete'|'insert', value:string}[]}
 */
function myersDiff(original, current) {
  let prefix = 0;
  while (prefix < original.length && prefix < current.length && original[prefix] === current[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < current.length - prefix &&
    original[original.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const before = original.slice(prefix, original.length - suffix);
  const after = current.slice(prefix, current.length - suffix);
  const middle = myersCore(before, after);

  return [
    ...original.slice(0, prefix).map((value) => ({ type: 'equal', value })),
    ...middle,
    ...original.slice(original.length - suffix).map((value) => ({ type: 'equal', value }))
  ];
}

function myersCore(original, current) {
  const n = original.length;
  const m = current.length;
  if (n === 0) return current.map((value) => ({ type: 'insert', value }));
  if (m === 0) return original.map((value) => ({ type: 'delete', value }));

  const max = n + m;
  /** @type {Map<number, number>} */
  let frontier = new Map();
  frontier.set(1, 0);
  /** @type {Map<number, number>[]} */
  const trace = [];

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(new Map(frontier));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const left = frontier.get(diagonal - 1);
      const down = frontier.get(diagonal + 1);
      let x;

      if (
        diagonal === -distance ||
        (diagonal !== distance && (left === undefined || (down !== undefined && left < down)))
      ) {
        x = down ?? 0;
      } else {
        x = (left ?? 0) + 1;
      }

      let y = x - diagonal;
      while (x < n && y < m && original[x] === current[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);

      if (x >= n && y >= m) {
        return backtrack(trace, original, current, distance);
      }
    }
  }

  throw new Error('No fue posible calcular las diferencias del archivo.');
}

function backtrack(trace, original, current, finalDistance) {
  let x = original.length;
  let y = current.length;
  /** @type {{type:'equal'|'delete'|'insert', value:string}[]} */
  const reversed = [];

  for (let distance = finalDistance; distance > 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = x - y;
    const left = frontier.get(diagonal - 1);
    const down = frontier.get(diagonal + 1);

    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance && (left === undefined || (down !== undefined && left < down)))
        ? diagonal + 1
        : diagonal - 1;

    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reversed.push({ type: 'equal', value: original[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (x === previousX) {
      reversed.push({ type: 'insert', value: current[y - 1] });
      y -= 1;
    } else {
      reversed.push({ type: 'delete', value: original[x - 1] });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    reversed.push({ type: 'equal', value: original[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reversed.push({ type: 'delete', value: original[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    reversed.push({ type: 'insert', value: current[y - 1] });
    y -= 1;
  }

  return reversed.reverse();
}

/**
 * Calcula bloques contiguos de cambios sin incluir líneas de contexto.
 * @param {string} originalText
 * @param {string} currentText
 * @returns {ChangeHunk[]}
 */
function computeHunks(originalText, currentText) {
  const originalLines = splitLines(originalText);
  const currentLines = splitLines(currentText);
  // Git puede almacenar LF mientras el working tree usa CRLF. Para la revisión
  // ambos representan el mismo código y no deben convertirse en un cambio gigante.
  const comparisonOriginal = originalLines.map((line, index) => canonicalizeLineForReview(line, index === 0));
  const comparisonCurrent = currentLines.map((line, index) => canonicalizeLineForReview(line, index === 0));
  const operations = myersDiff(comparisonOriginal, comparisonCurrent);

  let oldPosition = 0;
  let newPosition = 0;
  /** @type {ChangeHunk[]} */
  const hunks = [];
  /** @type {ChangeHunk | undefined} */
  let active;

  const finish = () => {
    if (!active) return;
    active.oldText = originalLines.slice(active.oldStart, active.oldEnd).join('');
    active.newText = currentLines.slice(active.newStart, active.newEnd).join('');
    active.kind = active.oldEnd === active.oldStart
      ? 'added'
      : active.newEnd === active.newStart
        ? 'deleted'
        : 'modified';
    active.signature = digest(`${active.kind}\0${active.oldText}\0${active.newText}`);
    active.id = digest(`${active.oldStart}:${active.oldEnd}:${active.newStart}:${active.newEnd}:${active.signature}`);
    hunks.push(active);
    active = undefined;
  };

  for (const operation of operations) {
    if (operation.type === 'equal') {
      finish();
      oldPosition += 1;
      newPosition += 1;
      continue;
    }

    if (!active) {
      active = {
        id: '',
        signature: '',
        kind: 'modified',
        oldStart: oldPosition,
        oldEnd: oldPosition,
        newStart: newPosition,
        newEnd: newPosition,
        oldText: '',
        newText: ''
      };
    }

    if (operation.type === 'delete') {
      oldPosition += 1;
      active.oldEnd = oldPosition;
    } else {
      newPosition += 1;
      active.newEnd = newPosition;
    }
  }

  finish();
  return hunks;
}

/** @param {string} originalText @param {string} currentText @param {ChangeHunk} hunk */
function acceptHunkIntoBaseline(originalText, currentText, hunk) {
  const originalLines = splitLines(originalText);
  const currentLines = splitLines(currentText);
  const targetEol = dominantEol(originalText) || dominantEol(currentText) || '\n';
  const replacement = currentLines
    .slice(hunk.newStart, hunk.newEnd)
    .map((line) => convertLineEnding(line, targetEol));
  originalLines.splice(
    hunk.oldStart,
    hunk.oldEnd - hunk.oldStart,
    ...replacement
  );
  return originalLines.join('');
}

/** @param {string} originalText @param {string} currentText @param {ChangeHunk} hunk */
function rejectHunkFromCurrent(originalText, currentText, hunk) {
  const originalLines = splitLines(originalText);
  const currentLines = splitLines(currentText);
  const targetEol = dominantEol(currentText) || dominantEol(originalText) || '\n';
  const replacement = originalLines
    .slice(hunk.oldStart, hunk.oldEnd)
    .map((line) => convertLineEnding(line, targetEol));
  currentLines.splice(
    hunk.newStart,
    hunk.newEnd - hunk.newStart,
    ...replacement
  );
  return currentLines.join('');
}

/**
 * Busca un bloque aunque un CodeLens haya quedado brevemente desactualizado.
 * @param {ChangeHunk[]} hunks
 * @param {{id?:string, signature?:string, newStart?:number}} descriptor
 */
function findHunk(hunks, descriptor) {
  const exact = descriptor.id ? hunks.find((hunk) => hunk.id === descriptor.id) : undefined;
  if (exact) return exact;
  const candidates = descriptor.signature
    ? hunks.filter((hunk) => hunk.signature === descriptor.signature)
    : [];
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const expected = descriptor.newStart ?? 0;
  return candidates.sort((a, b) => Math.abs(a.newStart - expected) - Math.abs(b.newStart - expected))[0];
}



/**
 * Normaliza solo la representación para comparar. No modifica el archivo.
 * Conserva la diferencia entre "con salto final" y "sin salto final", pero
 * trata LF, CRLF y CR como el mismo terminador. También ignora BOM UTF-8/Unicode
 * en la primera línea para evitar falsos positivos al usar TextDocument#getText().
 * @param {string} line
 * @param {boolean} firstLine
 */
function canonicalizeLineForReview(line, firstLine = false) {
  let value = String(line ?? '');
  if (firstLine && value.charCodeAt(0) === 0xfeff) value = value.slice(1);
  if (value.endsWith('\r\n')) return `${value.slice(0, -2)}\n`;
  if (value.endsWith('\n') || value.endsWith('\r')) return `${value.slice(0, -1)}\n`;
  return value;
}

/** @param {string} text */
function canonicalizeTextForReview(text) {
  return splitLines(String(text ?? ''))
    .map((line, index) => canonicalizeLineForReview(line, index === 0))
    .join('');
}

/** @param {string} text */
function dominantEol(text) {
  const value = String(text ?? '');
  const crlf = (value.match(/\r\n/g) || []).length;
  const withoutCrlf = value.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) || []).length;
  const cr = (withoutCrlf.match(/\r/g) || []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n';
  if (lf >= cr && lf > 0) return '\n';
  if (cr > 0) return '\r';
  return undefined;
}

/** @param {string} line @param {string} eol */
function convertLineEnding(line, eol) {
  const value = String(line ?? '');
  if (value.endsWith('\r\n')) return `${value.slice(0, -2)}${eol}`;
  if (value.endsWith('\n') || value.endsWith('\r')) return `${value.slice(0, -1)}${eol}`;
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
}

module.exports = {
  splitLines,
  myersDiff,
  computeHunks,
  acceptHunkIntoBaseline,
  rejectHunkFromCurrent,
  findHunk,
  canonicalizeLineForReview,
  canonicalizeTextForReview,
  dominantEol,
  convertLineEnding
};

/**
 * @typedef {Object} ChangeHunk
 * @property {string} id
 * @property {string} signature
 * @property {'added'|'modified'|'deleted'} kind
 * @property {number} oldStart
 * @property {number} oldEnd
 * @property {number} newStart
 * @property {number} newEnd
 * @property {string} oldText
 * @property {string} newText
 */
