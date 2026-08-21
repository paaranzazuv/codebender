'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');
const { GitVersioning } = require('./git-versioning');
const { GitStaging } = require('./git-staging');
const { buildResumePlan } = require('./tracking-pause');
const {
  AGENTS,
  allAgentDefinitions,
  normalizeAgentId,
  agentDefinition,
  findMatchingTerminal,
  buildAgentPrompt,
  buildContextText,
  encodeBracketedPaste
} = require('./agent-send');
const {
  computeHunks,
  acceptHunkIntoBaseline,
  rejectHunkFromCurrent,
  findHunk,
  splitLines,
  canonicalizeTextForReview
} = require('./hunks');
const { mergeHunkOrigins, resolveOrigin, nextHunk, createStats, normalizeStats, summarizeSession, shouldExposeInlineReview } = require('./review-state');

const MANIFEST_VERSION = 7;
const MANIFEST_FILE = 'session.json';
const SNAPSHOT_DIR = 'snapshots';
const UNDO_DIR = 'undo';
const SESSION_HISTORY_KEY = 'codeBender.sessionHistory';

/** @type {ChangeReviewController | undefined} */
let controller;

async function activate(context) {
  controller = new ChangeReviewController(context);
  await controller.initialize();
  context.subscriptions.push(controller);
}

async function deactivate() {
  controller?.dispose();
}

class ChangeReviewController {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.context = context;
    this.provider = new ChangedFilesProvider();
    this.gitProvider = new GitHistoryProvider();
    this.sessionProvider = new SessionHistoryProvider();
    this.fileDecorationProvider = new ChangeFileDecorationProvider(this);
    this.codeLensProvider = new HunkCodeLensProvider(this);
    this.gitVersioning = new GitVersioning({ logger: (message) => this.log(message) });
    this.gitStaging = new GitStaging({ logger: (message) => this.log(message) });
    this.treeView = vscode.window.createTreeView('codeBender.changedFiles', {
      treeDataProvider: this.provider,
      showCollapseAll: false
    });
    this.gitTreeView = vscode.window.createTreeView('codeBender.gitHistory', {
      treeDataProvider: this.gitProvider,
      showCollapseAll: false
    });
    this.sessionTreeView = vscode.window.createTreeView('codeBender.sessions', {
      treeDataProvider: this.sessionProvider,
      showCollapseAll: false
    });
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 25);
    this.statusBar.command = 'codeBender.toggleTracking';
    this.statusBar.tooltip = 'CodeBender';
    this.statusBar.hide();

    /** @type {Map<string, BaselineEntry>} */
    this.baseline = new Map();
    /** @type {Map<string, ChangeEntry>} */
    this.changes = new Map();
    /** @type {Map<string, vscode.FileSystemWatcher>} */
    this.watchers = new Map();
    /** @type {Map<string, {baselineHash:string,currentHash:string,hunks:any[]}>} */
    this.hunkCache = new Map();
    /** @type {Map<string, Buffer>} */
    this.baselineContentCache = new Map();
    /** @type {Map<string, vscode.Uri>} */
    this.pendingUris = new Map();
    this.session = undefined;
    this.gitOverview = { available: false, repos: [], reason: undefined };
    this.refreshTimer = undefined;
    this.decorationGeneration = 0;
    this.disposables = [];
    this.sessionHistory = [];
    this.currentSource = 'manual';

    const icon = (name) => vscode.Uri.file(context.asAbsolutePath(`media/${name}`));
    this.addedBodyDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorGutter.addedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
    this.modifiedBodyDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorGutter.modifiedBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorGutter.modifiedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
    this.deletedBodyDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
    this.addedMarkerDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('change-added.svg'),
      gutterIconSize: 'contain'
    });
    this.modifiedMarkerDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('change-modified.svg'),
      gutterIconSize: 'contain'
    });
    this.deletedMarkerDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('change-deleted.svg'),
      gutterIconSize: 'contain'
    });
  }

  async initialize() {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    await this.ensureStorageDirectories();
    this.registerCommands();

    this.disposables.push(
      this.treeView,
      this.gitTreeView,
      this.sessionTreeView,
      this.statusBar,
      this.provider,
      this.gitProvider,
      this.sessionProvider,
      this.fileDecorationProvider,
      this.codeLensProvider,
      this.addedBodyDecoration,
      this.modifiedBodyDecoration,
      this.deletedBodyDecoration,
      this.addedMarkerDecoration,
      this.modifiedMarkerDecoration,
      this.deletedMarkerDecoration,
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this.codeLensProvider),
      vscode.window.registerFileDecorationProvider(this.fileDecorationProvider),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges?.length) this.queueDocumentRefresh(event.document);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => this.queueDocumentRefresh(document)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorateVisibleEditors()),
      vscode.window.onDidChangeActiveTextEditor(() => this.decorateVisibleEditors()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codeBender') || event.affectsConfiguration('claudeChangeReview')) {
          this.hunkCache.clear();
          this.codeLensProvider.refresh();
          this.decorateVisibleEditors();
        }
      })
    );

    this.sessionHistory = this.context.globalState.get(SESSION_HISTORY_KEY, []) || [];
    this.sessionProvider.setHistory(this.sessionHistory);
    await this.loadPersistedSession();
    await this.refreshGitOverview(false);
    await this.updateUi();
  }

  registerCommands() {
    const register = (name, handler, { optional = false } = {}) => {
      try {
        this.disposables.push(vscode.commands.registerCommand(name, handler));
      } catch (error) {
        if (!optional) throw error;
        // Un ID de compatibilidad puede estar ya reclamado por otra extensión
        // (p. ej. una instalación antigua de claude-change-review). No debe
        // tumbar el registro de los comandos propios de CodeBender.
        this.log(`No se pudo registrar el comando de compatibilidad '${name}': ${asMessage(error)}`);
      }
    };
    const registerCompat = (suffix, handler) => {
      register(`codeBender.${suffix}`, handler);
      // Compatibility with 0.1-0.5 local builds.
      register(`claudeChangeReview.${suffix}`, handler, { optional: true });
      register(`patchPilot.${suffix}`, handler, { optional: true });
    };

    registerCompat('startSession', () => this.startSession());
    registerCompat('endSession', () => this.endSession());
    registerCompat('pauseTracking', () => this.pauseTracking());
    registerCompat('resumeTracking', () => this.resumeTracking());
    registerCompat('toggleTracking', () => this.toggleTracking());
    registerCompat('refresh', () => this.fullRefresh(true));
    registerCompat('acceptFile', (item) => this.acceptFile(item));
    registerCompat('rejectFile', (item) => this.rejectFile(item));
    registerCompat('acceptAll', () => this.acceptAll());
    registerCompat('rejectAll', () => this.rejectAll());
    registerCompat('openFile', (item) => this.openFile(item));
    registerCompat('acceptDeletedBlock', (item) => this.acceptDeletedBlock(item));
    registerCompat('acceptAndStageDeletedBlock', (item) => this.acceptAndStageDeletedBlock(item));
    registerCompat('rejectDeletedBlock', (item) => this.rejectDeletedBlock(item));
    registerCompat('acceptHunk', (descriptor) => this.acceptHunk(descriptor));
    registerCompat('acceptAndStageHunk', (descriptor) => this.acceptAndStageHunk(descriptor));
    registerCompat('rejectHunk', (descriptor) => this.rejectHunk(descriptor));
    registerCompat('sendHunkToAgent', (descriptor) => this.sendHunkToAgent(descriptor));
    registerCompat('nextChange', () => this.navigateHunk(1));
    registerCompat('previousChange', () => this.navigateHunk(-1));
    registerCompat('undoLastDecision', () => this.undoLastDecision());
    registerCompat('setChangeSource', () => this.setChangeSource());
    registerCompat('setManualSource', () => this.setChangeSource('manual'));
    registerCompat('showReviewLog', () => this.showReviewLog());
    registerCompat('showSessionSummary', () => this.showSessionSummary());
    registerCompat('createCheckpoint', () => this.createManualCheckpoint());
    registerCompat('showGitHistory', () => this.showGitHistory());
    registerCompat('restoreCheckpoint', (item) => this.restoreGitCheckpoint(item));
    registerCompat('copyCheckpointHash', (item) => this.copyCheckpointHash(item));
    registerCompat('refreshGitState', () => this.refreshGitOverview(true));
    registerCompat('restoreGitCommit', (item) => this.restoreGitCommit(item));
    registerCompat('copyGitCommitHash', (item) => this.copyGitCommitHash(item));
    registerCompat('openSourceControl', () => vscode.commands.executeCommand('workbench.view.scm'));
  }

  async startSession() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('Abre una carpeta o espacio de trabajo antes de iniciar la revisión.');
      return;
    }

    if (this.session?.active) {
      const choice = await vscode.window.showWarningMessage(
        'Ya hay una sesión activa. ¿Deseas reemplazarla por una nueva copia base?',
        { modal: true },
        'Reiniciar sesión'
      );
      if (choice !== 'Reiniciar sesión') return;
      const previous = this.session;
      previous.endedAt = new Date().toISOString();
      await this.archiveSession(previous, this.changes.size);
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Preparando CodeBender…',
        cancellable: true
      },
      async (progress, token) => {
        await this.clearStorage();
        this.stopWatchers();
        this.session = undefined;
        this.baseline.clear();
        this.changes.clear();
        this.hunkCache.clear();
        this.baselineContentCache.clear();
        await this.updateUi();

        this.session = {
          id: crypto.randomUUID(),
          active: true,
          paused: false,
          startedAt: new Date().toISOString(),
          roots: folders.map((folder) => ({ name: folder.name, uri: folder.uri.toString() })),
          currentSource: 'manual',
          stats: createStats(),
          decisionHistory: [],
          undoStack: [],
          reviewComments: [],
          hunkMeta: {},
          baselineAbsentKeys: [],
          baselineMode: 'snapshot'
        };
        this.currentSource = 'manual';

        progress.report({ message: 'Detectando Git…' });
        const config = this.getConfig();
        if (config.gitFastBaseline) {
          await this.initializeGitSession(folders, { fast: true });
        } else {
          await this.initializeGitSession(folders, { fast: false });
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();

        const covered = new Set(
          (this.session.git?.available && config.gitFastBaseline
            ? this.session.git.repos.flatMap((repo) => repo.workspaceFolders || [])
            : [])
            .map((value) => path.resolve(value))
        );
        const fallbackFolders = folders.filter((folder) => !covered.has(path.resolve(folder.uri.fsPath)));

        if (covered.size) {
          this.session.baselineMode = fallbackFolders.length ? 'hybrid' : 'git-fast';
          progress.report({ message: fallbackFolders.length ? 'Git listo; respaldando carpetas fuera de Git…' : 'Git listo. Base creada sin copiar el proyecto.' });
        }

        if (fallbackFolders.length) {
          await this.captureSnapshotFolders(fallbackFolders, progress, token);
        }

        // El estado visible/abierto en VS Code forma parte de la base de inicio,
        // incluso si contiene cambios sin guardar o transformaciones del working tree.
        // Esto garantiza que iniciar CodeBender nunca convierta contenido preexistente
        // en bloques revisables. Solo cambios posteriores al inicio deben mostrar acciones.
        await this.captureOpenDocumentsAsBaseline();

        await this.persistSession();
        this.startWatchers();
        await this.updateUi();
      }
    ).then(
      () => {
        const fast = this.session?.baselineMode === 'git-fast' || this.session?.baselineMode === 'hybrid';
        const gitText = this.session?.git?.available
          ? ` Git detectado: ${this.session.git.repos.map((repo) => `${path.basename(repo.repoRoot)} (${repo.branch})`).join(', ')}.${fast ? ' Modo Git rápido activo.' : ''}`
          : ' No se detectó un repositorio Git; se usó respaldo por archivos.';
        vscode.window.showInformationMessage(`CodeBender inició la sesión.${gitText}`);
      },
      async (error) => {
        this.stopWatchers();
        this.session = undefined;
        this.baseline.clear();
        this.changes.clear();
        this.hunkCache.clear();
        this.baselineContentCache.clear();
        await this.clearStorage();
        await this.updateUi();
        if (!(error instanceof vscode.CancellationError)) {
          vscode.window.showErrorMessage(`No se pudo iniciar la sesión: ${asMessage(error)}`);
        }
      }
    );
  }

  async captureSnapshotFolders(folders, progress, token) {
    const config = this.getConfig();
    const files = [];
    for (const folder of folders) {
      if (token.isCancellationRequested) throw new vscode.CancellationError();
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const uris = await vscode.workspace.findFiles(pattern, config.excludeGlob, config.maxFiles);
      for (const uri of uris) {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        if (this.shouldIgnore(uri)) continue;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type === vscode.FileType.File) files.push({ uri, stat });
        } catch {
          // El archivo pudo desaparecer durante el escaneo.
        }
      }
    }

    const total = Math.max(files.length, 1);
    let completed = 0;
    let reported = 0;
    await mapWithConcurrency(files, 12, async ({ uri, stat }) => {
      if (token.isCancellationRequested) throw new vscode.CancellationError();
      const located = this.locate(uri);
      if (!located) return;
      const entry = await this.captureBaseline(located, uri, stat, config.maxFileSizeBytes);
      this.baseline.set(located.key, entry);
      completed += 1;
      if (completed === files.length || completed - reported >= 25) {
        const delta = completed - reported;
        reported = completed;
        progress.report({ increment: 100 * delta / total, message: `${completed}/${files.length} archivos fuera de Git` });
      }
    });
  }

  async endSession() {
    if (!this.session?.active) return;

    if (this.changes.size > 0) {
      const pendingBlocks = this.pendingHunkCount();
      const choice = await vscode.window.showWarningMessage(
        `Hay ${pendingBlocks || this.changes.size} bloque(s) pendiente(s) en ${this.changes.size} archivo(s). ` +
        'CodeBender toma decisiones por bloque, no por archivo.',
        { modal: true },
        'Finalizar dejando pendientes',
        'Volver a revisar'
      );
      if (choice !== 'Finalizar dejando pendientes') return;
    }

    this.stopWatchers();
    const finished = this.session;
    finished.endedAt = new Date().toISOString();
    await this.archiveSession(finished, this.changes.size);
    this.session = undefined;
    this.currentSource = 'manual';
    this.baseline.clear();
    this.changes.clear();
    this.hunkCache.clear();
    this.baselineContentCache.clear();
    await this.clearStorage();
    await this.updateUi();
    vscode.window.showInformationMessage('Sesión de CodeBender finalizada. El resumen quedó guardado en “Sesiones”.');
  }

  async toggleTracking() {
    if (!this.session?.active) return this.startSession();
    if (this.session.paused) return this.resumeTracking();
    return this.pauseTracking();
  }

  async pauseTracking() {
    if (!this.session?.active) {
      vscode.window.showInformationMessage('Inicia una sesión antes de pausar el seguimiento.');
      return;
    }
    if (this.session.paused) return;

    await this.fullRefresh(false);
    await this.createGitCheckpointInternal('Seguimiento pausado', 'pause');
    const currentByKey = await this.scanCurrentWorkspace();
    this.session.pause = {
      at: new Date().toISOString(),
      pendingKeys: [...this.changes.keys()],
      files: this.serializeWorkspaceState(currentByKey)
    };
    this.session.paused = true;
    this.stopWatchers();
    await this.persistSession();
    await this.updateUi();
    vscode.window.showInformationMessage(
      'Seguimiento pausado. Los cambios que hagas ahora se ignorarán al reanudar, salvo conflictos con archivos que ya tenían bloques pendientes.'
    );
  }

  async resumeTracking() {
    if (!this.session?.active) {
      vscode.window.showInformationMessage('No hay una sesión activa para reanudar.');
      return;
    }
    if (!this.session.paused) return;

    const currentByKey = await this.scanCurrentWorkspace();
    const currentState = this.serializeWorkspaceState(currentByKey);
    const pause = this.session.pause || { files: {}, pendingKeys: [] };
    const preliminary = buildResumePlan({
      pausedByKey: pause.files || {},
      currentByKey: currentState,
      pendingKeys: pause.pendingKeys || [],
      conflictStrategy: 'keep-pending'
    });

    let strategy = this.getConfig().pauseConflictStrategy;
    if (preliminary.conflictKeys.length && strategy === 'ask') {
      const choice = await vscode.window.showWarningMessage(
        `${preliminary.conflictKeys.length} archivo(s) ya tenían bloques pendientes y también fueron editados durante la pausa.`,
        { modal: true, detail: 'Puedes conservar todos esos cambios como pendientes o tomar su estado actual como nueva base.' },
        'Conservar como pendientes',
        'Ignorar estado actual',
        'Cancelar'
      );
      if (!choice || choice === 'Cancelar') return;
      strategy = choice === 'Ignorar estado actual' ? 'absorb-all' : 'keep-pending';
    }
    if (strategy === 'ask') strategy = 'keep-pending';

    const plan = buildResumePlan({
      pausedByKey: pause.files || {},
      currentByKey: currentState,
      pendingKeys: pause.pendingKeys || [],
      conflictStrategy: strategy
    });

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Reanudando seguimiento…', cancellable: false },
      async () => {
        for (const key of plan.absorbKeys) {
          await this.adoptCurrentAsBaseline(key, currentByKey.get(key));
        }
        this.session.paused = false;
        delete this.session.pause;
        this.changes.clear();
        this.hunkCache.clear();
        this.startWatchers();
        await this.fullRefresh(false);
        await this.createGitCheckpointInternal('Seguimiento reanudado', 'resume');
        await this.refreshGitOverview(false);
        await this.persistSession();
        await this.updateUi();
      }
    );

    const ignored = plan.absorbKeys.length;
    const conflictText = plan.conflictKeys.length
      ? ` ${plan.conflictKeys.length} archivo(s) con conflicto se ${strategy === 'absorb-all' ? 'tomaron como nueva base' : 'conservaron pendientes'}.`
      : '';
    vscode.window.showInformationMessage(`Seguimiento reanudado. Se ignoró el estado acumulado de ${ignored} archivo(s).${conflictText}`);
  }

  async scanCurrentWorkspace() {
    const config = this.getConfig();
    const currentUris = await vscode.workspace.findFiles('**/*', config.excludeGlob, config.maxFiles);
    const locatedByKey = new Map();

    for (const uri of currentUris) {
      if (this.shouldIgnore(uri)) continue;
      const located = this.locate(uri);
      if (!located) continue;
      if (!this.baseline.has(located.key) && await this.isIgnoredByGit(located)) continue;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.File) locatedByKey.set(located.key, { uri, stat, located });
      } catch {
        // El archivo pudo cambiar durante el escaneo.
      }
    }

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file' || !document.isDirty || this.shouldIgnore(document.uri)) continue;
      const located = this.locate(document.uri);
      if (!located) continue;
      if (!this.baseline.has(located.key) && await this.isIgnoredByGit(located)) continue;
      locatedByKey.set(located.key, { uri: document.uri, stat: undefined, located });
    }

    const result = new Map();
    for (const [key, item] of locatedByKey) {
      result.set(key, { ...item, current: await this.readCurrent(item.uri, item.stat) });
    }
    return result;
  }

  serializeWorkspaceState(currentByKey) {
    const state = {};
    const keys = new Set([...this.baseline.keys(), ...currentByKey.keys()]);
    for (const key of keys) {
      const item = currentByKey.get(key);
      const current = item?.current;
      state[key] = current?.exists
        ? { exists: true, hash: current.hash, reviewHash: current.reviewHash, size: current.stat?.size, mtime: current.stat?.mtime }
        : { exists: false };
    }
    return state;
  }

  async adoptCurrentAsBaseline(key, currentItem) {
    const old = this.baseline.get(key);
    if (old?.snapshot) await this.deleteStoragePath(old.snapshot);

    if (!currentItem?.current?.exists) {
      this.baseline.delete(key);
      this.baselineContentCache.delete(key);
      this.markBaselineAbsent(key, true);
      this.changes.delete(key);
      this.hunkCache.delete(key);
      if (this.session?.hunkMeta) delete this.session.hunkMeta[key];
      return;
    }

    const { located, current } = currentItem;
    if (current.content) {
      await this.setBaselineContent(located, current.content, current.stat);
    } else {
      this.baseline.set(key, this.makeLargeBaseline(located, current.stat));
    }
    this.changes.delete(key);
    this.hunkCache.delete(key);
    if (this.session?.hunkMeta) delete this.session.hunkMeta[key];
  }

  isBaselineMarkedAbsent(key) {
    return Boolean(this.session?.baselineAbsentKeys?.includes(key));
  }

  markBaselineAbsent(key, absent = true) {
    if (!this.session) return;
    const values = new Set(this.session.baselineAbsentKeys || []);
    if (absent) values.add(key);
    else values.delete(key);
    this.session.baselineAbsentKeys = [...values];
  }

  findGitBaselineTarget(located) {
    const repos = this.session?.git?.repos || [];
    const targetPath = path.resolve(located.uri.fsPath);
    for (const repo of repos) {
      if (!repo.baselineCommit) continue;
      const repoRoot = path.resolve(repo.repoRoot);
      if (targetPath !== repoRoot && !targetPath.startsWith(`${repoRoot}${path.sep}`)) continue;
      const gitPath = normalizePath(path.relative(repoRoot, targetPath));
      if (!gitPath || gitPath.startsWith('../')) continue;
      return { repo, gitPath };
    }
    return undefined;
  }

  async ensureBaselineForLocated(located) {
    const existing = this.baseline.get(located.key);
    if (existing) {
      if (existing.restorable && existing.text && !existing.reviewHash) {
        try {
          const content = await this.readBaselineContent(existing);
          existing.reviewHash = reviewSha256(content);
        } catch {
          // Una sesión antigua puede no tener ya el snapshot; se mantiene el fallback exacto.
        }
      }
      return existing;
    }
    if (this.isBaselineMarkedAbsent(located.key)) return undefined;

    const target = this.findGitBaselineTarget(located);
    if (!target) return undefined;
    const { repo, gitPath } = target;
    const size = await this.gitVersioning.getFileSizeAtCommit(repo.repoRoot, repo.baselineCommit, gitPath);
    if (size === undefined) return undefined;

    const maxSize = this.getConfig().maxFileSizeBytes;
    if (size > maxSize) {
      const entry = {
        key: located.key,
        rootUri: located.root.uri.toString(),
        rootName: located.root.name,
        relativePath: located.relativePath,
        existed: true,
        size,
        mtime: -1,
        hash: undefined,
        snapshot: undefined,
        gitRepoRoot: repo.repoRoot,
        gitCommit: repo.baselineCommit,
        gitPath,
        restorable: false,
        text: false
      };
      this.baseline.set(located.key, entry);
      return entry;
    }

    const content = await this.gitVersioning.readFileAtCommit(repo.repoRoot, repo.baselineCommit, gitPath);
    const text = isProbablyText(content);
    const entry = {
      key: located.key,
      rootUri: located.root.uri.toString(),
      rootName: located.root.name,
      relativePath: located.relativePath,
      existed: true,
      size: content.byteLength,
      mtime: -1,
      hash: sha256(content),
      reviewHash: text ? reviewSha256(content) : undefined,
      snapshot: undefined,
      gitRepoRoot: repo.repoRoot,
      gitCommit: repo.baselineCommit,
      gitPath,
      restorable: true,
      text
    };
    this.baseline.set(located.key, entry);
    this.baselineContentCache.set(located.key, Buffer.from(content));
    return entry;
  }

  async isIgnoredByGit(located) {
    const target = this.findGitBaselineTarget(located);
    if (!target) return false;
    return this.gitVersioning.isIgnored(target.repo.repoRoot, target.gitPath);
  }

  async readBaselineContent(baseline) {
    if (!baseline) return Buffer.alloc(0);
    const cached = this.baselineContentCache.get(baseline.key);
    if (cached) return Buffer.from(cached);
    let content;
    if (baseline.snapshot) {
      content = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.context.globalStorageUri, baseline.snapshot));
    } else if (baseline.gitRepoRoot && baseline.gitCommit && baseline.gitPath) {
      content = await this.gitVersioning.readFileAtCommit(baseline.gitRepoRoot, baseline.gitCommit, baseline.gitPath);
    } else {
      throw new Error('La copia base de este archivo no está disponible.');
    }
    this.baselineContentCache.set(baseline.key, Buffer.from(content));
    return content;
  }

  async captureBaseline(located, uri, stat, maxSize) {
    if (stat.size > maxSize) {
      return this.makeLargeBaseline(located, stat);
    }
    const content = await vscode.workspace.fs.readFile(uri);
    return this.createBaselineEntry(located, content, stat);
  }

  makeLargeBaseline(located, stat) {
    return {
      key: located.key,
      rootUri: located.root.uri.toString(),
      rootName: located.root.name,
      relativePath: located.relativePath,
      existed: true,
      size: stat.size,
      mtime: stat.mtime,
      hash: undefined,
      snapshot: undefined,
      restorable: false,
      text: false
    };
  }

  async createBaselineEntry(located, content, stat = undefined) {
    const snapshot = `${SNAPSHOT_DIR}/${safeSnapshotName(located.key)}`;
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, snapshot), content);
    const text = isProbablyText(content);
    return {
      key: located.key,
      rootUri: located.root.uri.toString(),
      rootName: located.root.name,
      relativePath: located.relativePath,
      existed: true,
      size: content.byteLength,
      mtime: stat?.mtime ?? Date.now(),
      hash: sha256(content),
      reviewHash: text ? reviewSha256(content) : undefined,
      snapshot,
      restorable: true,
      text
    };
  }

  async setBaselineContent(located, content, stat = undefined) {
    const old = this.baseline.get(located.key);
    if (old?.snapshot) await this.deleteStoragePath(old.snapshot);
    this.baselineContentCache.delete(located.key);
    this.markBaselineAbsent(located.key, false);
    const entry = await this.createBaselineEntry(located, content, stat);
    this.baseline.set(located.key, entry);
    this.baselineContentCache.set(located.key, Buffer.from(content));
    this.hunkCache.delete(located.key);
    return entry;
  }

  async captureOpenDocumentsAsBaseline() {
    if (!this.session?.active) return;
    let captured = 0;
    const maxSize = this.getConfig().maxFileSizeBytes;

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file' || this.shouldIgnore(document.uri)) continue;
      const located = this.locate(document.uri);
      if (!located) continue;

      const content = Buffer.from(document.getText(), 'utf8');
      if (content.byteLength > maxSize) continue;

      let stat;
      try {
        stat = await vscode.workspace.fs.stat(document.uri);
      } catch {
        stat = { type: vscode.FileType.File, size: content.byteLength, mtime: Date.now(), ctime: 0 };
      }

      await this.setBaselineContent(located, content, stat);
      this.changes.delete(located.key);
      if (this.session?.hunkMeta) delete this.session.hunkMeta[located.key];
      captured += 1;
    }

    if (captured) this.log(`Base de inicio: ${captured} documento(s) abierto(s) absorbidos sin crear bloques.`);
  }

  startWatchers() {
    this.stopWatchers();
    if (!this.session?.active || this.session.paused) return;
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
      watcher.onDidCreate((uri) => this.queueUriRefresh(uri));
      watcher.onDidChange((uri) => this.queueUriRefresh(uri));
      watcher.onDidDelete((uri) => this.queueUriRefresh(uri));
      this.watchers.set(folder.uri.toString(), watcher);
    }
  }

  stopWatchers() {
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.pendingUris.clear();
  }

  queueDocumentRefresh(document) {
    if (document.uri.scheme !== 'file') return;
    this.queueUriRefresh(document.uri);
  }

  queueUriRefresh(uri) {
    if (!this.session?.active || this.session.paused || this.shouldIgnore(uri)) return;
    const located = this.locate(uri);
    if (located) this.hunkCache.delete(located.key);
    this.pendingUris.set(uri.toString(), uri);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      const uris = [...this.pendingUris.values()];
      this.pendingUris.clear();
      for (const pending of uris) {
        try {
          await this.refreshUri(pending);
        } catch (error) {
          this.log(`No se pudo actualizar ${pending.fsPath}: ${asMessage(error)}`);
        }
      }
      await this.updateUi();
    }, 180);
  }

  async refreshUri(uri, recordOrigin = true) {
    const located = this.locate(uri);
    if (!located) return;
    let baseline = await this.ensureBaselineForLocated(located);
    if (!baseline && await this.isIgnoredByGit(located)) {
      this.changes.delete(located.key);
      this.hunkCache.delete(located.key);
      return;
    }
    const current = await this.readCurrent(uri);
    const change = await determineChange(located, baseline, current);
    if (change) this.changes.set(located.key, change);
    else this.changes.delete(located.key);
    if (recordOrigin) await this.updateHunkMeta(located, current).catch(() => {});
    this.hunkCache.delete(located.key);
  }

  async updateHunkMeta(located, current) {
    if (!this.session?.active || !located) return;
    this.session.hunkMeta = this.session.hunkMeta || {};
    const baseline = await this.ensureBaselineForLocated(located);
    if ((baseline && (!baseline.restorable || !baseline.text)) || (current?.exists && (!current.content || !current.text))) return;
    const originalText = baseline
      ? Buffer.from(await this.readBaselineContent(baseline)).toString('utf8')
      : '';
    const currentText = current?.exists && current?.content ? current.content.toString('utf8') : '';
    const fresh = computeHunks(originalText, currentText);
    const previous = this.session.hunkMeta[located.key]?.hunks || [];
    const merged = mergeHunkOrigins(previous, fresh, this.currentSource || this.session.currentSource || 'manual');
    this.session.hunkMeta[located.key] = {
      updatedAt: new Date().toISOString(),
      hunks: merged.map((h) => ({
        signature: h.signature,
        id: h.id,
        kind: h.kind,
        newStart: h.newStart,
        newEnd: h.newEnd,
        oldStart: h.oldStart,
        oldEnd: h.oldEnd,
        origins: h.origins || []
      }))
    };
  }

  originForHunk(key, hunk) {
    const meta = this.session?.hunkMeta?.[key]?.hunks || [];
    const exact = meta.find((item) => item.signature === hunk.signature);
    if (exact) return resolveOrigin(exact.origins);
    const overlap = meta.filter((item) => item.newStart < Math.max(hunk.newEnd, hunk.newStart + 1) && hunk.newStart < Math.max(item.newEnd, item.newStart + 1));
    const origins = overlap.flatMap((item) => item.origins || []);
    return resolveOrigin(origins.length ? origins : [this.currentSource || 'manual']);
  }

  async captureUndoState(uri, action, label) {
    if (!this.session?.active) return undefined;
    const located = this.locate(uri);
    if (!located) return undefined;
    const id = crypto.randomUUID();
    const dir = `${UNDO_DIR}/${id}`;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, ...dir.split('/')));

    const baseline = await this.ensureBaselineForLocated(located);
    const current = await this.readCurrent(uri);
    const record = {
      id,
      at: new Date().toISOString(),
      action,
      label,
      key: located.key,
      uri: uri.toString(),
      relativePath: located.relativePath,
      available: true,
      baseline: { exists: Boolean(baseline) },
      current: { exists: Boolean(current.exists) }
    };

    if (baseline) {
      if (!baseline.restorable) {
        record.available = false;
      } else {
        const bytes = await this.readBaselineContent(baseline);
        const snap = `${dir}/baseline.bin`;
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, ...snap.split('/')), bytes);
        record.baseline.snapshot = snap;
        record.baseline.text = baseline.text;
      }
    }

    if (current.exists) {
      if (!current.content) {
        record.available = false;
      } else {
        const snap = `${dir}/current.bin`;
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, ...snap.split('/')), current.content);
        record.current.snapshot = snap;
        record.current.text = current.text;
      }
    }

    return record;
  }

  recordDecision(undo, meta) {
    if (!this.session?.active) return;
    this.session.stats = normalizeStats(this.session.stats);
    this.session.decisionHistory = this.session.decisionHistory || [];
    this.session.undoStack = this.session.undoStack || [];
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action: meta.action,
      relativePath: meta.relativePath,
      hunkSignature: meta.hunk?.signature,
      source: meta.source || 'unknown',
      undoId: undo?.id,
      undone: false
    };
    this.session.decisionHistory.push(entry);
    if (meta.action === 'accept' || meta.action === 'accept-stage') this.session.stats.accepted += 1;
    if (meta.action === 'reject') this.session.stats.rejected += 1;
    if (undo?.available) {
      undo.decisionAction = meta.action;
      undo.decisionLogId = entry.id;
      this.session.undoStack.push(undo);
      if (this.session.undoStack.length > 50) this.session.undoStack.splice(0, this.session.undoStack.length - 50);
    }
  }

  async undoLastDecision() {
    if (!this.session?.active) {
      vscode.window.showInformationMessage('No hay una sesión activa.');
      return;
    }
    const stack = this.session.undoStack || [];
    const record = stack[stack.length - 1];
    if (!record) {
      vscode.window.showInformationMessage('No hay una decisión que se pueda deshacer.');
      return;
    }
    try {
      const uri = vscode.Uri.parse(record.uri);
      const located = this.locate(uri) || this.locateFromKey?.(record.key);
      if (!located) throw new Error('El archivo ya no pertenece al workspace actual.');

      if (record.baseline?.exists) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.context.globalStorageUri, ...record.baseline.snapshot.split('/')));
        await this.setBaselineContent(located, bytes);
      } else {
        const existing = this.baseline.get(located.key);
        if (existing?.snapshot) await this.deleteStoragePath(existing.snapshot);
        this.baseline.delete(located.key);
        this.baselineContentCache.delete(located.key);
        this.markBaselineAbsent(located.key, true);
      }

      if (record.current?.exists) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.context.globalStorageUri, ...record.current.snapshot.split('/')));
        await this.writeCurrentContent(uri, bytes, record.current.text !== false);
      } else {
        await this.deleteCurrentFile(uri);
      }

      if (record.indexState?.repoRoot && record.indexState?.state) {
        await this.gitStaging.restoreIndexState(record.indexState.repoRoot, record.indexState.state);
      }

      stack.pop();
      this.session.stats = normalizeStats(this.session.stats);
      this.session.stats.undone += 1;
      if (record.decisionAction === 'accept' || record.decisionAction === 'accept-stage') {
        this.session.stats.accepted = Math.max(0, this.session.stats.accepted - 1);
      }
      if (record.decisionAction === 'accept-stage') this.session.stats.staged = Math.max(0, this.session.stats.staged - 1);
      if (record.decisionAction === 'reject') this.session.stats.rejected = Math.max(0, this.session.stats.rejected - 1);
      const log = (this.session.decisionHistory || []).find((item) => item.id === record.decisionLogId);
      if (log) log.undone = true;
      this.session.decisionHistory.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        action: 'undo',
        relativePath: record.relativePath,
        targetDecisionId: record.decisionLogId
      });

      await this.refreshUri(uri, false);
      await this.refreshGitOverview(false);
      await this.persistSession();
      await this.updateUi();
      vscode.window.showInformationMessage(`Deshecha la última decisión en ${record.relativePath}.`);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo deshacer la decisión: ${asMessage(error)}`);
    }
  }

  async navigateHunk(direction) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Abre un archivo con cambios pendientes.');
      return;
    }
    const hunks = await this.getHunksForDocument(editor.document);
    if (!hunks.length) {
      vscode.window.showInformationMessage('El archivo activo no tiene bloques pendientes.');
      return;
    }
    const line = editor.selection.active.line;
    const target = nextHunk(hunks, line, direction);
    if (!target) return;
    const targetLine = Math.min(Math.max(target.newStart, 0), Math.max(editor.document.lineCount - 1, 0));
    const pos = new vscode.Position(targetLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async setChangeSource(source = undefined) {
    if (!this.session?.active) {
      vscode.window.showInformationMessage('Inicia una sesión antes de seleccionar el origen de cambios.');
      return;
    }
    const config = this.getConfig();
    let selected = source;
    if (!selected) {
      const choices = [
        { label: '$(person) Manual', description: 'Cambios escritos por ti', id: 'manual' },
        ...allAgentDefinitions(config.agentAdapters)
          .filter((agent) => agent.id !== 'active')
          .map((agent) => ({ label: `${agent.icon || '$(terminal)'} ${agent.label}`, description: 'Atribuir próximos cambios a este agente', id: agent.id }))
      ];
      const picked = await vscode.window.showQuickPick(choices, {
        title: 'CodeBender · Origen de los próximos cambios',
        placeHolder: 'La atribución es best-effort; puedes cambiarla en cualquier momento.'
      });
      selected = picked?.id;
    }
    if (!selected) return;
    this.currentSource = selected;
    this.session.currentSource = selected;
    await this.persistSession();
    await this.updateUi();
    const label = selected === 'manual' ? 'Manual' : (agentDefinition(selected, config.agentAdapters)?.label || selected);
    vscode.window.showInformationMessage(`CodeBender atribuirá los próximos cambios a: ${label}.`);
  }

  async archiveSession(session, pendingFiles = 0) {
    const summary = summarizeSession(session, pendingFiles);
    this.sessionHistory = [summary, ...(this.sessionHistory || []).filter((item) => item.id !== summary.id)].slice(0, 50);
    await this.context.globalState.update(SESSION_HISTORY_KEY, this.sessionHistory);
    this.sessionProvider.setHistory(this.sessionHistory);
  }

  async showSessionSummary() {
    if (!this.session?.active) {
      if (!this.sessionHistory.length) return vscode.window.showInformationMessage('Todavía no hay sesiones de CodeBender.');
      const latest = this.sessionHistory[0];
      return vscode.window.showInformationMessage(formatSessionSummary(latest));
    }
    vscode.window.showInformationMessage(formatSessionSummary(summarizeSession(this.session, this.changes.size)));
  }

  showReviewLog() {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('CodeBender');
      this.disposables.push(this.outputChannel);
    }
    this.outputChannel.clear();
    this.outputChannel.appendLine('CodeBender · Review log');
    this.outputChannel.appendLine('');
    for (const decision of this.session?.decisionHistory || []) {
      const marker = decision.undone ? ' [deshecho]' : '';
      this.outputChannel.appendLine(`${decision.at} · ${decision.action} · ${decision.relativePath || ''}${marker}`);
    }
    if ((this.session?.reviewComments || []).length) {
      this.outputChannel.appendLine('');
      this.outputChannel.appendLine('Feedback enviado a agentes:');
      for (const comment of this.session.reviewComments) {
        this.outputChannel.appendLine(`${comment.at} · ${comment.agentLabel} · ${comment.relativePath}`);
        this.outputChannel.appendLine(`  ${comment.annotation}`);
      }
    }
    this.outputChannel.show(true);
  }

  async fullRefresh(showMessage = false) {
    if (!this.session?.active) {
      if (showMessage) vscode.window.showInformationMessage('No hay una sesión de revisión activa.');
      return;
    }
    if (this.session.paused) {
      if (showMessage) vscode.window.showInformationMessage('El seguimiento está pausado. Reanúdalo para actualizar los bloques.');
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Actualizando cambios…' },
      async () => {
        if (this.session.baselineMode === 'git-fast' || this.session.baselineMode === 'hybrid') {
          await this.fullRefreshGitFast();
        } else {
          await this.fullRefreshSnapshot();
        }
      }
    );

    await this.updateUi();
    if (showMessage) vscode.window.showInformationMessage(`${this.changes.size} archivo(s) con cambios pendientes.`);
  }

  async fullRefreshGitFast() {
    const candidateUris = new Map();
    const addUri = (uri) => {
      if (uri?.scheme === 'file' && !this.shouldIgnore(uri)) candidateUris.set(uri.toString(), uri);
    };

    for (const repo of this.session?.git?.repos || []) {
      if (!repo.baselineCommit) continue;
      try {
        const paths = await this.gitVersioning.getChangedFilesAgainstCommit({
          repoRoot: repo.repoRoot,
          commit: repo.baselineCommit,
          tempRoot: this.context.globalStorageUri.fsPath,
          sessionId: this.session.id
        });
        for (const gitPath of paths) {
          const uri = vscode.Uri.file(path.join(repo.repoRoot, ...gitPath.split('/')));
          if (this.locate(uri)) addUri(uri);
        }
      } catch (error) {
        this.log(`Refresh Git rápido falló en ${repo.repoRoot}: ${asMessage(error)}`);
      }
    }

    // Baselines aceptados durante la sesión pueden diferir del checkpoint inicial.
    for (const baseline of this.baseline.values()) {
      if (baseline.snapshot) addUri(this.uriFromBaseline(baseline));
    }
    for (const key of this.session?.baselineAbsentKeys || []) {
      const located = this.locateFromKey(key);
      if (located) addUri(located.uri);
    }
    for (const change of this.changes.values()) addUri(change.uri);
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === 'file' && document.isDirty) addUri(document.uri);
    }

    // En workspaces híbridos solo las carpetas fuera de Git requieren escaneo tradicional.
    if (this.session.baselineMode === 'hybrid') {
      const covered = new Set((this.session.git?.repos || []).flatMap((repo) => repo.workspaceFolders || []).map((value) => path.resolve(value)));
      const fallbackFolders = (vscode.workspace.workspaceFolders || []).filter((folder) => !covered.has(path.resolve(folder.uri.fsPath)));
      const config = this.getConfig();
      for (const folder of fallbackFolders) {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), config.excludeGlob, config.maxFiles);
        for (const uri of uris) addUri(uri);
      }
      for (const baseline of this.baseline.values()) {
        if (!covered.has(path.resolve(vscode.Uri.parse(baseline.rootUri).fsPath))) addUri(this.uriFromBaseline(baseline));
      }
    }

    this.changes.clear();
    this.hunkCache.clear();
    for (const uri of candidateUris.values()) {
      await this.refreshUri(uri, false);
      const located = this.locate(uri);
      if (!located) continue;
      const current = await this.readCurrent(uri);
      if (this.changes.has(located.key)) await this.updateHunkMeta(located, current).catch(() => {});
      else if (this.session?.hunkMeta) delete this.session.hunkMeta[located.key];
    }
  }

  async fullRefreshSnapshot() {
    const config = this.getConfig();
    const currentUris = await vscode.workspace.findFiles('**/*', config.excludeGlob, config.maxFiles);
    const currentByKey = new Map();

    for (const uri of currentUris) {
      if (this.shouldIgnore(uri)) continue;
      const located = this.locate(uri);
      if (!located) continue;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.File) currentByKey.set(located.key, { uri, stat, located });
      } catch {
        // Ignorar carreras con borrado.
      }
    }

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file' || !document.isDirty || this.shouldIgnore(document.uri)) continue;
      const located = this.locate(document.uri);
      if (located) currentByKey.set(located.key, { uri: document.uri, stat: undefined, located });
    }

    const keys = new Set([...this.baseline.keys(), ...currentByKey.keys()]);
    this.changes.clear();
    this.hunkCache.clear();

    for (const key of keys) {
      const baseline = this.baseline.get(key);
      const currentItem = currentByKey.get(key);
      const located = currentItem?.located || (baseline ? this.locateFromBaseline(baseline) : undefined);
      if (!located) continue;
      const current = currentItem
        ? await this.readCurrent(currentItem.uri, currentItem.stat)
        : { exists: false };
      const change = await determineChange(located, baseline, current);
      if (change) {
        this.changes.set(key, change);
        await this.updateHunkMeta(located, current).catch(() => {});
      } else if (this.session?.hunkMeta) {
        delete this.session.hunkMeta[key];
      }
    }
  }

  async readCurrent(uri, knownStat = undefined) {
    const dirtyDocument = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString() && document.isDirty
    );

    if (dirtyDocument) {
      const content = Buffer.from(dirtyDocument.getText(), 'utf8');
      const maxSize = this.getConfig().maxFileSizeBytes;
      return {
        exists: true,
        uri,
        stat: knownStat || { type: vscode.FileType.File, size: content.byteLength, mtime: Date.now(), ctime: 0 },
        hash: content.byteLength <= maxSize ? sha256(content) : undefined,
        reviewHash: content.byteLength <= maxSize ? reviewSha256(content) : undefined,
        content: content.byteLength <= maxSize ? content : undefined,
        restorableSize: content.byteLength <= maxSize,
        text: true
      };
    }

    try {
      const stat = knownStat || await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File) return { exists: false };
      const maxSize = this.getConfig().maxFileSizeBytes;
      if (stat.size > maxSize) {
        return { exists: true, uri, stat, hash: undefined, restorableSize: false, text: false };
      }
      const content = await vscode.workspace.fs.readFile(uri);
      const text = isProbablyText(content);
      return {
        exists: true,
        uri,
        stat,
        hash: sha256(content),
        reviewHash: text ? reviewSha256(content) : undefined,
        content,
        restorableSize: true,
        text
      };
    } catch (error) {
      if (isFileNotFound(error)) return { exists: false };
      throw error;
    }
  }

  async acceptFile(item) {
    const change = normalizeItem(item, this.changes);
    if (!change) return;
    const undo = await this.captureUndoState(change.uri, 'accept-file', `Aceptar archivo: ${change.relativePath}`);
    await this.acceptChange(change);
    this.recordDecision(undo, { action: 'accept', relativePath: change.relativePath, source: this.currentSource || 'manual' });
    await this.maybeDecisionCheckpoint(`Aceptado archivo: ${change.relativePath}`, 'accept-file');
    await this.persistSession();
    await this.updateUi();
  }

  async acceptChange(change) {
    const current = await this.readCurrent(change.uri);
    const old = this.baseline.get(change.key);
    if (old?.snapshot) await this.deleteStoragePath(old.snapshot);

    if (!current.exists) {
      this.baseline.delete(change.key);
      this.baselineContentCache.delete(change.key);
      this.markBaselineAbsent(change.key, true);
      this.changes.delete(change.key);
      this.hunkCache.delete(change.key);
      return;
    }

    const located = this.locate(change.uri);
    if (!located) return;
    if (current.content) {
      await this.setBaselineContent(located, current.content, current.stat);
    } else {
      this.markBaselineAbsent(change.key, false);
      this.baseline.set(change.key, this.makeLargeBaseline(located, current.stat));
    }
    this.changes.delete(change.key);
    this.hunkCache.delete(change.key);
  }

  async acceptAll(showMessage = true) {
    if (this.changes.size === 0) return true;
    for (const change of [...this.changes.values()]) await this.acceptChange(change);
    await this.maybeDecisionCheckpoint('Aceptados todos los cambios pendientes', 'accept-all');
    await this.persistSession();
    await this.updateUi();
    if (showMessage) vscode.window.showInformationMessage('Todos los cambios fueron aceptados.');
    return true;
  }

  async rejectFile(item) {
    const change = normalizeItem(item, this.changes);
    if (!change) return;

    if (this.getConfig().confirmReject) {
      const choice = await vscode.window.showWarningMessage(
        `¿Rechazar todos los bloques de “${change.relativePath}”?`,
        { modal: true },
        'Rechazar archivo'
      );
      if (choice !== 'Rechazar archivo') return;
    }

    try {
      const undo = await this.captureUndoState(change.uri, 'reject-file', `Rechazar archivo: ${change.relativePath}`);
      await this.rejectChange(change);
      this.recordDecision(undo, { action: 'reject', relativePath: change.relativePath, source: this.currentSource || 'manual' });
      await this.maybeDecisionCheckpoint(`Rechazado archivo: ${change.relativePath}`, 'reject-file');
      await this.persistSession();
      await this.updateUi();
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo restaurar el archivo: ${asMessage(error)}`);
    }
  }

  async rejectChange(change) {
    const located = this.locate(change.uri) || this.locateFromBaseline(this.baseline.get(change.key));
    const baseline = this.baseline.get(change.key) || (located ? await this.ensureBaselineForLocated(located) : undefined);

    if (!baseline) {
      await this.deleteCurrentFile(change.uri);
      this.changes.delete(change.key);
      this.hunkCache.delete(change.key);
      return;
    }

    if (!baseline.restorable) {
      throw new Error('El archivo supera el tamaño máximo de respaldo y no puede restaurarse automáticamente.');
    }

    const content = await this.readBaselineContent(baseline);
    const target = this.uriFromBaseline(baseline);
    await this.writeCurrentContent(target, content, baseline.text);
    this.changes.delete(change.key);
    this.hunkCache.delete(change.key);
  }

  async rejectAll(showMessage = true) {
    if (this.changes.size === 0) return true;
    if (this.getConfig().confirmReject) {
      const choice = await vscode.window.showWarningMessage(
        `¿Rechazar y restaurar ${this.changes.size} archivo(s)?`,
        { modal: true },
        'Rechazar todos'
      );
      if (choice !== 'Rechazar todos') return false;
    }

    const failures = [];
    for (const change of [...this.changes.values()]) {
      try {
        await this.rejectChange(change);
      } catch (error) {
        failures.push(`${change.relativePath}: ${asMessage(error)}`);
      }
    }
    await this.maybeDecisionCheckpoint('Rechazados todos los cambios pendientes', 'reject-all');
    await this.persistSession();
    await this.updateUi();

    if (failures.length) {
      vscode.window.showErrorMessage(`No se restauraron ${failures.length} archivo(s). Revisa el registro de salida.`);
      failures.forEach((failure) => this.log(failure));
      this.outputChannel?.show(true);
      return false;
    }
    if (showMessage) vscode.window.showInformationMessage('Todos los cambios fueron rechazados y restaurados.');
    return true;
  }

  async acceptHunk(descriptor) {
    if (!descriptor?.uri) return;
    try {
      const uri = vscode.Uri.parse(descriptor.uri);
      const context = await this.loadHunkContext(uri);
      const hunk = findHunk(context.hunks, descriptor);
      if (!hunk) {
        vscode.window.showWarningMessage('Ese bloque cambió mientras lo revisabas. Se actualizó la vista.');
        await this.refreshUri(uri);
        await this.updateUi();
        return;
      }

      const undo = await this.captureUndoState(uri, 'accept-hunk', `Aceptar bloque: ${context.located.relativePath}`);
      const change = this.changes.get(context.located.key);
      if ((change?.status === 'created' || change?.status === 'deleted') && context.hunks.length === 1) {
        await this.acceptChange(change);
      } else {
        const nextBaseline = acceptHunkIntoBaseline(context.originalText, context.currentText, hunk);
        await this.setBaselineContent(context.located, Buffer.from(nextBaseline, 'utf8'));
        await this.refreshUri(uri, false);
      }

      this.recordDecision(undo, {
        action: 'accept',
        relativePath: context.located.relativePath,
        hunk,
        source: this.originForHunk(context.located.key, hunk).id
      });
      await this.maybeDecisionCheckpoint(`Aceptado bloque: ${context.located.relativePath}`, 'accept-hunk');
      await this.persistSession();
      await this.updateUi();
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo aceptar el bloque: ${asMessage(error)}`);
    }
  }

  async acceptAndStageHunk(descriptor) {
    if (!descriptor?.uri) return;
    try {
      const uri = vscode.Uri.parse(descriptor.uri);
      const context = await this.loadHunkContext(uri);
      const hunk = findHunk(context.hunks, descriptor);
      if (!hunk) {
        vscode.window.showWarningMessage('Ese bloque cambió mientras lo revisabas. Se actualizó la vista.');
        await this.refreshUri(uri);
        await this.updateUi();
        return;
      }

      const desiredBaseline = acceptHunkIntoBaseline(context.originalText, context.currentText, hunk);
      const undo = await this.captureUndoState(uri, 'accept-stage-hunk', `Aceptar + Stage: ${context.located.relativePath}`);
      const stageResult = await this.gitStaging.stageContentSafely({
        filePath: uri.fsPath,
        baselineText: context.originalText,
        desiredText: desiredBaseline
      });
      undo.indexState = { repoRoot: stageResult.repoRoot, state: stageResult.before };

      const change = this.changes.get(context.located.key);
      if ((change?.status === 'created' || change?.status === 'deleted') && context.hunks.length === 1) {
        await this.acceptChange(change);
      } else {
        await this.setBaselineContent(context.located, Buffer.from(desiredBaseline, 'utf8'));
        await this.refreshUri(uri, false);
      }

      this.recordDecision(undo, {
        action: 'accept-stage',
        relativePath: context.located.relativePath,
        hunk,
        source: this.originForHunk(context.located.key, hunk).id
      });
      this.session.stats.staged += 1;
      await this.maybeDecisionCheckpoint(`Aceptado + staged bloque: ${context.located.relativePath}`, 'accept-stage-hunk');
      await this.refreshGitOverview(false);
      await this.persistSession();
      await this.updateUi();
      vscode.window.showInformationMessage('Bloque aceptado y agregado al staging de Git.');
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo aceptar y stagear el bloque: ${asMessage(error)}`);
    }
  }

  async rejectHunk(descriptor) {
    if (!descriptor?.uri) return;
    try {
      const uri = vscode.Uri.parse(descriptor.uri);
      const context = await this.loadHunkContext(uri);
      const hunk = findHunk(context.hunks, descriptor);
      if (!hunk) {
        vscode.window.showWarningMessage('Ese bloque cambió mientras lo revisabas. Se actualizó la vista.');
        await this.refreshUri(uri);
        await this.updateUi();
        return;
      }

      const undo = await this.captureUndoState(uri, 'reject-hunk', `Rechazar bloque: ${context.located.relativePath}`);
      const nextCurrent = rejectHunkFromCurrent(context.originalText, context.currentText, hunk);
      if (!context.baselineExists && nextCurrent.length === 0) {
        await this.deleteCurrentFile(uri);
      } else {
        await this.writeCurrentContent(uri, Buffer.from(nextCurrent, 'utf8'), true);
      }

      await this.refreshUri(uri, false);
      this.recordDecision(undo, {
        action: 'reject',
        relativePath: context.located.relativePath,
        hunk,
        source: this.originForHunk(context.located.key, hunk).id
      });
      await this.maybeDecisionCheckpoint(`Rechazado bloque: ${context.located.relativePath}`, 'reject-hunk');
      await this.persistSession();
      await this.updateUi();
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo rechazar el bloque: ${asMessage(error)}`);
    }
  }

  async sendHunkToAgent(descriptor) {
    if (!descriptor?.uri) return;
    try {
      const uri = vscode.Uri.parse(descriptor.uri);
      const context = await this.loadHunkContext(uri);
      const hunk = findHunk(context.hunks, descriptor);
      if (!hunk) {
        vscode.window.showWarningMessage('Ese bloque cambió mientras lo preparabas. Se actualizó la vista.');
        await this.refreshUri(uri);
        await this.updateUi();
        return;
      }

      const config = this.getConfig();
      const annotation = await vscode.window.showInputBox({
        title: 'CodeBender · Pedir corrección',
        prompt: 'Escribe la anotación o instrucción que debe aplicar el agente a este bloque',
        placeHolder: 'Ej.: valida nulos aquí sin cambiar el resto de la función',
        ignoreFocusOut: true
      });
      if (annotation === undefined) return;

      const agentId = await this.pickAgent(config.agentDefault, config);
      if (!agentId) return;

      const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri.toString());
      const languageId = editor?.document.languageId || path.extname(context.located.relativePath).replace(/^\./, '');
      const contextPart = buildContextText({
        mode: config.agentContextMode,
        currentText: context.currentText,
        hunk,
        contextLines: config.agentContextLines,
        maxChars: config.agentMaxFragmentChars
      });
      const prompt = buildAgentPrompt({
        rootName: context.located.root.name,
        relativePath: context.located.relativePath,
        languageId,
        kind: hunk.kind,
        oldStart: hunk.oldStart,
        oldEnd: hunk.oldEnd,
        newStart: hunk.newStart,
        newEnd: hunk.newEnd,
        oldText: hunk.oldText,
        newText: hunk.newText,
        annotation,
        maxChars: config.agentMaxFragmentChars,
        contextText: contextPart.text,
        contextLabel: contextPart.label
      });

      const terminal = await this.resolveAgentTerminal(agentId, config);
      if (!terminal) return;
      terminal.show(false);
      // Send the whole multiline instruction as a single paste transaction.
      // Without bracketed paste, embedded newlines can be interpreted by
      // interactive agent CLIs as multiple independent submissions.
      terminal.sendText(encodeBracketedPaste(prompt), false);
      if (config.agentExecutePrompt) {
        terminal.sendText('\r', false);
      }

      const agent = agentDefinition(agentId, config.agentAdapters);
      const label = agent?.label || terminal.name;
      this.session.reviewComments = this.session.reviewComments || [];
      this.session.reviewComments.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        key: context.located.key,
        relativePath: context.located.relativePath,
        hunkSignature: hunk.signature,
        agentId,
        agentLabel: label,
        annotation
      });
      this.session.stats = normalizeStats(this.session.stats);
      this.session.stats.feedback += 1;
      this.currentSource = agentId === 'active' ? 'agent' : agentId;
      this.session.currentSource = this.currentSource;
      await this.persistSession();
      await this.updateUi();

      const suffix = config.agentExecutePrompt
        ? 'La instrucción fue enviada y ejecutada.'
        : 'La instrucción quedó escrita en la consola; revisa y presiona Enter para enviarla.';
      vscode.window.showInformationMessage(`Bloque enviado a ${label}. CodeBender marcará las siguientes ediciones como ${label} hasta que cambies el origen. ${suffix}`);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo enviar el bloque al agente: ${asMessage(error)}`);
    }
  }

  async pickAgent(defaultAgent, config = this.getConfig()) {
    const normalized = normalizeAgentId(defaultAgent, config.agentAdapters);
    if (normalized !== 'ask') return normalized;

    const choices = allAgentDefinitions(config.agentAdapters).map((agent) => ({
      label: `${agent.icon || '$(terminal)'} ${agent.label}`,
      description: agent.id === 'active' ? 'Usar la terminal integrada activa' : `Enviar a ${agent.label}`,
      id: agent.id
    }));
    const picked = await vscode.window.showQuickPick(choices, {
      title: '¿A qué agente quieres enviar este bloque?',
      placeHolder: 'Selecciona un agente o una terminal',
      ignoreFocusOut: true
    });
    return picked?.id;
  }

  async resolveAgentTerminal(agentId, config) {
    if (agentId === 'active') {
      const active = vscode.window.activeTerminal;
      if (!active) vscode.window.showWarningMessage('No hay una terminal activa. Abre tu agente en la terminal integrada y vuelve a intentarlo.');
      return active;
    }

    const terminalDescriptors = vscode.window.terminals.map((terminal) => ({ name: terminal.name, terminal }));
    const match = findMatchingTerminal(terminalDescriptors, agentId, config.agentAdapters);
    if (match?.terminal) return match.terminal;

    const agent = agentDefinition(agentId, config.agentAdapters);
    if (!agent) return undefined;
    if (!config.agentAutoCreateTerminal) {
      vscode.window.showWarningMessage(`No encontré una terminal de ${agent.label}. Ábrela primero o activa “Crear terminal del agente automáticamente”.`);
      return undefined;
    }

    const command = this.agentLaunchCommand(agentId, config);
    if (!command) {
      vscode.window.showWarningMessage(`No hay un comando configurado para iniciar ${agent.label}.`);
      return undefined;
    }

    const terminal = vscode.window.createTerminal({ name: agent.label });
    terminal.show(false);
    terminal.sendText(command, true);
    await delay(config.agentStartupDelayMs);
    return terminal;
  }

  agentLaunchCommand(agentId, config) {
    const agent = agentDefinition(agentId, config.agentAdapters);
    if (agent?.custom) return agent.defaultCommand;
    if (agentId === 'claude') return config.agentClaudeCommand;
    if (agentId === 'kimi') return config.agentKimiCommand;
    if (agentId === 'codex') return config.agentCodexCommand;
    if (agentId === 'gemini') return config.agentGeminiCommand;
    if (agentId === 'opencode') return config.agentOpenCodeCommand;
    return agent?.defaultCommand || '';
  }

  async loadHunkContext(uri, document = undefined) {
    const located = this.locate(uri);
    if (!located) throw new Error('El archivo no pertenece al espacio de trabajo abierto.');
    const baseline = await this.ensureBaselineForLocated(located);
    if (baseline && (!baseline.restorable || !baseline.text)) {
      throw new Error('Este archivo no es texto revisable o supera el tamaño máximo permitido.');
    }

    const baselineBuffer = baseline
      ? await this.readBaselineContent(baseline)
      : Buffer.alloc(0);

    let current;
    if (document && document.isDirty) {
      const content = Buffer.from(document.getText(), 'utf8');
      current = { exists: true, content, text: true, hash: sha256(content), reviewHash: reviewSha256(content) };
    } else {
      current = await this.readCurrent(uri);
    }

    if (current.exists && (!current.content || !current.text)) {
      throw new Error('Este archivo no puede mostrarse como bloques de texto.');
    }

    const originalText = baselineBuffer.toString('utf8');
    const currentText = current.exists ? current.content.toString('utf8') : '';
    const maxInlineLines = this.getConfig().maxInlineLines;
    if (splitLines(originalText).length + splitLines(currentText).length > maxInlineLines * 2) {
      throw new Error(`El archivo supera el límite de ${maxInlineLines} líneas para revisión por bloques.`);
    }

    const baselineHash = reviewSha256(baselineBuffer);
    const currentHash = reviewSha256(Buffer.from(currentText, 'utf8'));
    const cached = this.hunkCache.get(located.key);
    let hunks;
    if (cached && cached.baselineHash === baselineHash && cached.currentHash === currentHash) {
      hunks = cached.hunks;
    } else {
      hunks = computeHunks(originalText, currentText);
      this.hunkCache.set(located.key, { baselineHash, currentHash, hunks });
    }

    return {
      located,
      baseline,
      baselineExists: Boolean(baseline),
      currentExists: current.exists,
      originalText,
      currentText,
      hunks
    };
  }

  async getHunksForDocument(document) {
    if (document.uri.scheme !== 'file' || this.shouldIgnore(document.uri)) return [];
    const located = this.locate(document.uri);
    // Regla fundamental de la sesión: las acciones inline solo existen para
    // archivos que CodeBender registró como CAMBIO NUEVO después del inicio.
    // Abrir/activar un archivo por sí solo nunca debe producir Accept/Reject.
    if (!located || !shouldExposeInlineReview({
      active: this.session?.active,
      paused: this.session?.paused,
      trackedChange: this.changes.has(located.key)
    })) return [];
    try {
      const context = await this.loadHunkContext(document.uri, document);
      return context.hunks.map((hunk, index) => ({
        ...hunk,
        index,
        total: context.hunks.length,
        key: context.located.key,
        uri: document.uri.toString(),
        relativePath: context.located.relativePath,
        origin: this.originForHunk(context.located.key, hunk)
      }));
    } catch {
      return [];
    }
  }

  async decorateVisibleEditors() {
    const generation = ++this.decorationGeneration;
    const enabled = Boolean(this.session?.active && !this.session.paused && this.getConfig().inlineReviewEnabled);

    await Promise.all(vscode.window.visibleTextEditors.map(async (editor) => {
      this.clearEditorDecorations(editor);
      if (!enabled || editor.document.uri.scheme !== 'file' || this.shouldIgnore(editor.document.uri)) return;

      const hunks = await this.getHunksForDocument(editor.document);
      if (generation !== this.decorationGeneration) return;

      const addedBodies = [];
      const modifiedBodies = [];
      const deletedBodies = [];
      const addedMarkers = [];
      const modifiedMarkers = [];
      const deletedMarkers = [];

      for (const hunk of hunks) {
        const bodyRange = rangeForHunk(editor.document, hunk);
        const markerRange = markerRangeForHunk(editor.document, hunk);
        const hoverMessage = buildHunkHover(editor.document, hunk);
        const bodyOption = { range: bodyRange, hoverMessage };
        const markerOption = { range: markerRange, hoverMessage };

        if (hunk.kind === 'added') {
          addedBodies.push(bodyOption);
          addedMarkers.push(markerOption);
        } else if (hunk.kind === 'deleted') {
          deletedBodies.push({
            ...bodyOption,
            renderOptions: {
              after: {
                contentText: `  ⟵ ${lineCount(hunk.oldText)} línea(s) eliminada(s)`,
                color: new vscode.ThemeColor('editorGutter.deletedBackground'),
                fontStyle: 'italic',
                margin: '0 0 0 1.5em'
              }
            }
          });
          deletedMarkers.push(markerOption);
        } else {
          modifiedBodies.push(bodyOption);
          modifiedMarkers.push(markerOption);
        }
      }

      editor.setDecorations(this.addedBodyDecoration, addedBodies);
      editor.setDecorations(this.modifiedBodyDecoration, modifiedBodies);
      editor.setDecorations(this.deletedBodyDecoration, deletedBodies);
      editor.setDecorations(this.addedMarkerDecoration, addedMarkers);
      editor.setDecorations(this.modifiedMarkerDecoration, modifiedMarkers);
      editor.setDecorations(this.deletedMarkerDecoration, deletedMarkers);
    }));
  }

  clearEditorDecorations(editor) {
    editor.setDecorations(this.addedBodyDecoration, []);
    editor.setDecorations(this.modifiedBodyDecoration, []);
    editor.setDecorations(this.deletedBodyDecoration, []);
    editor.setDecorations(this.addedMarkerDecoration, []);
    editor.setDecorations(this.modifiedMarkerDecoration, []);
    editor.setDecorations(this.deletedMarkerDecoration, []);
  }

  async discoverGitRepositories(folders = vscode.workspace.workspaceFolders || [], options = {}) {
    const config = this.getConfig();
    if (!config.gitEnabled) return { enabled: false, available: false, repos: [], reason: 'disabled' };

    const available = await this.gitVersioning.isAvailable();
    if (!available) return { enabled: true, available: false, repos: [], reason: 'git-not-found' };

    const reposByRoot = new Map();
    for (const folder of folders) {
      const repoRoot = await this.gitVersioning.findRepoRoot(folder.uri.fsPath);
      if (!repoRoot) continue;
      const normalized = path.resolve(repoRoot);
      if (!reposByRoot.has(normalized)) {
        reposByRoot.set(normalized, {
          repoRoot: normalized,
          workspaceFolders: []
        });
      }
      reposByRoot.get(normalized).workspaceFolders.push(folder.uri.fsPath);
    }

    for (const repo of reposByRoot.values()) {
      repo.branch = await this.gitVersioning.getBranch(repo.repoRoot);
      repo.head = await this.gitVersioning.getHead(repo.repoRoot);
      repo.status = await this.gitVersioning.getStatus(repo.repoRoot).catch(() => ({ clean: false, total: 0 }));
      repo.history = options.includeHistory === false
        ? []
        : await this.gitVersioning.getRecentCommits(repo.repoRoot, config.gitHistoryLimit);
    }

    return {
      enabled: true,
      available: reposByRoot.size > 0,
      repos: [...reposByRoot.values()],
      reason: reposByRoot.size ? undefined : 'no-repository'
    };
  }

  async refreshGitOverview(showMessage = true) {
    const overview = await this.discoverGitRepositories();
    this.gitOverview = overview;

    if (this.session?.git) {
      const oldByRoot = new Map((this.session.git.repos || []).map((repo) => [path.resolve(repo.repoRoot), repo]));
      this.session.git.enabled = overview.enabled;
      this.session.git.available = overview.available;
      this.session.git.reason = overview.reason;
      this.session.git.repos = overview.repos.map((repo) => ({
        ...repo,
        lastCheckpointCommit: oldByRoot.get(path.resolve(repo.repoRoot))?.lastCheckpointCommit,
        baselineCommit: oldByRoot.get(path.resolve(repo.repoRoot))?.baselineCommit
      }));
      if (this.session.active) await this.persistSession();
    }

    await this.updateUi();
    if (showMessage) {
      if (!overview.enabled) vscode.window.showInformationMessage('La integración Git está desactivada en Settings.');
      else if (overview.reason === 'git-not-found') vscode.window.showWarningMessage('No se encontró Git en PATH.');
      else if (!overview.available) vscode.window.showWarningMessage('No se encontró un repositorio Git en las carpetas abiertas.');
      else {
        const summary = overview.repos.map((repo) => {
          const status = repo.status?.clean ? 'limpio' : `${repo.status?.total || 0} cambio(s)`;
          return `${path.basename(repo.repoRoot)} · ${repo.branch} · ${status}`;
        }).join(' | ');
        vscode.window.showInformationMessage(`Git actualizado: ${summary}`);
      }
    }
  }

  async initializeGitSession(folders, options = {}) {
    const overview = await this.discoverGitRepositories(folders, { includeHistory: false });
    this.gitOverview = overview;
    if (!this.session) return;

    this.session.git = {
      enabled: overview.enabled,
      available: overview.available,
      reason: overview.reason,
      repos: overview.repos,
      checkpoints: [],
      sequence: 0
    };

    if (!overview.enabled) return;
    if (overview.reason === 'git-not-found') {
      this.log('Git no está disponible en PATH. La revisión por bloques seguirá funcionando sin checkpoints Git.');
      return;
    }
    if (!overview.available) {
      this.log('No se encontró un repositorio Git. Los cambios inline funcionan, pero no se crearán checkpoints.');
      return;
    }

    if (!options.fast) {
      await this.createGitCheckpointInternal('Inicio de sesión de revisión', 'session-start');
      return;
    }

    // Ruta ultrarrápida: un repositorio limpio ya tiene una copia base perfecta en HEAD.
    // Solo los repositorios con cambios previos necesitan materializar un checkpoint temporal.
    const sequence = 1;
    const checkpoint = {
      id: `${this.session.id}-${sequence}`,
      sequence,
      at: new Date().toISOString(),
      label: 'Inicio de sesión de revisión',
      action: 'session-start',
      repos: []
    };

    for (const repo of this.session.git.repos) {
      if (repo.status?.clean && repo.head) {
        repo.baselineCommit = repo.head;
        repo.lastCheckpointCommit = repo.head;
        checkpoint.repos.push({
          repoRoot: repo.repoRoot,
          branch: repo.branch,
          commit: repo.head,
          ref: undefined,
          reusedHead: true
        });
        continue;
      }

      try {
        const result = await this.gitVersioning.createCheckpoint({
          repoRoot: repo.repoRoot,
          sessionId: this.session.id,
          sequence,
          label: '[CodeBender] Inicio de sesión de revisión',
          parentCommit: repo.head,
          tempRoot: this.context.globalStorageUri.fsPath
        });
        repo.baselineCommit = result.commit;
        repo.lastCheckpointCommit = result.commit;
        checkpoint.repos.push({
          repoRoot: repo.repoRoot,
          branch: repo.branch,
          commit: result.commit,
          ref: result.ref,
          reusedHead: false
        });
      } catch (error) {
        this.log(`No se pudo crear la base Git rápida en ${repo.repoRoot}: ${asMessage(error)}`);
      }
    }

    if (checkpoint.repos.length) {
      this.session.git.sequence = sequence;
      this.session.git.checkpoints.push(checkpoint);
    }

    const readyRepos = new Set(checkpoint.repos.map((item) => path.resolve(item.repoRoot)));
    this.session.git.repos = this.session.git.repos.filter((repo) => readyRepos.has(path.resolve(repo.repoRoot)));
    this.session.git.available = this.session.git.repos.length > 0;
  }

  async maybeDecisionCheckpoint(label, action) {
    if (!this.getConfig().gitCheckpointOnDecision) return;
    await this.createGitCheckpointInternal(label, action);
  }

  async createManualCheckpoint() {
    if (!this.session?.active) {
      vscode.window.showInformationMessage('Inicia una sesión de revisión antes de crear checkpoints.');
      return;
    }
    if (!this.session.git?.available) {
      vscode.window.showWarningMessage('No hay un repositorio Git disponible en este espacio de trabajo.');
      return;
    }
    const label = await vscode.window.showInputBox({
      title: 'Crear checkpoint Git',
      prompt: 'Nombre de esta versión',
      value: `Checkpoint manual ${this.session.git.sequence + 1}`,
      validateInput: (value) => value.trim() ? undefined : 'Escribe un nombre para el checkpoint.'
    });
    if (!label) return;
    const checkpoint = await this.createGitCheckpointInternal(label.trim(), 'manual');
    await this.persistSession();
    await this.updateUi();
    if (checkpoint) vscode.window.showInformationMessage(`Checkpoint creado: ${label.trim()}`);
  }

  async createGitCheckpointInternal(label, action) {
    const git = this.session?.git;
    if (!this.session?.active || !git?.available || !git.repos?.length) return undefined;

    const sequence = (git.sequence || 0) + 1;
    const checkpoint = {
      id: `${this.session.id}-${sequence}`,
      sequence,
      at: new Date().toISOString(),
      label,
      action,
      repos: []
    };

    for (const repo of git.repos) {
      try {
        const result = await this.gitVersioning.createCheckpoint({
          repoRoot: repo.repoRoot,
          sessionId: this.session.id,
          sequence,
          label: `[CodeBender] ${label}`,
          parentCommit: repo.lastCheckpointCommit,
          tempRoot: this.context.globalStorageUri.fsPath
        });
        repo.lastCheckpointCommit = result.commit;
        if (action === 'session-start') repo.baselineCommit = result.commit;
        checkpoint.repos.push({
          repoRoot: repo.repoRoot,
          branch: repo.branch,
          commit: result.commit,
          ref: result.ref
        });
      } catch (error) {
        this.log(`No se pudo crear checkpoint Git en ${repo.repoRoot}: ${asMessage(error)}`);
      }
    }

    if (!checkpoint.repos.length) return undefined;
    git.sequence = sequence;
    git.checkpoints.push(checkpoint);
    const max = this.getConfig().gitMaxCheckpoints;
    if (git.checkpoints.length > max) git.checkpoints.splice(0, git.checkpoints.length - max);
    return checkpoint;
  }

  currentGitRepos() {
    return this.session?.git?.repos?.length ? this.session.git.repos : (this.gitOverview?.repos || []);
  }

  async showGitHistory() {
    await this.refreshGitOverview(false);
    const checkpoints = this.session?.git?.checkpoints || [];
    const items = checkpoints.slice().reverse().map((checkpoint) => ({
      label: `$(archive) Checkpoint ${String(checkpoint.sequence).padStart(3, '0')} · ${checkpoint.label}`,
      description: formatCheckpointTime(checkpoint.at),
      detail: checkpoint.repos.map((repo) => `${path.basename(repo.repoRoot)} ${repo.commit.slice(0, 10)}`).join(' · '),
      kind: 'checkpoint',
      checkpoint
    }));

    for (const repo of this.currentGitRepos()) {
      for (const commit of repo.history || []) {
        items.push({
          label: `$(git-commit) ${commit.shortHash} · ${commit.subject}`,
          description: `${path.basename(repo.repoRoot)} · ${formatCheckpointTime(commit.date)}`,
          detail: `${commit.author} · ${repo.branch}`,
          kind: 'commit',
          commit: { ...commit, repoRoot: repo.repoRoot, branch: repo.branch }
        });
      }
    }

    if (!items.length) {
      vscode.window.showInformationMessage('No hay checkpoints ni commits Git disponibles.');
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Historial y versiones Git',
      placeHolder: 'Selecciona un checkpoint o commit para restaurar su contenido'
    });
    if (!picked) return;
    if (picked.kind === 'checkpoint') await this.restoreGitCheckpoint(picked.checkpoint);
    else await this.restoreGitCommit(picked.commit);
  }

  async ensureSessionForRestore() {
    if (this.session?.active) return true;
    const choice = await vscode.window.showWarningMessage(
      'Para hacer un rollback seguro se iniciará una sesión y se guardará primero el estado actual.',
      { modal: true },
      'Iniciar y continuar'
    );
    if (choice !== 'Iniciar y continuar') return false;
    await this.startSession();
    return Boolean(this.session?.active);
  }

  async restoreGitCheckpoint(item) {
    const checkpoint = normalizeCheckpoint(item, this.session?.git?.checkpoints || []);
    if (!checkpoint) return;
    if (!(await this.ensureSessionForRestore())) return;
    await this.restoreGitTarget({
      label: checkpoint.label,
      repos: checkpoint.repos.map((repo) => ({ repoRoot: repo.repoRoot, commit: repo.commit }))
    });
  }

  async restoreGitCommit(item) {
    const commit = normalizeGitCommit(item);
    if (!commit?.repoRoot || !commit.hash) return;
    if (!(await this.ensureSessionForRestore())) return;
    await this.restoreGitTarget({
      label: `${commit.shortHash || commit.hash.slice(0, 8)} · ${commit.subject || 'commit Git'}`,
      repos: [{ repoRoot: commit.repoRoot, commit: commit.hash }]
    });
  }

  async restoreGitTarget(target) {
    const choice = await vscode.window.showWarningMessage(
      `¿Restaurar el contenido a “${target.label}”? Se guardará primero un checkpoint de seguridad. HEAD, la rama y el staging real no cambiarán.`,
      { modal: true },
      'Restaurar versión'
    );
    if (choice !== 'Restaurar versión') return;

    const wasPaused = Boolean(this.session?.paused);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Restaurando ${target.label}…`, cancellable: false },
      async () => {
        const saved = await vscode.workspace.saveAll(false);
        if (!saved) throw new Error('No se pudieron guardar todos los documentos abiertos antes de restaurar.');
        await this.createGitCheckpointInternal(`Seguridad antes de restaurar: ${target.label}`, 'pre-restore');
        const failures = [];
        for (const repoState of target.repos) {
          try {
            await this.gitVersioning.restoreCheckpoint({
              repoRoot: repoState.repoRoot,
              commit: repoState.commit,
              tempRoot: this.context.globalStorageUri.fsPath
            });
          } catch (error) {
            failures.push(`${repoState.repoRoot}: ${asMessage(error)}`);
          }
        }
        if (failures.length) {
          failures.forEach((failure) => this.log(failure));
          throw new Error(`Falló la restauración en ${failures.length} repositorio(s).`);
        }
        if (wasPaused) this.session.paused = false;
        await this.createGitCheckpointInternal(`Restaurado: ${target.label}`, 'restore');
        await this.fullRefresh(false);
        if (wasPaused) {
          this.session.paused = true;
          this.stopWatchers();
        }
        await this.refreshGitOverview(false);
        await this.persistSession();
        await this.updateUi();
      }
    ).then(
      () => vscode.window.showInformationMessage(`Versión restaurada: ${target.label}`),
      (error) => vscode.window.showErrorMessage(`No se pudo restaurar la versión: ${asMessage(error)}`)
    );
  }

  async copyCheckpointHash(item) {
    const checkpoint = normalizeCheckpoint(item, this.session?.git?.checkpoints || []);
    if (!checkpoint) return;
    const text = checkpoint.repos
      .map((repo) => checkpoint.repos.length === 1 ? repo.commit : `${repo.repoRoot}: ${repo.commit}`)
      .join('\n');
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('Hash del checkpoint copiado.');
  }

  async copyGitCommitHash(item) {
    const commit = normalizeGitCommit(item);
    if (!commit?.hash) return;
    await vscode.env.clipboard.writeText(commit.hash);
    vscode.window.showInformationMessage('Hash del commit copiado.');
  }

  async descriptorForOnlyHunk(item) {
    const change = normalizeItem(item, this.changes);
    if (!change) return undefined;
    const context = await this.loadHunkContext(change.uri);
    if (context.hunks.length !== 1) {
      throw new Error(`Se esperaba un único bloque para ${change.relativePath}, pero se detectaron ${context.hunks.length}.`);
    }
    const hunk = context.hunks[0];
    return {
      id: hunk.id,
      signature: hunk.signature,
      newStart: hunk.newStart,
      uri: change.uri.toString(),
      key: change.key
    };
  }

  async acceptDeletedBlock(item) {
    try {
      const descriptor = await this.descriptorForOnlyHunk(item);
      if (descriptor) await this.acceptHunk(descriptor);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo aceptar el bloque eliminado: ${asMessage(error)}`);
    }
  }

  async acceptAndStageDeletedBlock(item) {
    try {
      const descriptor = await this.descriptorForOnlyHunk(item);
      if (descriptor) await this.acceptAndStageHunk(descriptor);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo aceptar y stagear el bloque eliminado: ${asMessage(error)}`);
    }
  }

  async rejectDeletedBlock(item) {
    try {
      const descriptor = await this.descriptorForOnlyHunk(item);
      if (descriptor) await this.rejectHunk(descriptor);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo rechazar el bloque eliminado: ${asMessage(error)}`);
    }
  }

  async openFile(item) {
    const change = normalizeItem(item, this.changes);
    if (!change) return;
    try {
      const stat = await vscode.workspace.fs.stat(change.uri);
      if (stat.type === vscode.FileType.File) {
        const document = await vscode.workspace.openTextDocument(change.uri);
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        const hunks = await this.getHunksForDocument(document);
        if (hunks.length) {
          const line = Math.min(hunks[0].newStart, Math.max(document.lineCount - 1, 0));
          const range = new vscode.Range(line, 0, line, 0);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
        return;
      }
    } catch {
      // Archivo eliminado: se mantiene disponible para restauración desde el panel.
    }
    vscode.window.showInformationMessage('El archivo fue eliminado. Su eliminación es un único bloque: usa Aceptar, Aceptar + Stage o Rechazar desde CodeBender.');
  }

  async writeCurrentContent(uri, content, text) {
    const parent = uri.with({ path: path.posix.dirname(uri.path) });
    await vscode.workspace.fs.createDirectory(parent);
    const document = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());

    if (text && document) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullDocumentRange(document), content.toString('utf8'));
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) throw new Error('VS Code no permitió aplicar la restauración en el editor.');
      await document.save();
    } else {
      await vscode.workspace.fs.writeFile(uri, content);
    }
  }

  async deleteCurrentFile(uri) {
    const document = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
    if (document?.isDirty) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullDocumentRange(document), '');
      await vscode.workspace.applyEdit(edit);
      await document.save();
    }
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }

  async loadPersistedSession() {
    const manifestUri = vscode.Uri.joinPath(this.context.globalStorageUri, MANIFEST_FILE);
    try {
      const raw = await vscode.workspace.fs.readFile(manifestUri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
      if (![5, MANIFEST_VERSION].includes(parsed.version) || !parsed.session?.active) return;
      this.session = parsed.session;
      this.session.stats = normalizeStats(this.session.stats);
      this.session.decisionHistory = this.session.decisionHistory || [];
      this.session.undoStack = this.session.undoStack || [];
      this.session.reviewComments = this.session.reviewComments || [];
      this.session.hunkMeta = this.session.hunkMeta || {};
      this.session.currentSource = this.session.currentSource || 'manual';
      this.currentSource = this.session.currentSource;
      this.baseline = new Map((parsed.baseline || []).map((entry) => [entry.key, entry]));
      if (!this.session.paused) {
        this.startWatchers();
        await this.fullRefresh(false);
      }
    } catch (error) {
      if (!isFileNotFound(error)) {
        vscode.window.showWarningMessage('No se pudo recuperar la sesión anterior de CodeBender.');
      }
    }
  }

  async persistSession() {
    if (!this.session?.active) return;
    const manifest = {
      version: MANIFEST_VERSION,
      session: this.session,
      baseline: [...this.baseline.values()]
    };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(this.context.globalStorageUri, MANIFEST_FILE),
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    );
  }

  async ensureStorageDirectories() {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, SNAPSHOT_DIR));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, UNDO_DIR));
  }

  async clearStorage() {
    try {
      await vscode.workspace.fs.delete(this.context.globalStorageUri, { recursive: true, useTrash: false });
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
    // Crear una sola vez antes de cualquier worker evita carreras ENOENT en vscode-userdata.
    await this.ensureStorageDirectories();
  }

  async deleteStoragePath(relativePath) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.context.globalStorageUri, relativePath), {
        recursive: false,
        useTrash: false
      });
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }

  locate(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return undefined;
    const relativePath = normalizePath(path.relative(folder.uri.fsPath, uri.fsPath));
    if (!relativePath || relativePath.startsWith('../')) return undefined;
    return {
      root: folder,
      relativePath,
      key: makeKey(folder.uri.toString(), relativePath),
      uri
    };
  }

  locateFromBaseline(entry) {
    const rootUri = vscode.Uri.parse(entry.rootUri);
    const uri = vscode.Uri.joinPath(rootUri, ...entry.relativePath.split('/'));
    return {
      root: { name: entry.rootName, uri: rootUri },
      relativePath: entry.relativePath,
      key: entry.key,
      uri
    };
  }

  locateFromKey(key) {
    const marker = key.lastIndexOf('::');
    if (marker < 0) return undefined;
    const rootUri = vscode.Uri.parse(key.slice(0, marker));
    const relativePath = key.slice(marker + 2);
    const folder = (vscode.workspace.workspaceFolders || []).find((item) => item.uri.toString() === rootUri.toString());
    if (!folder || !relativePath) return undefined;
    return {
      root: folder,
      relativePath,
      key,
      uri: vscode.Uri.joinPath(rootUri, ...relativePath.split('/'))
    };
  }

  uriFromBaseline(entry) {
    return vscode.Uri.joinPath(vscode.Uri.parse(entry.rootUri), ...entry.relativePath.split('/'));
  }

  shouldIgnore(uri) {
    const located = this.locate(uri);
    if (!located) return true;
    const ignored = new Set([
      '.git', 'node_modules', '.next', 'dist', 'build', 'out', 'target', 'vendor',
      '.venv', 'venv', '__pycache__', 'coverage'
    ]);
    return located.relativePath.split('/').some((part) => ignored.has(part));
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration('codeBender');
    const legacy = vscode.workspace.getConfiguration('claudeChangeReview');
    const read = (key, fallback) => {
      const info = config.inspect(key);
      const explicitlySet = info && [info.workspaceFolderValue, info.workspaceValue, info.globalValue].some((value) => value !== undefined);
      if (explicitlySet) return config.get(key, fallback);
      const legacyInfo = legacy.inspect(key);
      const legacySet = legacyInfo && [legacyInfo.workspaceFolderValue, legacyInfo.workspaceValue, legacyInfo.globalValue].some((value) => value !== undefined);
      if (legacySet) return legacy.get(key, fallback);
      return config.get(key, fallback);
    };
    const maxFileSizeMB = read('maxFileSizeMB', 10);
    return {
      excludeGlob: read('excludeGlob', '**/{.git,node_modules,.next,dist,build,out,target,vendor,.venv,venv,__pycache__,coverage}/**'),
      maxFileSizeBytes: maxFileSizeMB * 1024 * 1024,
      maxFiles: read('maxFiles', 20000),
      confirmReject: read('confirmReject', true),
      inlineReviewEnabled: read('inlineReview.enabled', true),
      showCodeLens: read('inlineReview.showCodeLens', true),
      maxInlineLines: read('inlineReview.maxLines', 25000),
      explorerBadges: read('explorer.badges', true),
      gitEnabled: read('git.enabled', true),
      gitFastBaseline: read('git.fastBaseline', true),
      gitCheckpointOnDecision: read('git.checkpointOnDecision', false),
      gitMaxCheckpoints: read('git.maxCheckpoints', 100),
      gitHistoryLimit: read('git.historyLimit', 20),
      pauseConflictStrategy: read('pause.conflictStrategy', 'ask'),
      agentDefault: read('agent.default', 'ask'),
      agentAutoCreateTerminal: read('agent.autoCreateTerminal', false),
      agentExecutePrompt: read('agent.executePrompt', false),
      agentStartupDelayMs: read('agent.startupDelayMs', 1200),
      agentMaxFragmentChars: read('agent.maxFragmentChars', 12000),
      agentContextMode: read('agent.contextMode', 'block+context'),
      agentContextLines: read('agent.contextLines', 40),
      agentAdapters: read('agent.adapters', []),
      agentClaudeCommand: read('agent.claudeCommand', 'claude'),
      agentKimiCommand: read('agent.kimiCommand', 'kimi'),
      agentCodexCommand: read('agent.codexCommand', 'codex'),
      agentGeminiCommand: read('agent.geminiCommand', 'gemini'),
      agentOpenCodeCommand: read('agent.openCodeCommand', 'opencode')
    };
  }

  pendingHunkCount() {
    if (!this.session?.hunkMeta) return 0;
    let total = 0;
    for (const change of this.changes.values()) {
      const count = this.session.hunkMeta?.[change.key]?.hunks?.length || 0;
      total += count || 1;
    }
    return total;
  }

  async updateUi() {
    const active = Boolean(this.session?.active);
    const paused = Boolean(this.session?.paused);
    const pendingCount = paused ? (this.session?.pause?.pendingKeys?.length || this.changes.size) : this.changes.size;
    const hasChanges = pendingCount > 0;
    const gitState = this.session?.git?.available ? this.session.git : this.gitOverview;
    const gitAvailable = Boolean(gitState?.available && gitState?.repos?.length);
    const gitCheckpoints = this.session?.git?.checkpoints || [];
    const hasGitCheckpoints = gitCheckpoints.length > 0;
    for (const prefix of ['codeBender', 'claudeChangeReview', 'patchPilot']) {
      await vscode.commands.executeCommand('setContext', `${prefix}.sessionActive`, active);
      await vscode.commands.executeCommand('setContext', `${prefix}.sessionPaused`, paused);
      await vscode.commands.executeCommand('setContext', `${prefix}.hasChanges`, hasChanges);
      await vscode.commands.executeCommand('setContext', `${prefix}.gitAvailable`, gitAvailable);
      await vscode.commands.executeCommand('setContext', `${prefix}.hasGitCheckpoints`, hasGitCheckpoints);
    }

    const sorted = [...this.changes.values()]
      .map((change) => ({
        ...change,
        hunkCount: this.session?.hunkMeta?.[change.key]?.hunks?.length || 0
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    this.provider.setChanges(sorted);
    this.gitProvider.setData({
      repos: gitState?.repos || [],
      checkpoints: gitCheckpoints.slice().reverse(),
      active,
      paused
    });
    this.sessionProvider.setActive(active ? summarizeSession(this.session, pendingCount) : undefined);
    this.fileDecorationProvider.refresh(sorted.map((change) => change.uri));

    const pendingBlocks = this.pendingHunkCount();
    this.treeView.message = active
      ? paused
        ? `Seguimiento pausado · ${pendingBlocks || pendingCount} bloque(s) pendiente(s)`
        : `${pendingBlocks || pendingCount} bloque(s) · ${pendingCount} archivo(s)`
      : undefined;
    this.gitTreeView.message = gitAvailable
      ? `${gitState.repos.length} repositorio(s) · ${gitCheckpoints.length} checkpoint(s)`
      : 'Git no disponible o no hay repositorio en la carpeta abierta';

    if (active) {
      const source = this.currentSource || this.session?.currentSource || 'manual';
      const config = this.getConfig();
      const sourceLabel = source === 'manual' ? 'Manual' : (agentDefinition(source, config.agentAdapters)?.label || source);
      this.statusBar.text = paused
        ? `$(debug-pause) CodeBender pausado · clic para reanudar`
        : `$(git-compare) CodeBender: ${pendingCount} · ${sourceLabel}${gitAvailable ? ` · $(git-commit) ${gitCheckpoints.length}` : ''}`;
      this.statusBar.tooltip = paused
        ? 'El seguimiento está pausado. Los cambios actuales no se registran como bloques.'
        : `Seguimiento activo. Origen actual: ${sourceLabel}. Haz clic para pausarlo.`;
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }

    this.codeLensProvider.refresh();
    await this.decorateVisibleEditors();
  }

  log(message) {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('CodeBender');
      this.disposables.push(this.outputChannel);
    }
    this.outputChannel.appendLine(message);
  }

  dispose() {
    this.stopWatchers();
    for (const editor of vscode.window.visibleTextEditors) this.clearEditorDecorations(editor);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

class HunkCodeLensProvider {
  /** @param {ChangeReviewController} controller */
  constructor(controller) {
    this.controller = controller;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  async provideCodeLenses(document) {
    const config = this.controller.getConfig();
    if (!config.inlineReviewEnabled || !config.showCodeLens) return [];
    const hunks = await this.controller.getHunksForDocument(document);
    const lenses = [];

    for (const hunk of hunks) {
      const range = codeLensRangeForHunk(document, hunk);
      const descriptor = {
        id: hunk.id,
        signature: hunk.signature,
        newStart: hunk.newStart,
        uri: hunk.uri,
        key: hunk.key
      };
      const origin = hunk.origin || { kind: 'unknown', label: 'Origen desconocido' };
      const originIcon = origin.kind === 'manual' ? '$(person)' : origin.kind === 'mixed' ? '$(git-merge)' : '$(sparkle)';
      lenses.push(
        new vscode.CodeLens(range, {
          title: `${originIcon} ${origin.label} · ${hunk.index + 1}/${hunk.total}`,
          tooltip: 'Origen estimado del bloque. La atribución es best-effort y puede cambiarse desde CodeBender.',
          command: 'codeBender.setChangeSource'
        }),
        new vscode.CodeLens(range, {
          title: '$(check) Aceptar',
          tooltip: 'Conservar solamente este bloque de cambio',
          command: 'codeBender.acceptHunk',
          arguments: [descriptor]
        }),
        new vscode.CodeLens(range, {
          title: '$(git-commit) Aceptar + Stage',
          tooltip: 'Aceptar este bloque y agregar únicamente este contenido al staging de Git cuando sea seguro',
          command: 'codeBender.acceptAndStageHunk',
          arguments: [descriptor]
        }),
        new vscode.CodeLens(range, {
          title: '$(discard) Rechazar',
          tooltip: 'Restaurar únicamente este bloque al contenido original',
          command: 'codeBender.rejectHunk',
          arguments: [descriptor]
        }),
        new vscode.CodeLens(range, {
          title: '$(comment-discussion) Pedir corrección',
          tooltip: 'Añadir una anotación y devolver este bloque a Claude Code, Kimi Code, Codex, Gemini CLI, OpenCode o un CLI personalizado',
          command: 'codeBender.sendHunkToAgent',
          arguments: [descriptor]
        })
      );
    }
    return lenses;
  }

  dispose() {
    this.emitter.dispose();
  }
}

class GitHistoryProvider {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.repos = [];
    this.checkpoints = [];
    this.active = false;
    this.paused = false;
  }

  setData({ repos = [], checkpoints = [], active = false, paused = false }) {
    this.repos = repos;
    this.checkpoints = checkpoints;
    this.active = active;
    this.paused = paused;
    this.emitter.fire(undefined);
  }

  getTreeItem(node) {
    if (node.type === 'repo') {
      const status = node.repo.status || {};
      const state = status.clean ? 'limpio' : `${status.total || 0} cambio(s)`;
      const item = new vscode.TreeItem(
        path.basename(node.repo.repoRoot),
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${node.repo.branch || '(sin rama)'} · ${state}`;
      item.tooltip = `${node.repo.repoRoot}\nRama: ${node.repo.branch}\nHEAD: ${node.repo.head || 'sin commits'}`;
      item.contextValue = 'codeBender.gitRepository';
      item.iconPath = new vscode.ThemeIcon('repo');
      return item;
    }
    if (node.type === 'status') {
      const s = node.status || {};
      const item = new vscode.TreeItem(
        s.clean ? 'Árbol de trabajo limpio' : `Estado: ${s.staged || 0} staged · ${s.modified || 0} modificados · ${s.untracked || 0} nuevos`,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon(s.clean ? 'pass-filled' : 'pulse');
      item.contextValue = 'codeBender.gitStatus';
      return item;
    }
    if (node.type === 'group') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }
    if (node.type === 'checkpoint') {
      const checkpoint = node.checkpoint;
      const item = new vscode.TreeItem(
        `${String(checkpoint.sequence).padStart(3, '0')} · ${checkpoint.label}`,
        vscode.TreeItemCollapsibleState.None
      );
      const repoState = checkpoint.repos.find((repo) => path.resolve(repo.repoRoot) === path.resolve(node.repoRoot));
      item.description = `${formatCheckpointTime(checkpoint.at)}${repoState ? ` · ${repoState.commit.slice(0, 8)}` : ''}`;
      item.tooltip = new vscode.MarkdownString(`**${checkpoint.label}**\n\n${formatCheckpointTime(checkpoint.at)}\n\nRestaurar no cambia HEAD, la rama ni el staging real.`);
      item.contextValue = 'codeBender.gitCheckpoint';
      item.iconPath = new vscode.ThemeIcon(checkpoint.action === 'session-start' ? 'record' : 'archive');
      item.command = { command: 'codeBender.restoreCheckpoint', title: 'Restaurar checkpoint', arguments: [checkpoint] };
      return item;
    }
    if (node.type === 'commit') {
      const commit = node.commit;
      const item = new vscode.TreeItem(`${commit.shortHash} · ${commit.subject}`, vscode.TreeItemCollapsibleState.None);
      item.description = formatCheckpointTime(commit.date);
      item.tooltip = new vscode.MarkdownString(`**${commit.subject}**\n\nAutor: ${commit.author}\n\nHash: \`${commit.hash}\`\n\nPulsa para restaurar el contenido de este commit sin mover la rama.`);
      item.contextValue = 'codeBender.gitCommit';
      item.iconPath = new vscode.ThemeIcon('git-commit');
      item.command = { command: 'codeBender.restoreGitCommit', title: 'Restaurar commit', arguments: [{ ...commit, repoRoot: node.repoRoot }] };
      return item;
    }
    return new vscode.TreeItem('Git');
  }

  getChildren(node) {
    if (!node) return this.repos.map((repo) => ({ type: 'repo', repo }));
    if (node.type === 'repo') {
      const repoRoot = node.repo.repoRoot;
      const checkpointNodes = this.checkpoints
        .filter((checkpoint) => checkpoint.repos?.some((repo) => path.resolve(repo.repoRoot) === path.resolve(repoRoot)))
        .map((checkpoint) => ({ type: 'checkpoint', checkpoint, repoRoot }));
      const commitNodes = (node.repo.history || []).map((commit) => ({ type: 'commit', commit, repoRoot }));
      const children = [{ type: 'status', status: node.repo.status }];
      if (checkpointNodes.length) children.push({ type: 'group', kind: 'checkpoints', label: `Checkpoints de revisión (${checkpointNodes.length})`, icon: 'archive', children: checkpointNodes });
      if (commitNodes.length) children.push({ type: 'group', kind: 'commits', label: `Historial Git (${commitNodes.length})`, icon: 'history', children: commitNodes });
      return children;
    }
    if (node.type === 'group') return node.children || [];
    return [];
  }

  dispose() {
    this.emitter.dispose();
  }
}

class ChangedFilesProvider {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    /** @type {ChangeEntry[]} */
    this.changes = [];
  }

  setChanges(changes) {
    this.changes = changes;
    this.emitter.fire(undefined);
  }

  getTreeItem(change) {
    const label = path.basename(change.relativePath);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    const blockText = `${change.hunkCount || 1} bloque(s)`;
    item.description = `${blockText} · ${statusLabel(change.status)} · ${change.relativePath}`;
    item.tooltip = new vscode.MarkdownString(
      `**${statusLabel(change.status)} · ${blockText}**\n\n${change.rootName}/${change.relativePath}\n\n` +
      'Usa ✓ para aceptar todos los bloques del archivo o ↶ para rechazarlos sin abrirlo. Abre el archivo cuando quieras decidir bloque por bloque con Aceptar, Aceptar + Stage, Rechazar o Pedir corrección.'
    );
    item.contextValue = change.status === 'deleted' ? 'codeBender.changeDeleted' : 'codeBender.change';
    item.resourceUri = change.uri;
    item.iconPath = new vscode.ThemeIcon(statusIcon(change.status));
    item.command = {
      command: 'codeBender.openFile',
      title: 'Abrir archivo',
      arguments: [change]
    };
    return item;
  }

  getChildren(element) {
    return element ? [] : this.changes;
  }

  dispose() {
    this.emitter.dispose();
  }
}


class SessionHistoryProvider {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.history = [];
    this.active = undefined;
  }

  setHistory(history) {
    this.history = Array.isArray(history) ? history : [];
    this.emitter.fire(undefined);
  }

  setActive(active) {
    this.active = active;
    this.emitter.fire(undefined);
  }

  getChildren(element) {
    if (element) return [];
    const rows = [];
    if (this.active) rows.push({ ...this.active, __active: true });
    rows.push(...this.history.map((item) => ({ ...item, __active: false })));
    return rows;
  }

  getTreeItem(summary) {
    const label = summary.__active ? 'Sesión actual' : formatSessionDate(summary.startedAt);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${summary.accepted || 0} ✓ · ${summary.rejected || 0} ↶ · ${summary.staged || 0} staged · ${summary.feedback || 0} feedback`;
    item.tooltip = new vscode.MarkdownString(
      `**${summary.__active ? 'Sesión actual' : 'Sesión finalizada'}**\n\n` +
      `Aceptados: ${summary.accepted || 0}\n\nRechazados: ${summary.rejected || 0}\n\nStaged: ${summary.staged || 0}\n\n` +
      `Feedback: ${summary.feedback || 0}\n\nUndo: ${summary.undone || 0}\n\nPendientes: ${summary.pendingFiles || 0}`
    );
    item.iconPath = new vscode.ThemeIcon(summary.__active ? 'record' : 'history');
    item.contextValue = summary.__active ? 'codeBender.activeSession' : 'codeBender.sessionHistory';
    return item;
  }

  dispose() { this.emitter.dispose(); }
}

class ChangeFileDecorationProvider {
  constructor(controller) {
    this.controller = controller;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this.emitter.event;
  }

  refresh() { this.emitter.fire(undefined); }

  provideFileDecoration(uri) {
    if (!this.controller.getConfig().explorerBadges) return undefined;
    const located = this.controller.locate(uri);
    if (!located) return undefined;
    const change = this.controller.changes.get(located.key);
    if (!change) return undefined;
    const meta = this.controller.session?.hunkMeta?.[located.key]?.hunks || [];
    const count = meta.length;
    const badge = count > 9 ? '9+' : count > 0 ? String(count) : '•';
    const status = change.status;
    const color = status === 'deleted'
      ? new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
      : status === 'created'
        ? new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        : new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
    return {
      badge,
      tooltip: `${count || 1} cambio(s) pendiente(s) en CodeBender`,
      color,
      propagate: false
    };
  }

  dispose() { this.emitter.dispose(); }
}

async function determineChange(located, baseline, current) {
  if (!baseline && !current.exists) return undefined;
  if (!baseline && current.exists) return makeChange(located, 'created', current.uri, true);
  if (baseline && !current.exists) return makeChange(located, 'deleted', located.uri, baseline.restorable);
  if (!baseline || !current.exists) return undefined;

  if (baseline.hash && current.hash && baseline.hash === current.hash) return undefined;
  // Un repositorio Git puede guardar LF y materializar CRLF en el working tree.
  // Para archivos de texto, diferencias puramente de EOL/BOM no son cambios de código.
  if (baseline.text && current.text && baseline.reviewHash && current.reviewHash && baseline.reviewHash === current.reviewHash) return undefined;
  if (!baseline.hash || !current.hash) {
    if (baseline.size === current.stat.size && baseline.mtime === current.stat.mtime) return undefined;
  }
  return makeChange(located, 'modified', current.uri, baseline.restorable);
}

function makeChange(located, status, uri, restorable) {
  return {
    key: located.key,
    rootName: located.root.name,
    rootUri: located.root.uri.toString(),
    relativePath: located.relativePath,
    uri,
    status,
    restorable
  };
}

function rangeForHunk(document, hunk) {
  if (hunk.newEnd > hunk.newStart) {
    const startLine = clampLine(document, hunk.newStart);
    const endLine = clampLine(document, hunk.newEnd - 1);
    return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).range.end.character);
  }
  const anchor = clampLine(document, hunk.newStart);
  return document.lineAt(anchor).range;
}

function markerRangeForHunk(document, hunk) {
  const line = clampLine(document, hunk.newStart);
  return new vscode.Range(line, 0, line, 0);
}

function codeLensRangeForHunk(document, hunk) {
  const line = clampLine(document, hunk.newStart);
  return new vscode.Range(line, 0, line, 0);
}

function clampLine(document, line) {
  return Math.min(Math.max(line, 0), Math.max(document.lineCount - 1, 0));
}

function fullDocumentRange(document) {
  return new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length));
}

function buildHunkHover(document, hunk) {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  markdown.appendMarkdown(`**Cambio ${hunk.index + 1} de ${hunk.total} · ${hunkKindLabel(hunk.kind)}**\n\n`);
  if (hunk.origin) markdown.appendMarkdown(`Origen estimado: **${hunk.origin.label}**\n\n`);
  if (hunk.oldText) {
    markdown.appendMarkdown('**Original**\n\n');
    markdown.appendCodeblock(limitPreview(hunk.oldText), document.languageId);
  }
  if (hunk.newText) {
    markdown.appendMarkdown('**Propuesto**\n\n');
    markdown.appendCodeblock(limitPreview(hunk.newText), document.languageId);
  }
  markdown.appendMarkdown('\nUsa **Aceptar**, **Aceptar + Stage**, **Rechazar** o **Pedir corrección** encima del cambio.');
  return markdown;
}

function limitPreview(text) {
  const max = 6000;
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

function lineCount(text) {
  return Math.max(splitLines(text).length, text ? 1 : 0);
}

function hunkKindLabel(kind) {
  if (kind === 'added') return 'Agregado';
  if (kind === 'deleted') return 'Eliminado';
  return 'Modificado';
}

function normalizeCheckpoint(item, checkpoints) {
  if (!item) return undefined;
  if (item.checkpoint) return normalizeCheckpoint(item.checkpoint, checkpoints);
  if (item.id) return checkpoints.find((checkpoint) => checkpoint.id === item.id) || item;
  return undefined;
}

function normalizeGitCommit(item) {
  if (!item) return undefined;
  if (item.commit) return normalizeGitCommit({ ...item.commit, repoRoot: item.repoRoot || item.commit.repoRoot });
  if (item.hash) return item;
  return undefined;
}

function formatCheckpointTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value || '');
  }
}

function formatSessionDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value || 'Sesión');
  }
}

function formatSessionSummary(summary) {
  return `CodeBender · ${summary.accepted || 0} aceptados · ${summary.rejected || 0} rechazados · ${summary.staged || 0} staged · ${summary.feedback || 0} feedback · ${summary.pendingFiles || 0} archivos pendientes`;
}

function normalizeItem(item, changes) {
  if (!item) return undefined;
  if (item.key && changes.has(item.key)) return changes.get(item.key);
  return undefined;
}

function statusLabel(status) {
  if (status === 'created') return 'Nuevo';
  if (status === 'deleted') return 'Eliminado';
  return 'Modificado';
}

function statusIcon(status) {
  if (status === 'created') return 'diff-added';
  if (status === 'deleted') return 'diff-removed';
  return 'edit';
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function reviewSha256(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '');
  return sha256(Buffer.from(canonicalizeTextForReview(text), 'utf8'));
}

function safeSnapshotName(key) {
  return `${crypto.createHash('sha256').update(key).digest('hex')}.bin`;
}

function makeKey(rootUri, relativePath) {
  return `${rootUri}::${normalizePath(relativePath)}`;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function isProbablyText(content) {
  if (content.byteLength === 0) return true;
  const sample = content.subarray(0, Math.min(content.byteLength, 8192));
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  const decoded = sample.toString('utf8');
  const replacementCount = [...decoded].filter((character) => character === '\uFFFD').length;
  return replacementCount / Math.max(decoded.length, 1) < 0.01;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function asMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isFileNotFound(error) {
  return error && (error.code === 'FileNotFound' || error.code === 'ENOENT');
}

async function mapWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

module.exports = { activate, deactivate, determineChange, makeKey, statusLabel };

/**
 * @typedef {Object} BaselineEntry
 * @property {string} key
 * @property {string} rootUri
 * @property {string} rootName
 * @property {string} relativePath
 * @property {boolean} existed
 * @property {number} size
 * @property {number} mtime
 * @property {string=} hash
 * @property {string=} snapshot
 * @property {boolean} restorable
 * @property {boolean} text
 */

/**
 * @typedef {Object} ChangeEntry
 * @property {string} key
 * @property {string} rootName
 * @property {string} rootUri
 * @property {string} relativePath
 * @property {vscode.Uri} uri
 * @property {'created'|'modified'|'deleted'} status
 * @property {boolean} restorable
 */
