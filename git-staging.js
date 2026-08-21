'use strict';

const path = require('path');
const fsp = require('fs/promises');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { splitLines, computeHunks, canonicalizeLineForReview, dominantEol, convertLineEnding } = require('./hunks');

const execFileAsync = promisify(execFile);
const CONTEXT_LIMIT = 12;

class GitStaging {
  constructor(options = {}) {
    this.gitPath = options.gitPath || 'git';
    this.logger = options.logger || (() => {});
  }

  async findRepoRoot(filePath) {
    try {
      const cwd = path.dirname(filePath);
      const { stdout } = await this.run(cwd, ['rev-parse', '--show-toplevel']);
      return path.resolve(stdout.trim());
    } catch {
      return undefined;
    }
  }

  async relativePath(repoRoot, filePath) {
    const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('../')) throw new Error('El archivo no pertenece al repositorio Git.');
    return rel;
  }

  async readIndexEntry(repoRoot, relativePath) {
    try {
      const { stdout } = await this.run(repoRoot, ['ls-files', '--stage', '--', relativePath]);
      const line = stdout.trim().split(/\r?\n/).find(Boolean);
      if (!line) return { exists: false };
      const match = line.match(/^(\d+)\s+([0-9a-f]{40,64})\s+(\d)\t/);
      if (!match) return { exists: false };
      const mode = match[1];
      const blob = match[2];
      const stage = Number(match[3]);
      if (stage !== 0) throw new Error('El archivo tiene un conflicto Git sin resolver; no se puede hacer stage por bloque de forma segura.');
      const { stdout: content } = await this.runBuffer(repoRoot, ['show', `:${relativePath}`]);
      return { exists: true, mode, blob, content };
    } catch (error) {
      if (isMissingIndexEntry(error)) return { exists: false };
      throw error;
    }
  }

  async captureIndexState(repoRoot, relativePath) {
    const entry = await this.readIndexEntry(repoRoot, relativePath);
    if (!entry.exists) return { exists: false, relativePath };
    return { exists: true, relativePath, mode: entry.mode, blob: entry.blob };
  }

  async restoreIndexState(repoRoot, state) {
    if (!state?.relativePath) return;
    if (!state.exists) {
      await this.run(repoRoot, ['update-index', '--force-remove', '--', state.relativePath]).catch(() => {});
      return;
    }
    await this.run(repoRoot, ['update-index', '--add', '--cacheinfo', `${state.mode},${state.blob},${state.relativePath}`]);
  }

  /**
   * Stagea SOLO la transformación baselineText -> desiredText sobre el índice actual.
   *
   * baselineText es la base de revisión de CodeBender justo antes de aceptar el bloque.
   * desiredText es esa misma base con únicamente el bloque seleccionado incorporado.
   * El índice Git puede ser diferente porque puede contener cambios staged previos o
   * porque el baseline Git-first puede incluir cambios unstaged existentes al inicio.
   *
   * En vez de reemplazar el archivo completo en el índice, localizamos el hunk exacto
   * sobre el contenido staged actual y aplicamos solo ese fragmento. Si no puede
   * localizarse de forma inequívoca, abortamos antes de escribir el índice.
   */
  async stageContentSafely({ filePath, baselineText, desiredText }) {
    const repoRoot = await this.findRepoRoot(filePath);
    if (!repoRoot) throw new Error('No se encontró un repositorio Git para este archivo.');
    const relativePath = await this.relativePath(repoRoot, filePath);
    const indexEntry = await this.readIndexEntry(repoRoot, relativePath);
    const before = await this.captureIndexState(repoRoot, relativePath);

    const baselineString = String(baselineText ?? '');
    const desiredString = String(desiredText ?? '');
    const baseline = Buffer.from(baselineString, 'utf8');
    const desired = Buffer.from(desiredString, 'utf8');
    const indexContent = indexEntry.exists ? Buffer.from(indexEntry.content) : Buffer.alloc(0);

    let merged;
    if (buffersEqual(indexContent, baseline)) {
      merged = desired;
    } else {
      const selectedHunks = computeHunks(baselineString, desiredString);
      if (selectedHunks.length !== 1) {
        throw new Error(
          `CodeBender esperaba un único bloque para “Aceptar + Stage”, pero detectó ${selectedHunks.length}. ` +
          'Se canceló el stage para no incluir cambios adicionales.'
        );
      }
      merged = Buffer.from(
        applySelectedHunkToIndex(baselineString, desiredString, indexContent.toString('utf8'), selectedHunks[0], relativePath),
        'utf8'
      );
    }

    if (merged.length === 0) {
      if (indexEntry.exists) await this.run(repoRoot, ['update-index', '--force-remove', '--', relativePath]);
      return { repoRoot, relativePath, before, afterHash: undefined, partial: true };
    }

    // --path hace que Git aplique los mismos clean filters/EOL que usaría git add,
    // evitando stagear CRLF/LF como cambios de contenido.
    const blob = (await this.runWithInput(repoRoot, ['hash-object', '-w', `--path=${relativePath}`, '--stdin'], merged)).stdout.trim();
    const mode = indexEntry.mode || await this.detectMode(filePath);
    await this.run(repoRoot, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${relativePath}`]);
    return { repoRoot, relativePath, before, afterHash: blob, partial: true };
  }

  async detectMode(filePath) {
    try {
      const stat = await fsp.stat(filePath);
      return (stat.mode & 0o111) ? '100755' : '100644';
    } catch {
      return '100644';
    }
  }

  async runWithInput(cwd, args, input) {
    this.logger(`git ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout = [];
      const stderr = [];
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        const out = Buffer.concat(stdout).toString('utf8');
        const err = Buffer.concat(stderr).toString('utf8');
        if (code === 0) resolve({ stdout: out, stderr: err });
        else {
          const error = new Error(err || `git terminó con código ${code}`);
          error.code = code;
          error.stderr = err;
          error.stdout = out;
          reject(error);
        }
      });
      child.stdin.end(Buffer.isBuffer(input) ? input : Buffer.from(input || ''));
    });
  }

  async run(cwd, args, options = {}) {
    this.logger(`git ${args.join(' ')}`);
    return execFileAsync(this.gitPath, args, {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8'
    });
  }

  async runBuffer(cwd, args) {
    this.logger(`git ${args.join(' ')}`);
    return execFileAsync(this.gitPath, args, {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'buffer'
    });
  }
}

/**
 * Aplica un único hunk baseline -> desired sobre indexText sin incorporar el
 * resto de desired. Es deliberadamente conservador: ante ambigüedad aborta.
 */
function applySelectedHunkToIndex(baselineText, desiredText, indexText, hunk, relativePath = 'archivo') {
  const baseLines = splitLines(baselineText);
  const desiredLines = splitLines(desiredText);
  const indexLines = splitLines(indexText);
  const oldLines = baseLines.slice(hunk.oldStart, hunk.oldEnd);
  const targetEol = dominantEol(indexText) || dominantEol(baselineText) || dominantEol(desiredText) || '\n';
  const newLines = desiredLines
    .slice(hunk.newStart, hunk.newEnd)
    .map((line) => convertLineEnding(line, targetEol));

  let start;
  if (oldLines.length > 0) {
    const candidates = findExactSpans(indexLines, oldLines);
    if (candidates.length === 0) {
      throw overlapError(relativePath);
    }
    start = chooseBestCandidate(candidates, baseLines, indexLines, hunk.oldStart, hunk.oldEnd, oldLines.length, relativePath);
  } else {
    const candidates = Array.from({ length: indexLines.length + 1 }, (_, index) => index);
    start = chooseBestInsertion(candidates, baseLines, indexLines, hunk.oldStart, relativePath);
  }

  indexLines.splice(start, oldLines.length, ...newLines);
  return indexLines.join('');
}

function findExactSpans(haystack, needle) {
  if (needle.length === 0) return [];
  const candidates = [];
  outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (!reviewLineEqual(haystack[start + offset], needle[offset], start + offset === 0, offset === 0)) continue outer;
    }
    candidates.push(start);
  }
  return candidates;
}

function chooseBestCandidate(candidates, baseLines, indexLines, oldStart, oldEnd, spanLength, relativePath) {
  if (candidates.length === 1) return candidates[0];
  const scored = candidates.map((candidate) => ({
    candidate,
    score: contextScore(baseLines, indexLines, oldStart, oldEnd, candidate, candidate + spanLength)
  })).sort((a, b) => b.score - a.score || Math.abs(a.candidate - oldStart) - Math.abs(b.candidate - oldStart));

  if (scored.length > 1 && scored[0].score === scored[1].score) throw ambiguityError(relativePath);
  return scored[0].candidate;
}

function chooseBestInsertion(candidates, baseLines, indexLines, basePosition, relativePath) {
  if (baseLines.length === 0 && indexLines.length === 0) return 0;
  const scored = candidates.map((candidate) => ({
    candidate,
    score: contextScore(baseLines, indexLines, basePosition, basePosition, candidate, candidate)
  })).sort((a, b) => b.score - a.score || Math.abs(a.candidate - basePosition) - Math.abs(b.candidate - basePosition));

  if (!scored.length || scored[0].score === 0) throw ambiguityError(relativePath);
  if (scored.length > 1 && scored[0].score === scored[1].score) throw ambiguityError(relativePath);
  return scored[0].candidate;
}

function contextScore(baseLines, indexLines, baseStart, baseEnd, indexStart, indexEnd) {
  let score = 0;
  for (let distance = 1; distance <= CONTEXT_LIMIT; distance += 1) {
    const baseIndex = baseStart - distance;
    const indexIndex = indexStart - distance;
    if (baseIndex < 0 || indexIndex < 0) break;
    if (!reviewLineEqual(baseLines[baseIndex], indexLines[indexIndex], baseIndex === 0, indexIndex === 0)) break;
    score += CONTEXT_LIMIT - distance + 1;
  }
  for (let distance = 0; distance < CONTEXT_LIMIT; distance += 1) {
    const baseIndex = baseEnd + distance;
    const indexIndex = indexEnd + distance;
    if (baseIndex >= baseLines.length || indexIndex >= indexLines.length) break;
    if (!reviewLineEqual(baseLines[baseIndex], indexLines[indexIndex], baseIndex === 0, indexIndex === 0)) break;
    score += CONTEXT_LIMIT - distance;
  }
  return score;
}


function reviewLineEqual(a, b, aFirst = false, bFirst = false) {
  return canonicalizeLineForReview(a, aFirst) === canonicalizeLineForReview(b, bFirst);
}

function overlapError(relativePath) {
  return new Error(
    `El bloque seleccionado se solapa con cambios que ya existen en el staging o con cambios previos a la sesión (${relativePath}). ` +
    'CodeBender no modificó el índice. Revisa ese bloque o stagea manualmente esa zona.'
  );
}

function ambiguityError(relativePath) {
  return new Error(
    `No se pudo ubicar de forma inequívoca el bloque dentro del staging de Git (${relativePath}). ` +
    'CodeBender no modificó el índice para evitar stagear el fragmento equivocado.'
  );
}

function buffersEqual(a, b) {
  if (!Buffer.isBuffer(a)) a = Buffer.from(a || '');
  if (!Buffer.isBuffer(b)) b = Buffer.from(b || '');
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return crypto.timingSafeEqual(a, b);
}

function isMissingIndexEntry(error) {
  const text = String(error?.stderr || error?.message || '');
  return /does not exist|exists on disk, but not in|path .* does not exist/i.test(text);
}

module.exports = {
  GitStaging,
  buffersEqual,
  applySelectedHunkToIndex,
  findExactSpans,
  contextScore
};
