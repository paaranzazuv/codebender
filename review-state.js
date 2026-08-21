'use strict';

function mergeHunkOrigins(previous = [], current = [], source = 'manual') {
  const previousBySignature = new Map(previous.map((h) => [h.signature, h]));
  return current.map((hunk) => {
    const exact = previousBySignature.get(hunk.signature);
    if (exact) return { ...hunk, origins: normalizeOrigins(exact.origins) };

    const overlapping = previous.filter((old) => rangesOverlap(old.newStart, old.newEnd, hunk.newStart, hunk.newEnd));
    const inherited = overlapping.flatMap((old) => normalizeOrigins(old.origins));
    return { ...hunk, origins: normalizeOrigins([...inherited, source || 'manual']) };
  });
}

function normalizeOrigins(origins) {
  const items = Array.isArray(origins) ? origins : origins ? [origins] : [];
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function resolveOrigin(origins) {
  const values = normalizeOrigins(origins);
  if (!values.length) return { id: 'unknown', kind: 'unknown', label: 'Origen desconocido' };
  if (values.length > 1) return { id: 'mixed', kind: 'mixed', label: 'Mixto' };
  const id = values[0];
  if (id === 'manual') return { id, kind: 'manual', label: 'Manual' };
  return { id, kind: 'ai', label: agentLabel(id) };
}

function agentLabel(id) {
  const known = {
    claude: 'Claude Code',
    codex: 'Codex',
    kimi: 'Kimi Code',
    gemini: 'Gemini CLI',
    opencode: 'OpenCode'
  };
  return known[id] || id;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const a1 = Number(aStart || 0);
  const a2 = Math.max(a1 + 1, Number(aEnd || aStart || 0));
  const b1 = Number(bStart || 0);
  const b2 = Math.max(b1 + 1, Number(bEnd || bStart || 0));
  return a1 < b2 && b1 < a2;
}

function nextHunk(hunks, currentLine, direction = 1) {
  if (!Array.isArray(hunks) || !hunks.length) return undefined;
  const sorted = [...hunks].sort((a, b) => a.newStart - b.newStart);
  const line = Number(currentLine || 0);
  if (direction >= 0) return sorted.find((h) => h.newStart > line) || sorted[0];
  return [...sorted].reverse().find((h) => h.newStart < line) || sorted[sorted.length - 1];
}

function createStats() {
  return { accepted: 0, rejected: 0, staged: 0, feedback: 0, undone: 0 };
}

function normalizeStats(stats) {
  return { ...createStats(), ...(stats || {}) };
}


function shouldExposeInlineReview({ active, paused, trackedChange }) {
  return Boolean(active && !paused && trackedChange);
}

function summarizeSession(session, pendingFiles = 0) {
  const stats = normalizeStats(session?.stats);
  return {
    id: session?.id,
    startedAt: session?.startedAt,
    endedAt: session?.endedAt,
    accepted: stats.accepted,
    rejected: stats.rejected,
    staged: stats.staged,
    feedback: stats.feedback,
    undone: stats.undone,
    pendingFiles: Number(pendingFiles || 0),
    decisions: Array.isArray(session?.decisionHistory) ? session.decisionHistory.length : 0,
    comments: Array.isArray(session?.reviewComments) ? session.reviewComments.length : 0
  };
}

module.exports = {
  mergeHunkOrigins,
  normalizeOrigins,
  resolveOrigin,
  rangesOverlap,
  nextHunk,
  createStats,
  normalizeStats,
  summarizeSession,
  shouldExposeInlineReview
};
