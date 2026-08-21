'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const manifest = require(path.join('..', 'package.json'));

test('Review Changes exposes accept/reject-all-file quick actions for normal changed files', () => {
  const commands = new Map(manifest.contributes.commands.map((entry) => [entry.command, entry]));
  assert.equal(commands.has('codeBender.acceptFile'), true);
  assert.equal(commands.has('codeBender.rejectFile'), true);
  assert.match(commands.get('codeBender.acceptFile').title, /Aceptar todos los cambios del archivo/);
  assert.match(commands.get('codeBender.rejectFile').title, /Rechazar todos los cambios del archivo/);

  const menus = manifest.contributes.menus['view/item/context'];
  const accept = menus.find((entry) => entry.command === 'codeBender.acceptFile');
  const reject = menus.find((entry) => entry.command === 'codeBender.rejectFile');

  assert.ok(accept);
  assert.ok(reject);
  assert.equal(accept.when, 'view == codeBender.changedFiles && viewItem == codeBender.change');
  assert.equal(reject.when, 'view == codeBender.changedFiles && viewItem == codeBender.change');
  assert.match(accept.group, /^inline@/);
  assert.match(reject.group, /^inline@/);
});
