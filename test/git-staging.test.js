'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { GitStaging } = require('../git-staging');

const execFileAsync = promisify(execFile);

async function git(cwd, args, options = {}) {
  return execFileAsync('git', args, { cwd, encoding: options.encoding || 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

async function makeRepo(initial = 'a\nb\nc\nd\n') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'codebender-test-'));
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.name', 'CodeBender Test']);
  await git(dir, ['config', 'user.email', 'test@codebender.local']);
  const file = path.join(dir, 'file.txt');
  await fsp.writeFile(file, initial);
  await git(dir, ['add', 'file.txt']);
  await git(dir, ['commit', '-qm', 'initial']);
  return { dir, file };
}

async function indexText(dir) {
  try {
    return (await git(dir, ['show', ':file.txt'])).stdout;
  } catch {
    return undefined;
  }
}

test('Accept + Stage aplica únicamente el bloque seleccionado', async (t) => {
  const { dir, file } = await makeRepo();
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const staging = new GitStaging();

  const baseline = 'a\nb\nc\nd\n';
  const desired = 'a\nB\nc\nd\n'; // solo bloque 1 aceptado
  await fsp.writeFile(file, 'a\nB\nc\nD\n'); // bloque 2 sigue pendiente en worktree

  await staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired });
  assert.equal(await indexText(dir), 'a\nB\nc\nd\n');
  assert.equal(await fsp.readFile(file, 'utf8'), 'a\nB\nc\nD\n');
});

test('preserva cambios staged existentes en otra zona del mismo archivo', async (t) => {
  const { dir, file } = await makeRepo();
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const staging = new GitStaging();

  await fsp.writeFile(file, 'a\nb\nC-STAGED\nd\n');
  await git(dir, ['add', 'file.txt']);
  const baseline = 'a\nb\nC-STAGED\nd\n';
  const desired = 'a\nB\nC-STAGED\nd\n';
  await fsp.writeFile(file, desired);

  await staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired });
  assert.equal(await indexText(dir), 'a\nB\nC-STAGED\nd\n');
});

test('no stagea cambios unstaged que ya existían antes de iniciar la sesión', async (t) => {
  const { dir, file } = await makeRepo();
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const staging = new GitStaging();

  // Cambio previo sin stage: forma parte del baseline de revisión, no del índice real.
  const baseline = 'a\nb\nC-PREVIO\nd\n';
  await fsp.writeFile(file, baseline);
  const desired = 'a\nB\nC-PREVIO\nd\n'; // Claude solo cambia b -> B
  await fsp.writeFile(file, desired);

  await staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired });
  assert.equal(await indexText(dir), 'a\nB\nc\nd\n');
  assert.equal(await fsp.readFile(file, 'utf8'), desired);
});

test('aborta sin tocar el índice cuando el bloque se solapa con un cambio previo incompatible', async (t) => {
  const { dir, file } = await makeRepo();
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const staging = new GitStaging();

  const baseline = 'a\nB-PREVIO\nc\nd\n';
  const desired = 'a\nB-CLAUDE\nc\nd\n';
  await fsp.writeFile(file, desired);
  const before = await indexText(dir);

  await assert.rejects(
    staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired }),
    /solapa con cambios/
  );
  assert.equal(await indexText(dir), before);
});

test('stagea una inserción seleccionada sin incluir otro cambio unstaged previo', async (t) => {
  const { dir, file } = await makeRepo('a\nb\nc\nd\ne\n');
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const staging = new GitStaging();

  const baseline = 'a\nb\nPREVIO\nc\nd\ne\n';
  const desired = 'a\nb\nPREVIO\nc\nNUEVO\nd\ne\n';
  await fsp.writeFile(file, desired);

  await staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired });
  assert.equal(await indexText(dir), 'a\nb\nc\nNUEVO\nd\ne\n');
});

test('stagea una eliminación seleccionada sin stagear el resto del worktree', async (t) => {
  const { dir, file } = await makeRepo('a\nb\nc\nd\ne\n');
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const staging = new GitStaging();

  const baseline = 'a\nb\nc\nd\ne\n';
  const desired = 'a\nb\nd\ne\n'; // elimina c
  await fsp.writeFile(file, 'A-PENDIENTE\nb\nd\ne\n');

  await staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired });
  assert.equal(await indexText(dir), 'a\nb\nd\ne\n');
  assert.equal(await fsp.readFile(file, 'utf8'), 'A-PENDIENTE\nb\nd\ne\n');
});

test('Accept + Stage parcial funciona con baseline LF y working tree CRLF sin stagear todo el archivo', async (t) => {
  const { dir, file } = await makeRepo('a\nb\nc\nd\n');
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  await git(dir, ['config', 'core.autocrlf', 'true']);
  const staging = new GitStaging();

  const baseline = 'a\nb\nc\nd\n';
  const desired = 'a\r\nB\r\nc\r\nd\r\n';
  await fsp.writeFile(file, 'a\r\nB\r\nc\r\nD\r\n');

  await staging.stageContentSafely({ filePath: file, baselineText: baseline, desiredText: desired });
  assert.equal(await indexText(dir), 'a\nB\nc\nd\n');
  assert.equal(await fsp.readFile(file, 'utf8'), 'a\r\nB\r\nc\r\nD\r\n');
});
