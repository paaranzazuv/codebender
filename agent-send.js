'use strict';

const BUILTIN_AGENTS = Object.freeze({
  claude: {
    id: 'claude',
    label: 'Claude Code',
    icon: '$(sparkle)',
    matchers: ['claude code', 'claude'],
    defaultCommand: 'claude'
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi Code',
    icon: '$(sparkle)',
    matchers: ['kimi code', 'kimi'],
    defaultCommand: 'kimi'
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    icon: '$(terminal)',
    matchers: ['codex'],
    defaultCommand: 'codex'
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    icon: '$(sparkle)',
    matchers: ['gemini'],
    defaultCommand: 'gemini'
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    icon: '$(terminal)',
    matchers: ['opencode', 'open code'],
    defaultCommand: 'opencode'
  },
  active: {
    id: 'active',
    label: 'Terminal activa',
    icon: '$(terminal)',
    matchers: [],
    defaultCommand: ''
  }
});

// Backwards-compatible export name used by older tests/source.
const AGENTS = BUILTIN_AGENTS;

function normalizeCustomAdapters(adapters) {
  if (!Array.isArray(adapters)) return [];
  const seen = new Set(Object.keys(BUILTIN_AGENTS));
  const result = [];
  for (const raw of adapters) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const label = String(raw.label || raw.id || '').trim();
    const command = String(raw.command || '').trim();
    if (!id || !label || !command || seen.has(id)) continue;
    seen.add(id);
    const matchers = Array.isArray(raw.matchers)
      ? raw.matchers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : [label.toLowerCase(), id];
    result.push({ id, label, icon: '$(terminal)', matchers, defaultCommand: command, custom: true });
  }
  return result;
}

function allAgentDefinitions(customAdapters = []) {
  return [...Object.values(BUILTIN_AGENTS), ...normalizeCustomAdapters(customAdapters)];
}

function normalizeAgentId(value, customAdapters = []) {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'ask') return 'ask';
  return allAgentDefinitions(customAdapters).some((agent) => agent.id === id) ? id : 'ask';
}

function agentDefinition(id, customAdapters = []) {
  return allAgentDefinitions(customAdapters).find((agent) => agent.id === id);
}

function findMatchingTerminal(terminals, agentId, customAdapters = []) {
  if (!Array.isArray(terminals)) return undefined;
  if (agentId === 'active') return terminals.find((terminal) => terminal?.active) || terminals[0];
  const agent = agentDefinition(agentId, customAdapters);
  if (!agent) return undefined;
  return terminals.find((terminal) => {
    const name = String(terminal?.name || '').toLowerCase();
    return agent.matchers.some((matcher) => name.includes(matcher));
  });
}

function buildAgentPrompt({
  relativePath,
  rootName,
  languageId,
  kind,
  oldStart,
  oldEnd,
  newStart,
  newEnd,
  oldText,
  newText,
  annotation,
  maxChars = 12000,
  contextText = '',
  contextLabel = ''
}) {
  const note = sanitizePromptText(String(annotation || '').trim());
  const language = String(languageId || '').trim();
  const actual = kind === 'deleted' ? oldText : newText;
  const fragment = limitText(String(actual || ''), maxChars);
  const original = kind === 'modified' ? limitText(String(oldText || ''), Math.max(1000, Math.floor(maxChars / 2))) : '';
  const current = kind === 'modified' ? limitText(String(newText || ''), Math.max(1000, Math.floor(maxChars / 2))) : '';
  const extraContext = contextText ? limitText(String(contextText), maxChars) : '';
  const lineLabel = formatLineRange(kind, oldStart, oldEnd, newStart, newEnd);
  const fileLabel = rootName ? `${rootName}/${relativePath}` : relativePath;
  const fence = chooseFence(`${fragment}\n${original}\n${current}\n${extraContext}`);
  const info = language && /^[A-Za-z0-9_+.-]+$/.test(language) ? language : '';

  const parts = [
    'CORRECCIÓN SOLICITADA POR EL REVISOR',
    '',
    `Instrucción: ${note || 'Revisa y corrige este bloque.'}`,
    '',
    `Archivo: ${fileLabel}`,
    `Bloque pendiente: ${kindLabel(kind)} · ${lineLabel}`,
    '',
    'Reglas:',
    '- Corrige únicamente este bloque pendiente de CodeBender.',
    '- No aceptes, rechaces ni modifiques otros bloques pendientes.',
    '- No reemplaces el archivo completo si no es estrictamente necesario.',
    '- Trabaja sobre el archivo real del workspace; el fragmento siguiente es referencia para localizar el cambio.',
    ''
  ];

  if (kind === 'modified') {
    parts.push('Código actual que debe corregirse:', `${fence}${info}`, current, fence, '', 'Código anterior de referencia:', `${fence}${info}`, original, fence);
  } else if (kind === 'deleted') {
    parts.push('Código eliminado asociado al bloque:', `${fence}${info}`, fragment, fence);
  } else {
    parts.push('Código actual del bloque agregado:', `${fence}${info}`, fragment, fence);
  }

  if (extraContext) {
    parts.push('', contextLabel || 'Contexto cercano de referencia:', `${fence}${info}`, extraContext, fence);
  }

  parts.push('', 'Al terminar, indica brevemente qué corregiste en este bloque y deja los demás bloques pendientes intactos.');
  return parts.join('\n');
}

/**
 * Remove terminal control characters from reviewer-authored prompt text while
 * preserving tabs and line breaks. This prevents an annotation from injecting
 * terminal escape/control sequences into the agent terminal.
 */
function sanitizePromptText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Encode a multiline prompt as one bracketed-paste transaction. Interactive
 * coding CLIs such as Claude Code/readline-style TUIs can then receive embedded
 * newlines as paste content instead of treating each newline as a separate
 * submitted message.
 */
function encodeBracketedPaste(text) {
  const safe = sanitizePromptText(text);
  return `\u001b[200~${safe}\u001b[201~`;
}

function buildContextText({ mode = 'block', currentText = '', hunk, contextLines = 40, maxChars = 12000 }) {
  if (mode === 'block' || !hunk) return { text: '', label: '' };
  if (mode === 'file') return { text: limitText(currentText, maxChars), label: 'Archivo actual completo:' };
  const lines = splitLinesSimple(currentText);
  const before = Math.max(0, hunk.newStart - Math.max(5, Number(contextLines) || 40));
  const after = Math.min(lines.length, Math.max(hunk.newEnd, hunk.newStart + 1) + Math.max(5, Number(contextLines) || 40));
  return {
    text: limitText(lines.slice(before, after).join(''), maxChars),
    label: `Contexto cercano (líneas ${before + 1}-${after}):`
  };
}

function formatLineRange(kind, oldStart, oldEnd, newStart, newEnd) {
  if (kind === 'deleted') return humanRange(oldStart, oldEnd, 'línea original', 'líneas originales');
  return humanRange(newStart, newEnd, 'línea actual', 'líneas actuales');
}

function humanRange(start, end, singular, plural) {
  const first = Number(start || 0) + 1;
  const lastExclusive = Number(end || start || 0);
  const last = Math.max(first, lastExclusive);
  return first === last ? `${singular} ${first}` : `${plural} ${first}-${last}`;
}

function kindLabel(kind) {
  if (kind === 'added') return 'agregado';
  if (kind === 'deleted') return 'eliminado';
  return 'modificado';
}

function chooseFence(text) {
  const matches = String(text || '').match(/`+/g) || [];
  const longest = matches.reduce((max, value) => Math.max(max, value.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function limitText(text, maxChars) {
  const max = Math.max(500, Number(maxChars) || 12000);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n/* … fragmento truncado por CodeBender … */`;
}

function splitLinesSimple(text) {
  if (!text) return [];
  return String(text).match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) || [];
}

module.exports = {
  AGENTS,
  BUILTIN_AGENTS,
  normalizeCustomAdapters,
  allAgentDefinitions,
  normalizeAgentId,
  agentDefinition,
  findMatchingTerminal,
  buildAgentPrompt,
  buildContextText,
  sanitizePromptText,
  encodeBracketedPaste,
  chooseFence,
  limitText
};
