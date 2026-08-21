'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class GitVersioning {
  constructor(options = {}) {
    this.gitPath = options.gitPath || 'git';
    this.logger = options.logger || (() => {});
  }

  async isAvailable() {
    try {
      await this.run(process.cwd(), ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async findRepoRoot(folderPath) {
    try {
      const result = await this.run(folderPath, ['rev-parse', '--show-toplevel']);
      return path.resolve(result.stdout.trim());
    } catch {
      return undefined;
    }
  }

  async getHead(repoRoot) {
    try {
      const result = await this.run(repoRoot, ['rev-parse', '--verify', 'HEAD']);
      return result.stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async getBranch(repoRoot) {
    try {
      const result = await this.run(repoRoot, ['branch', '--show-current']);
      return result.stdout.trim() || '(detached HEAD)';
    } catch {
      return '(sin rama)';
    }
  }


  async getStatus(repoRoot) {
    const result = await this.runBuffer(repoRoot, ['status', '--porcelain=v1', '-z']);
    return parsePorcelainStatus(result.stdout);
  }

  async getFileSizeAtCommit(repoRoot, commit, gitPath) {
    try {
      const spec = `${commit}:${normalizeGitPath(gitPath)}`;
      const result = await this.run(repoRoot, ['cat-file', '-s', spec]);
      const size = Number(result.stdout.trim());
      return Number.isFinite(size) ? size : undefined;
    } catch {
      return undefined;
    }
  }

  async readFileAtCommit(repoRoot, commit, gitPath) {
    const spec = `${commit}:${normalizeGitPath(gitPath)}`;
    const result = await this.runBuffer(repoRoot, ['cat-file', 'blob', spec]);
    return result.stdout;
  }

  async isIgnored(repoRoot, gitPath) {
    try {
      await this.run(repoRoot, ['check-ignore', '-q', '--', normalizeGitPath(gitPath)]);
      return true;
    } catch (error) {
      if (error?.code === 1) return false;
      return false;
    }
  }

  async getChangedFilesAgainstCommit({ repoRoot, commit, tempRoot, sessionId = 'refresh' }) {
    const checkpointDir = path.join(tempRoot, 'git-refresh', sanitize(sessionId));
    await fsp.mkdir(checkpointDir, { recursive: true });
    const indexPath = path.join(checkpointDir, `index-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await safeUnlink(indexPath);
    const env = { ...process.env, GIT_INDEX_FILE: indexPath };

    try {
      await this.run(repoRoot, ['read-tree', commit], { env });
      await this.run(repoRoot, ['add', '-A', '--', '.'], { env });
      const tree = (await this.run(repoRoot, ['write-tree'], { env })).stdout.trim();
      const result = await this.runBuffer(repoRoot, ['diff', '--name-only', '-z', commit, tree, '--'], { env });
      return splitNull(result.stdout).map(normalizeGitPath);
    } finally {
      await safeUnlink(indexPath);
    }
  }

  async getRecentCommits(repoRoot, limit = 20) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    try {
      const result = await this.runBuffer(repoRoot, [
        'log', `-n${safeLimit}`, '--date=iso-strict',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'
      ]);
      return parseCommitLog(result.stdout);
    } catch {
      return [];
    }
  }

  async createCheckpoint({ repoRoot, sessionId, sequence, label, parentCommit, tempRoot }) {
    const checkpointDir = path.join(tempRoot, 'git-checkpoints', sanitize(sessionId));
    await fsp.mkdir(checkpointDir, { recursive: true });
    const indexPath = path.join(checkpointDir, `index-${sequence}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await safeUnlink(indexPath);

    const env = {
      ...process.env,
      GIT_INDEX_FILE: indexPath,
      GIT_AUTHOR_NAME: 'CodeBender',
      GIT_AUTHOR_EMAIL: 'local@codebender',
      GIT_COMMITTER_NAME: 'CodeBender',
      GIT_COMMITTER_EMAIL: 'local@codebender'
    };

    try {
      const parent = parentCommit || await this.getHead(repoRoot);
      if (parent) await this.run(repoRoot, ['read-tree', parent], { env });
      else await this.run(repoRoot, ['read-tree', '--empty'], { env });
      await this.run(repoRoot, ['add', '-A', '--', '.'], { env });
      const tree = (await this.run(repoRoot, ['write-tree'], { env })).stdout.trim();
      const args = ['commit-tree', tree];
      if (parent) args.push('-p', parent);
      args.push('-m', label);
      const commit = (await this.run(repoRoot, args, { env })).stdout.trim();
      const ref = `refs/codebender/${sanitize(sessionId)}/checkpoints/${String(sequence).padStart(5, '0')}`;
      await this.run(repoRoot, ['update-ref', ref, commit], { env });
      return { commit, ref, tree };
    } finally {
      await safeUnlink(indexPath);
    }
  }

  async listCheckpointFiles(repoRoot, commit) {
    const result = await this.runBuffer(repoRoot, ['ls-tree', '-r', '-z', '--name-only', commit]);
    return splitNull(result.stdout).map(normalizeGitPath);
  }

  async listCurrentFiles(repoRoot) {
    const result = await this.runBuffer(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    return splitNull(result.stdout).map(normalizeGitPath);
  }

  async restoreCheckpoint({ repoRoot, commit, tempRoot }) {
    const checkpointFiles = new Set(await this.listCheckpointFiles(repoRoot, commit));
    const currentFiles = new Set(await this.listCurrentFiles(repoRoot));
    const restoreRoot = await fsp.mkdtemp(path.join(tempRoot || os.tmpdir(), 'codebender-restore-'));
    const indexPath = path.join(restoreRoot, 'index');
    const exportRoot = path.join(restoreRoot, 'tree');
    await fsp.mkdir(exportRoot, { recursive: true });
    await safeUnlink(indexPath);
    const env = { ...process.env, GIT_INDEX_FILE: indexPath };

    try {
      await this.run(repoRoot, ['read-tree', commit], { env });
      const prefix = ensureTrailingSeparator(exportRoot);
      await this.run(repoRoot, ['checkout-index', '-a', '-f', `--prefix=${prefix}`], { env });

      for (const relativePath of currentFiles) {
        if (checkpointFiles.has(relativePath)) continue;
        const target = safeJoin(repoRoot, relativePath);
        await fsp.rm(target, { force: true, recursive: false }).catch(() => {});
      }

      await copyTree(exportRoot, repoRoot);
      return { restoredFiles: checkpointFiles.size, removedFiles: [...currentFiles].filter((item) => !checkpointFiles.has(item)).length };
    } finally {
      await fsp.rm(restoreRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async deleteSessionRefs(repoRoot, sessionId) {
    const prefixes = [
      `refs/codebender/${sanitize(sessionId)}/`,
      `refs/claude-change-review/${sanitize(sessionId)}/`
    ];
    for (const prefix of prefixes) {
      let refs = [];
      try {
        const result = await this.run(repoRoot, ['for-each-ref', '--format=%(refname)', prefix]);
        refs = result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      } catch {
        continue;
      }
      for (const ref of refs) {
        await this.run(repoRoot, ['update-ref', '-d', ref]).catch(() => {});
      }
    }
  }

  async run(cwd, args, options = {}) {
    this.logger(`git ${args.join(' ')}`);
    const result = await execFileAsync(this.gitPath, args, {
      cwd,
      env: options.env || process.env,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8'
    });
    return result;
  }

  async runBuffer(cwd, args, options = {}) {
    this.logger(`git ${args.join(' ')}`);
    return execFileAsync(this.gitPath, args, {
      cwd,
      env: options.env || process.env,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'buffer'
    });
  }
}

async function copyTree(source, destination) {
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(destinationPath, { recursive: true });
      await copyTree(sourcePath, destinationPath);
    } else if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(sourcePath);
      await fsp.rm(destinationPath, { force: true, recursive: true }).catch(() => {});
      await fsp.symlink(target, destinationPath);
    } else {
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.copyFile(sourcePath, destinationPath);
      const stat = await fsp.stat(sourcePath);
      await fsp.chmod(destinationPath, stat.mode).catch(() => {});
    }
  }
}

function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...normalizeGitPath(relativePath).split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Ruta fuera del repositorio: ${relativePath}`);
  }
  return resolved;
}

function splitNull(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function normalizeGitPath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function ensureTrailingSeparator(value) {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function sanitize(value) {
  return String(value || 'session').replace(/[^A-Za-z0-9._-]/g, '-');
}

async function safeUnlink(filePath) {
  await fsp.unlink(filePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

function parsePorcelainStatus(buffer) {
  const records = buffer.toString('utf8').split('\0').filter(Boolean);
  const status = { staged: 0, modified: 0, untracked: 0, conflicted: 0, total: records.length, clean: records.length === 0 };
  for (const record of records) {
    const x = record[0] || ' ';
    const y = record[1] || ' ';
    if (x === '?' && y === '?') { status.untracked += 1; continue; }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) status.conflicted += 1;
    if (x !== ' ' && x !== '?') status.staged += 1;
    if (y !== ' ' && y !== '?') status.modified += 1;
  }
  return status;
}

function parseCommitLog(buffer) {
  return buffer.toString('utf8').split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, shortHash, author, date, ...subjectParts] = record.split('\x1f');
    return { hash, shortHash, author, date, subject: subjectParts.join('\x1f') };
  }).filter((item) => item.hash);
}

module.exports = {
  GitVersioning,
  normalizeGitPath,
  safeJoin,
  sanitize,
  splitNull,
  parsePorcelainStatus,
  parseCommitLog
};
