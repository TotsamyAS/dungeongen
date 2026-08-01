const fallbackLocale = 'ru';
const editorAssetVersion = '20260801-11';
const defaultColorApplyDelayMs = 350;
const defaultCanonicalRenderDelayMs = 10000;
const defaultPreviewSizePixels = 48;
const defaultWorkingCopyIdleSaveMs = 15000;
const defaultWorkingCopyIntervalMs = 300000;
const cellSize = 64;
const canvasPadding = cellSize * 2;
const maxHistoryEntries = 20;
const structureTools = new Set(['wall', 'corridor', 'roundRoom', 'roomClass']);
const propTools = new Set([
	'coffin', 'dais', 'altar', 'fountain', 'column_round', 'column_square',
	'rock_small', 'rock_medium', 'rock_large'
]);
const layoutTools = new Set([
	'stairs_up', 'stairs_down', 'entrance', 'exit',
	'door_open', 'door_closed', 'door_locked', 'door_secret'
]);
const layoutObjectDefinitions = {
	door_open: ['doors', 'open'], door_closed: ['doors', 'closed'],
	door_locked: ['doors', 'locked'], door_secret: ['doors', 'secret'],
	stairs_up: ['stairs', 'up'], stairs_down: ['stairs', 'down'],
	entrance: ['exits', 'entrance'], exit: ['exits', 'exit']
};
const editingTools = new Set([...structureTools, ...propTools, ...layoutTools, 'waterBrush', 'eraser']);
const rotatableTools = new Set([...propTools, ...layoutTools]);
const fastModeStorageKey = 'dungeongen-fast-mode';
const defaultAppearance = {
	background: '#ffffff', shading: '#d0d2d5', floor: '#ffffff', shadow: '#d0d0d0',
	walls: '#000000', hatching: '#000000', grid: '#202020', water: '#505050', numbers: '#000000'
};
const templateColors = {
	background: '#f10101', shading: '#f20202', floor: '#f30303', shadow: '#f40404',
	walls: '#f50505', hatching: '#f60606', grid: '#f70707', water: '#f80808', numbers: '#f90909'
};
try {
	document.documentElement.dataset.theme =
		localStorage.getItem('dungeon-overlord-theme') === 'light' ? 'light' : 'dark';
} catch {
	document.documentElement.dataset.theme = 'dark';
}
const dictionaries = new Map();
let labels = {};
let hostState = { projects: [], selectedProjectId: null, storage: null };
let currentProject = null;
let currentProjectId = null;
let currentProjectName = '';
let currentImageUrl = '';
let pendingImageUrl = '';
let imageSwapSequence = 0;
let imageSwapPending = false;
let pendingImageSwapPromise = null;
let localStatus = '';
let generating = false;
let capability = '';
let scale = 1;
let panX = 0;
let panY = 0;
let pointerStart = null;
let editGesture = null;
let activePanel = 'projects';
let activeTool = 'wall';
let editing = false;
let undoStack = [];
let redoStack = [];
let pendingAppearanceSnapshot = null;
let appearanceUpdateTimer = null;
let canonicalRenderTimer = null;
let colorApplyDelayMs = defaultColorApplyDelayMs;
let canonicalRenderDelayMs = defaultCanonicalRenderDelayMs;
let previewSizePixels = defaultPreviewSizePixels;
let editTimeLogging = false;
let fitImageOnLoad = true;
let encoderWorker = null;
let encoderRequestId = 0;
let canonicalRenderSequence = 0;
let workingCopyIdleSaveMs = defaultWorkingCopyIdleSaveMs;
let workingCopyIntervalMs = defaultWorkingCopyIntervalMs;
let workingCopyDirty = false;
let checkpointTimer = null;
let checkpointPromise = null;
let periodicCheckpointTimer = null;
let pendingHostSaveRevision = null;
let draftDatabasePromise = null;
let fastMode = false;
let workspaceView = 'preview';
let objectRotation = 0;
let hoveredCell = null;
let colorPresets = [];
let paletteMenuOpen = false;
let editPreviewFrame = 0;
let queuedEditPreview = null;
let placementObjectId = '';
const placementIndexCache = { project: null, value: null };
const encoderRequests = new Map();
const pendingClassificationCells = new Set();
const editToolTooltip = document.createElement('div');
editToolTooltip.className = 'edit-tool-tooltip';
editToolTooltip.id = 'editToolTooltip';
editToolTooltip.setAttribute('role', 'tooltip');
editToolTooltip.hidden = true;
document.body.append(editToolTooltip);
try {
	fastMode = localStorage.getItem(fastModeStorageKey) === 'true';
	workspaceView = fastMode ? 'structure' : 'preview';
} catch {}

const elements = {
	canvas: document.getElementById('canvas'),
	mapSurface: document.getElementById('mapSurface'),
	structureMap: document.getElementById('structureMap'),
	mapImage: document.getElementById('mapImage'),
	mapImageBuffer: document.getElementById('mapImageBuffer'),
	structureOverlay: document.getElementById('structureOverlay'),
	editOverlay: document.getElementById('editOverlay'),
	emptyWorkspace: document.getElementById('emptyWorkspace'),
	loading: document.getElementById('loading'),
	loadingLabel: document.getElementById('loadingLabel'),
	projectTitle: document.getElementById('projectTitle'),
	statusText: document.getElementById('statusText'),
	projectList: document.getElementById('projectList'),
	storageMeter: document.getElementById('storageMeter'),
	storageUsed: document.getElementById('storageUsed'),
	storageAvailable: document.getElementById('storageAvailable'),
	createProjectForm: document.getElementById('createProjectForm'),
	newProjectName: document.getElementById('newProjectName'),
	openGeneration: document.getElementById('openGeneration'),
	editorSideFire: document.getElementById('editorSideFire'),
	generateButton: document.getElementById('generateButton'),
	exportButton: document.getElementById('exportButton'),
	backButton: document.getElementById('backButton'),
	themeToggle: document.getElementById('themeToggle'),
	undoEdit: document.getElementById('undoEdit'),
	redoEdit: document.getElementById('redoEdit'),
	editToolTitle: document.getElementById('editToolTitle'),
	editToolHint: document.getElementById('editToolHint'),
	editAreaShortcut: document.getElementById('editAreaShortcut'),
	stats: document.getElementById('stats'),
	sourceLink: document.getElementById('sourceLink'),
	zoomOut: document.getElementById('zoomOut'),
	zoomIn: document.getElementById('zoomIn'),
	fitMap: document.getElementById('fitMap'),
	zoomValue: document.getElementById('zoomValue'),
	workspaceTabs: document.getElementById('workspaceTabs'),
	structureTab: document.getElementById('structureTab'),
	previewTab: document.getElementById('previewTab'),
	fastMode: document.getElementById('fastMode'),
	palettePresetButton: document.getElementById('palettePresetButton'),
	palettePresetName: document.getElementById('palettePresetName'),
	palettePresetPreview: document.getElementById('palettePresetPreview'),
	palettePresetMenu: document.getElementById('palettePresetMenu'),
	fields: {
		size: document.getElementById('size'),
		symmetry: document.getElementById('symmetry'),
		cross: document.getElementById('cross'),
		pack: document.getElementById('pack'),
		roomSize: document.getElementById('roomSize'),
		water: document.getElementById('water'),
		seed: document.getElementById('seed'),
		roundRooms: document.getElementById('roundRooms'),
		halls: document.getElementById('halls'),
		showNumbers: document.getElementById('showNumbers')
	},
	colors: {
		background: document.getElementById('colorBackground'),
		floor: document.getElementById('colorFloor'),
		walls: document.getElementById('colorWalls'),
		hatching: document.getElementById('colorHatching'),
		shading: document.getElementById('colorShading'),
		shadow: document.getElementById('colorShadow'),
		grid: document.getElementById('colorGrid'),
		water: document.getElementById('colorWater'),
		numbers: document.getElementById('colorNumbers')
	}
};

function t(key, params = {}) {
	let value = labels[key] ?? key;
	for (const [name, replacement] of Object.entries(params)) {
		value = value.replaceAll(`{${name}}`, String(replacement));
	}
	return value;
}

function showEditToolTooltip(button) {
	const text = button.dataset.tooltip;
	if (!text) return;
	editToolTooltip.textContent = text;
	editToolTooltip.hidden = false;
	button.setAttribute('aria-describedby', editToolTooltip.id);
	const buttonBounds = button.getBoundingClientRect();
	const tooltipBounds = editToolTooltip.getBoundingClientRect();
	let left = buttonBounds.left + buttonBounds.width / 2 - tooltipBounds.width / 2;
	let top = buttonBounds.bottom + 8;
	left = Math.min(Math.max(8, left), window.innerWidth - tooltipBounds.width - 8);
	if (top + tooltipBounds.height > window.innerHeight - 8) top = buttonBounds.top - tooltipBounds.height - 8;
	editToolTooltip.style.left = `${Math.round(left)}px`;
	editToolTooltip.style.top = `${Math.round(Math.max(8, top))}px`;
}

function hideEditToolTooltip(button = null) {
	if (button?.getAttribute('aria-describedby') === editToolTooltip.id) button.removeAttribute('aria-describedby');
	editToolTooltip.hidden = true;
}

function normalizeTheme(value) {
	return value === 'light' ? 'light' : 'dark';
}

function renderThemeToggle() {
	const isLight = document.documentElement.dataset.theme === 'light';
	const actionLabel = t(isLight ? 'switchToDark' : 'switchToLight');
	elements.themeToggle.classList.toggle('light-active', isLight);
	elements.themeToggle.setAttribute('aria-pressed', String(isLight));
	elements.themeToggle.setAttribute('aria-label', actionLabel);
	elements.themeToggle.dataset.tooltip = actionLabel;
}

function applyTheme(theme, { persist = true } = {}) {
	const normalized = normalizeTheme(theme);
	document.documentElement.dataset.theme = normalized;
	if (persist) {
		try { localStorage.setItem('dungeon-overlord-theme', normalized); } catch {}
	}
	renderThemeToggle();
}

function toggleTheme() {
	const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
	applyTheme(theme);
	send('dungeongen:theme-change', { theme });
}

async function loadEditorConfig() {
	try {
		const response = await fetch(`/dungeon-editor/config.json?v=${editorAssetVersion}`, { cache: 'no-store' });
		if (!response.ok) return;
		const config = await response.json();
		const delay = Number(config?.colorApplyDelayMs);
		if (Number.isFinite(delay)) colorApplyDelayMs = Math.max(0, Math.min(5000, Math.round(delay)));
		const renderDelay = Number(config?.canonicalRenderDelayMs);
		if (Number.isFinite(renderDelay)) canonicalRenderDelayMs = Math.max(0, Math.min(60000, Math.round(renderDelay)));
		const previewSize = Number(config?.previewSizePixels);
		if (Number.isFinite(previewSize)) previewSizePixels = Math.max(32, Math.min(256, Math.round(previewSize)));
		editTimeLogging = config?.editTimeLogging === true;
		const idleSave = Number(config?.workingCopyIdleSaveMs);
		if (Number.isFinite(idleSave)) workingCopyIdleSaveMs = Math.max(1000, Math.min(300000, Math.round(idleSave)));
		const intervalSave = Number(config?.workingCopyIntervalMs);
		if (Number.isFinite(intervalSave)) workingCopyIntervalMs = Math.max(10000, Math.min(1800000, Math.round(intervalSave)));
	} catch {
		colorApplyDelayMs = defaultColorApplyDelayMs;
		canonicalRenderDelayMs = defaultCanonicalRenderDelayMs;
		previewSizePixels = defaultPreviewSizePixels;
		editTimeLogging = false;
		workingCopyIdleSaveMs = defaultWorkingCopyIdleSaveMs;
		workingCopyIntervalMs = defaultWorkingCopyIntervalMs;
	}
}

async function loadColorPresets() {
	try {
		const response = await fetch(`/dungeon-editor/palettes.json?v=${editorAssetVersion}`, { cache: 'no-store' });
		if (!response.ok) return;
		const value = await response.json();
		colorPresets = Array.isArray(value)
			? value.filter((preset) => preset && typeof preset.id === 'string' && preset.colors)
				.map((preset) => ({ ...preset, colors: normalizeAppearance(preset.colors) }))
			: [];
	} catch {
		colorPresets = [];
	}
}

async function loadLocale(locale) {
	const requested = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale) ? locale : fallbackLocale;
	if (!dictionaries.has(requested)) {
		const response = await fetch(
			`/dungeon-editor/i18n/${encodeURIComponent(requested)}.json?v=${editorAssetVersion}`,
			{ cache: 'no-store' }
		);
		dictionaries.set(requested, await response.json());
	}
	labels = dictionaries.get(requested) ?? dictionaries.get(fallbackLocale) ?? {};
	document.documentElement.lang = requested;
	document.title = t('productTitle');
	applyLabels();
	renderAll();
}

function applyLabels() {
	document.querySelectorAll('[data-label]').forEach((element) => {
		element.textContent = t(element.dataset.label);
	});
	document.querySelectorAll('[data-label-placeholder]').forEach((element) => {
		element.setAttribute('placeholder', t(element.dataset.labelPlaceholder));
	});
	document.querySelectorAll('[data-label-aria]').forEach((element) => {
		element.setAttribute('aria-label', t(element.dataset.labelAria));
	});
	const toolLabels = {
		projects: 'toolProjects', generation: 'toolGeneration', editing: 'toolEditing', colors: 'toolColors',
		export: 'toolExport', settings: 'toolSettings', about: 'toolAbout'
	};
	document.querySelectorAll('[data-tool-button]').forEach((button) => {
		const text = t(toolLabels[button.dataset.toolButton]);
		button.setAttribute('aria-label', text);
		button.dataset.tooltip = text;
	});
	document.querySelectorAll('[data-edit-tool]').forEach((button) => {
		const labelKey = button.querySelector('[data-label]')?.dataset.label;
		const text = t(labelKey ?? 'objectPlacementTitle');
		button.setAttribute('aria-label', text);
		button.dataset.tooltip = text;
	});
	setControlLabel(elements.backButton, t('back'));
	renderThemeToggle();
	setControlLabel(elements.zoomIn, t('zoomIn'));
	setControlLabel(elements.zoomOut, t('zoomOut'));
	setControlLabel(elements.fitMap, t('fit'));
	setControlLabel(elements.undoEdit, t('undo'));
	setControlLabel(elements.redoEdit, t('redo'));
	elements.createProjectForm.querySelector('button').setAttribute('aria-label', t('createProject'));
	renderColorPresetOptions();
	renderEditingTool();
}

function renderEditingTool() {
	const content = {
		wall: ['wallTitle', 'wallHint'],
		corridor: ['corridorTitle', 'corridorHint'],
		roundRoom: ['roundRoomTitle', 'roundRoomHint'],
		roomClass: ['roomClassTitle', 'roomClassHint'],
		waterBrush: ['waterBrushTitle', 'waterBrushHint'],
		eraser: ['eraserTitle', 'eraserHint']
	}[activeTool];
	const objectLabel = document.querySelector(`[data-edit-tool="${activeTool}"] [data-label]`)?.dataset.label;
	elements.editToolTitle.textContent = content ? t(content[0]) : t(objectLabel ?? 'objectPlacementTitle');
	elements.editToolHint.textContent = content
		? t(content[1])
		: t(activeTool.startsWith('door_') ? 'doorPlacementHint' : 'objectPlacementHint');
	elements.editAreaShortcut.textContent = rotatableTools.has(activeTool) ? t('rotationShortcut') : t('areaShortcut');
	elements.editAreaShortcut.hidden = !['wall', 'corridor', 'waterBrush'].includes(activeTool) && !rotatableTools.has(activeTool);
	document.querySelectorAll('[data-edit-tool]').forEach((button) => {
		const selected = button.dataset.editTool === activeTool;
		button.classList.toggle('active', selected);
		button.setAttribute('aria-pressed', String(selected));
	});
}

function renderSideFire() {
	const sparks = Array.from({ length: 78 }, (_, index) => ({
		x: `${4 + ((index * 47) % 93)}%`, y: `${(index * 11) % 19}%`,
		size: `${2 + ((index * 5) % 6)}px`, rotation: `${-34 + ((index * 29) % 69)}deg`,
		duration: `${3.4 + ((index * 13) % 47) / 10}s`, delay: `${-((index * 17) % 83) / 10}s`,
		drift: `${-34 + ((index * 31) % 69)}px`, rise: `${150 + ((index * 37) % 361)}px`
	}));
	for (const spark of sparks) {
		const element = document.createElement('i');
		element.className = 'game-side-spark';
		for (const [name, value] of Object.entries(spark)) element.style.setProperty(`--spark-${name}`, value);
		elements.editorSideFire.append(element);
	}
}

function setControlLabel(element, value) {
	element.setAttribute('aria-label', value);
	element.dataset.tooltip = value;
}

function send(type, payload = {}) {
	window.parent.postMessage({ type, ...payload }, '*');
}

function newEditRequestId() {
	return globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
		?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function logEditTime(requestId, stage, elapsedMs) {
	if (!editTimeLogging) return;
	console.info(`[EDIT-TIME] id=${requestId} stage=${stage} elapsed_ms=${elapsedMs.toFixed(2)}`);
}

function bytesToBase64(bytes) {
	let binary = '';
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return btoa(binary);
}

function utf8ToBase64(value) {
	return bytesToBase64(new TextEncoder().encode(value));
}

function base64ToUtf8(value) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return new TextDecoder().decode(bytes);
}

function getEncoderWorker() {
	if (encoderWorker || typeof Worker === 'undefined') return encoderWorker;
	try {
		encoderWorker = new Worker(`/dungeon-editor/encoder-worker.js?v=${editorAssetVersion}`);
		encoderWorker.addEventListener('message', (event) => {
			const pending = encoderRequests.get(event.data?.id);
			if (!pending) return;
			encoderRequests.delete(event.data.id);
			if (typeof event.data.base64 === 'string') pending.resolve(event.data.base64);
			else pending.reject(new Error('encodeFailed'));
		});
		encoderWorker.addEventListener('error', () => {
			for (const pending of encoderRequests.values()) pending.reject(new Error('encodeFailed'));
			encoderRequests.clear();
			encoderWorker?.terminate();
			encoderWorker = null;
		});
	} catch {
		encoderWorker = null;
	}
	return encoderWorker;
}

async function encodeProjectBase64(project) {
	const worker = getEncoderWorker();
	if (!worker) return utf8ToBase64(JSON.stringify(project));
	const id = ++encoderRequestId;
	try {
		return await new Promise((resolve, reject) => {
			encoderRequests.set(id, { resolve, reject });
			worker.postMessage({ id, project });
		});
	} catch {
		return utf8ToBase64(JSON.stringify(project));
	}
}

function formatBytes(value) {
	const bytes = Math.max(0, Number(value) || 0);
	if (bytes < 1024) return t('bytes', { value: bytes });
	if (bytes < 1024 ** 2) return t('kilobytes', { value: (bytes / 1024).toFixed(1) });
	if (bytes < 1024 ** 3) return t('megabytes', { value: (bytes / 1024 ** 2).toFixed(1) });
	return t('gigabytes', { value: (bytes / 1024 ** 3).toFixed(1) });
}

function statusLabel() {
	if (localStatus) return t(localStatus);
	if (hostState.errorCode) {
		return t({
			storageQuotaExceeded: 'errorStorageQuotaExceeded', projectTooLarge: 'errorProjectTooLarge',
			serviceUnavailable: 'errorServiceUnavailable', openFailed: 'errorOpenFailed', saveFailed: 'errorSaveFailed',
			exportFailed: 'errorExportFailed'
		}[hostState.errorCode] ?? 'errorGeneric');
	}
	return t({
		loadingProject: 'statusLoading', saving: 'statusSaving', saved: 'statusSaved',
		exporting: 'statusExporting', exported: 'statusExported'
	}[hostState.statusCode] ?? 'statusReady');
}

function normalizeAppearance(value) {
	const appearance = { ...defaultAppearance };
	for (const key of Object.keys(defaultAppearance)) {
		if (typeof value?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])) {
			appearance[key] = value[key].toLowerCase();
		}
	}
	return appearance;
}

function styledSvg(template, appearanceValue) {
	let svg = String(template ?? '');
	const appearance = normalizeAppearance(appearanceValue);
	for (const key of Object.keys(templateColors)) {
		svg = svg.replace(new RegExp(templateColors[key], 'gi'), appearance[key]);
	}
	return svg;
}

function writeAppearance(value) {
	const appearance = normalizeAppearance(value);
	for (const [key, input] of Object.entries(elements.colors)) input.value = appearance[key];
	syncColorPreset(appearance);
}

function readAppearance() {
	return Object.fromEntries(Object.entries(elements.colors).map(([key, input]) => [key, input.value]));
}

const palettePreviewKeys = ['background', 'floor', 'walls', 'hatching', 'water', 'numbers'];

function matchingColorPreset(value) {
	const appearance = normalizeAppearance(value);
	return colorPresets.find((preset) => Object.keys(defaultAppearance).every((key) => preset.colors[key] === appearance[key])) ?? null;
}

function fillPalettePreview(element, colors) {
	element.replaceChildren();
	for (const key of palettePreviewKeys) {
		const swatch = document.createElement('span');
		swatch.style.backgroundColor = colors[key];
		element.append(swatch);
	}
}

function syncColorPreset(value = readAppearance()) {
	if (!elements.palettePresetName || !elements.palettePresetPreview) return;
	const appearance = normalizeAppearance(value);
	const preset = matchingColorPreset(appearance);
	elements.palettePresetName.textContent = t(preset?.labelKey ?? 'paletteCustom');
	fillPalettePreview(elements.palettePresetPreview, preset?.colors ?? appearance);
	elements.palettePresetMenu?.querySelectorAll('[data-palette-id]').forEach((option) => {
		option.setAttribute('aria-selected', String(option.dataset.paletteId === preset?.id));
	});
}

function closeColorPresetMenu() {
	paletteMenuOpen = false;
	elements.palettePresetMenu.hidden = true;
	elements.palettePresetButton.setAttribute('aria-expanded', 'false');
}

function renderColorPresetOptions() {
	if (!elements.palettePresetMenu) return;
	elements.palettePresetMenu.replaceChildren();
	for (const preset of colorPresets) {
		const option = document.createElement('button');
		option.type = 'button';
		option.className = 'palette-option';
		option.dataset.paletteId = preset.id;
		option.setAttribute('role', 'option');
		const preview = document.createElement('span');
		preview.className = 'palette-preview';
		preview.setAttribute('aria-hidden', 'true');
		fillPalettePreview(preview, preset.colors);
		const name = document.createElement('strong');
		name.textContent = t(preset.labelKey);
		option.append(preview, name);
		option.addEventListener('click', () => {
			if (!currentProject?.structure) return;
			if (!pendingAppearanceSnapshot) pendingAppearanceSnapshot = cloneProject();
			writeAppearance(preset.colors);
			closeColorPresetMenu();
			void updateAppearance();
		});
		elements.palettePresetMenu.append(option);
	}
	syncColorPreset(currentProject?.appearance ?? defaultAppearance);
}

function cloneProject(project = currentProject) {
	if (!project) return null;
	const renderSvg = project.renderSvg ?? null;
	const withoutSvg = { ...project, renderSvg: null };
	const cloned = typeof structuredClone === 'function'
		? structuredClone(withoutSvg)
		: JSON.parse(JSON.stringify(withoutSvg));
	return { ...cloned, renderSvg };
}

function compactProject(project = currentProject) {
	if (!project) return null;
	const compact = { ...cloneProject(project), renderSvg: null };
	if (compact.structure) delete compact.structure.renderedFloorCells;
	return compact;
}

function projectForEdit(project = currentProject) {
	return project ? { ...project, renderSvg: null } : null;
}

function openDraftDatabase() {
	if (draftDatabasePromise) return draftDatabasePromise;
	draftDatabasePromise = new Promise((resolve, reject) => {
		const request = indexedDB.open('dungeongen-working-copies', 1);
		request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'projectId' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}).catch(() => null);
	return draftDatabasePromise;
}

async function draftTransaction(mode, action) {
	const database = await openDraftDatabase();
	if (!database) return null;
	return new Promise((resolve) => {
		const transaction = database.transaction('drafts', mode);
		const request = action(transaction.objectStore('drafts'));
		request.onsuccess = () => resolve(request.result ?? true);
		request.onerror = () => resolve(null);
	});
}

function persistWorkingDraft() {
	if (!currentProjectId || !currentProject) return Promise.resolve(null);
	return draftTransaction('readwrite', (store) => store.put({
		projectId: currentProjectId,
		clientRevision: Number(currentProject.clientRevision ?? 0),
		updatedAt: Date.now(),
		project: compactProject(currentProject)
	}));
}

function readWorkingDraft(projectId) {
	return draftTransaction('readonly', (store) => store.get(projectId));
}

function deleteWorkingDraft(projectId) {
	return draftTransaction('readwrite', (store) => store.delete(projectId));
}

function scheduleWorkingCopyCheckpoint() {
	if (checkpointTimer) clearTimeout(checkpointTimer);
	checkpointTimer = setTimeout(() => {
		checkpointTimer = null;
		void checkpointWorkingCopy();
	}, workingCopyIdleSaveMs);
}

function markWorkingCopyDirty() {
	workingCopyDirty = true;
	void persistWorkingDraft();
	scheduleWorkingCopyCheckpoint();
	if (!fastMode) scheduleCanonicalRender();
}

async function checkpointWorkingCopy() {
	if (!workingCopyDirty || !currentProjectId || !currentProject?.structure || !capability) return true;
	if (checkpointPromise) {
		await checkpointPromise;
		if (!workingCopyDirty) return true;
	}
	const projectId = currentProjectId;
	const clientRevision = Number(currentProject.clientRevision ?? 0);
	const snapshot = compactProject(currentProject);
	checkpointPromise = (async () => {
		try {
			const response = await fetch('/dungeon-editor/api/checkpoint', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Dungeongen-Capability': capability },
				body: JSON.stringify({ project: snapshot })
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'editFailed');
			if (currentProjectId !== projectId || Number(currentProject?.clientRevision ?? -1) !== clientRevision) return false;
			const renderSvg = currentProject.renderSvg;
			currentProject = { ...payload.project, renderSvg };
			pendingHostSaveRevision = clientRevision;
			localStatus = 'statusSaving';
			renderAll();
			const needsPreview = !hostState.projects?.find((project) => project.id === projectId)?.previewUrl;
			await autosaveCurrent(null, needsPreview);
			return true;
		} catch {
			if (currentProjectId === projectId) {
				localStatus = 'errorSaveFailed';
				renderAll();
				scheduleWorkingCopyCheckpoint();
			}
			return false;
		} finally {
			checkpointPromise = null;
		}
	})();
	return checkpointPromise;
}

function acknowledgeHostSave() {
	if (pendingHostSaveRevision == null || !currentProjectId) return;
	if (Number(currentProject?.clientRevision ?? -1) === pendingHostSaveRevision) {
		workingCopyDirty = false;
		pendingHostSaveRevision = null;
		if (checkpointTimer) clearTimeout(checkpointTimer);
		checkpointTimer = null;
		void deleteWorkingDraft(currentProjectId);
	} else {
		pendingHostSaveRevision = null;
		scheduleWorkingCopyCheckpoint();
	}
}

function resetHistory() {
	undoStack = [];
	redoStack = [];
	pendingAppearanceSnapshot = null;
}

function pushHistory(snapshot) {
	if (!snapshot) return;
	undoStack.push(snapshot);
	if (undoStack.length > maxHistoryEntries) undoStack.shift();
	redoStack = [];
}

function canEditMap() {
	return Boolean(
		currentProjectId && currentProject?.structure && currentProject.structure.objectsInitialized
		&& !generating && !editing
	);
}

function renderAll() {
	elements.projectTitle.textContent = currentProjectName || t('productTitle');
	elements.statusText.textContent = statusLabel();
	elements.sourceLink.href = hostState.sourceCodeURL || '#';
	elements.sourceLink.hidden = !hostState.sourceCodeURL;
	elements.generateButton.disabled = !currentProjectId || generating || Boolean(hostState.loading);
	elements.exportButton.disabled = !currentProject?.structure || generating || Boolean(hostState.exporting);
	elements.openGeneration.disabled = !currentProjectId;
	for (const input of Object.values(elements.colors)) input.disabled = !currentProject?.structure;
	elements.palettePresetButton.disabled = !currentProject?.structure || !colorPresets.length;
	document.querySelector('[data-tool-button="editing"]').disabled = !canEditMap();
	document.querySelectorAll('[data-edit-tool]').forEach((button) => { button.disabled = !canEditMap(); });
	elements.undoEdit.disabled = !undoStack.length || generating || editing;
	elements.redoEdit.disabled = !redoStack.length || generating || editing;
	elements.canvas.classList.toggle('editing', activePanel === 'editing' && canEditMap());
	elements.fastMode.checked = fastMode;
	renderEditingTool();
	renderThemeToggle();
	renderProjects();
	renderStorage();
	renderStats();
	renderStructureOverlay();
	renderWorkspace();
}

function renderStorage() {
	const storage = hostState.storage;
	elements.storageMeter.hidden = !storage;
	if (!storage) return;
	elements.storageUsed.textContent = t('storageUsed', { value: formatBytes(storage.usedBytes) });
	elements.storageAvailable.textContent = t('storageAvailable', { value: formatBytes(storage.availableBytes) });
	const percent = storage.limitBytes > 0 ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;
	const progress = elements.storageMeter.querySelector('.storage-progress');
	progress.setAttribute('aria-valuenow', String(Math.round(percent)));
	progress.querySelector('span').style.width = `${percent}%`;
}

function icon(name) {
	return `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
}

function renderProjects() {
	elements.projectList.replaceChildren();
	if (!hostState.projects?.length) {
		const empty = document.createElement('p');
		empty.className = 'project-empty';
		empty.textContent = t('noProjects');
		elements.projectList.append(empty);
		return;
	}
	for (const project of hostState.projects) {
		const card = document.createElement('article');
		card.className = `project-card${project.id === currentProjectId ? ' active' : ''}`;

		const preview = document.createElement('span');
		preview.className = 'project-preview';
		if (project.previewUrl) {
			const image = document.createElement('img');
			image.src = project.previewUrl;
			image.alt = '';
			image.loading = 'lazy';
			preview.append(image);
		}

		const open = document.createElement('button');
		open.className = 'project-open';
		open.type = 'button';
		const name = document.createElement('strong');
		name.textContent = project.name;
		const size = document.createElement('small');
		size.textContent = formatBytes(project.size);
		open.append(name, size);
		open.addEventListener('click', () => void checkpointWorkingCopy().then(() => {
			send('dungeongen:project-open', { projectId: project.id });
		}));

		const actions = document.createElement('div');
		actions.className = 'project-actions';
		const rename = document.createElement('button');
		rename.type = 'button';
		rename.innerHTML = icon('pencil');
		setControlLabel(rename, t('renameProject'));
		rename.addEventListener('click', () => {
			const next = window.prompt(t('renamePrompt'), project.name)?.trim();
			if (next && next !== project.name) send('dungeongen:project-rename', { projectId: project.id, name: next });
		});
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'danger';
		remove.innerHTML = icon('trash');
		setControlLabel(remove, t('deleteProject'));
		remove.addEventListener('click', () => {
			if (window.confirm(t('deleteConfirm', { name: project.name }))) {
				send('dungeongen:project-delete', { projectId: project.id });
			}
		});
		actions.append(rename, remove);
		card.append(preview, open, actions);
		elements.projectList.append(card);
	}
}

function renderStats() {
	elements.stats.replaceChildren();
	const stats = currentProject?.stats;
	if (!stats) return;
	for (const [label, value] of [
		['statRooms', stats.rooms], ['statPassages', stats.passages],
		['statDoors', stats.doors], ['statExits', stats.exits]
	]) {
		const card = document.createElement('div');
		card.className = 'stat-card';
		const caption = document.createElement('span');
		caption.textContent = t(label);
		const number = document.createElement('strong');
		number.textContent = String(value ?? 0);
		card.append(caption, number);
		elements.stats.append(card);
	}
}

function readParameters() {
	return {
		size: elements.fields.size.value,
		symmetry: elements.fields.symmetry.value,
		cross: elements.fields.cross.value,
		pack: elements.fields.pack.value,
		roomSize: elements.fields.roomSize.value,
		water: elements.fields.water.value,
		seed: elements.fields.seed.value.trim() || null,
		roundRooms: elements.fields.roundRooms.checked,
		halls: elements.fields.halls.checked,
		showNumbers: elements.fields.showNumbers.checked
	};
}

function writeParameters(parameters = {}) {
	for (const key of ['size', 'symmetry', 'cross', 'pack', 'roomSize', 'water']) {
		if (typeof parameters[key] === 'string') elements.fields[key].value = parameters[key];
	}
	elements.fields.seed.value = parameters.seed ?? '';
	elements.fields.roundRooms.checked = parameters.roundRooms === true;
	elements.fields.halls.checked = parameters.halls !== false;
	elements.fields.showNumbers.checked = parameters.showNumbers !== false;
}

function workspaceDimensions() {
	const mapBounds = currentProject?.structure?.mapBounds;
	if (!mapBounds) return { width: 1, height: 1 };
	return {
		width: (mapBounds[2] - mapBounds[0]) * cellSize + canvasPadding * 2,
		height: (mapBounds[3] - mapBounds[1]) * cellSize + canvasPadding * 2
	};
}

function activeMapElement() {
	return elements.structureMap.hasAttribute('hidden') ? elements.mapImage : elements.structureMap;
}

function mapPixel(cell) {
	const mapBounds = currentProject.structure.mapBounds;
	return [
		canvasPadding + (cell[0] - mapBounds[0]) * cellSize,
		canvasPadding + (cell[1] - mapBounds[1]) * cellSize
	];
}

function svgElement(name, attributes = {}) {
	const element = document.createElementNS('http://www.w3.org/2000/svg', name);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	return element;
}

function boundaryPath(cells) {
	const floor = new Set(cells.map(cellKey));
	let path = '';
	for (const cell of cells) {
		const [x, y] = mapPixel(cell);
		if (!floor.has(cellKey([cell[0], cell[1] - 1]))) path += `M${x} ${y}h${cellSize}`;
		if (!floor.has(cellKey([cell[0] + 1, cell[1]]))) path += `M${x + cellSize} ${y}v${cellSize}`;
		if (!floor.has(cellKey([cell[0], cell[1] + 1]))) path += `M${x + cellSize} ${y + cellSize}h-${cellSize}`;
		if (!floor.has(cellKey([cell[0] - 1, cell[1]]))) path += `M${x} ${y + cellSize}v-${cellSize}`;
	}
	return path;
}

function objectBounds(cells) {
	const points = cells?.length ? cells : [[0, 0]];
	const xs = points.map((cell) => cell[0]);
	const ys = points.map((cell) => cell[1]);
	const [x, y] = mapPixel([Math.min(...xs), Math.min(...ys)]);
	return {
		x, y,
		width: (Math.max(...xs) - Math.min(...xs) + 1) * cellSize,
		height: (Math.max(...ys) - Math.min(...ys) + 1) * cellSize
	};
}

function fnv1a32(value) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function xorshiftRandom(state) {
	let value = state.value || 0x6d2b79f5;
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	state.value = value >>> 0;
	return state.value / 0x100000000;
}

function defaultRockSize(type) {
	return { rock_small: .08, rock_medium: .135, rock_large: .21 }[type] ?? .135;
}

function rockShapePoints(object) {
	if (Array.isArray(object.shape) && object.shape.length >= 3) {
		return object.shape.map((point) => [Number(point[0]) * cellSize, Number(point[1]) * cellSize]);
	}
	const radius = Number(object.size) || defaultRockSize(object.type);
	const state = { value: fnv1a32(String(object.id ?? object.type)) };
	return Array.from({ length: 8 }, (_, index) => {
		const radiusVariation = (xorshiftRandom(state) * .8) - .4;
		const angleVariation = (xorshiftRandom(state) * .52) - .26;
		const angle = index * Math.PI / 4 + angleVariation;
		const value = radius * cellSize * (1 + radiusVariation);
		return [value * Math.cos(angle), value * Math.sin(angle)];
	});
}

function rockPath(points, cx, cy) {
	if (points.length < 3) return '';
	const midpoint = (left, right) => [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
	const first = midpoint(points[0], points[1]);
	let path = `M${cx + first[0]} ${cy + first[1]}`;
	for (let index = 1; index <= points.length; index += 1) {
		const current = points[index % points.length];
		const next = points[(index + 1) % points.length];
		const end = midpoint(current, next);
		path += `Q${cx + current[0]} ${cy + current[1]} ${cx + end[0]} ${cy + end[1]}`;
	}
	return `${path}Z`;
}

function polygonPath(points) {
	return `${points.map((point, index) => `${index ? 'L' : 'M'}${point[0]} ${point[1]}`).join('')}Z`;
}

function appendLightweightObject(parent, object, extraClass = '') {
	const bounds = objectBounds(object.cells);
	const appearance = normalizeAppearance(currentProject?.appearance);
	const fill = appearance.floor;
	const outline = appearance.walls;
	const light = appearance.shadow;
	const cx = bounds.x + bounds.width / 2;
	const cy = bounds.y + bounds.height / 2;
	const rotation = ((Number(object.rotation) || 0) % 4 + 4) % 4;
	const group = svgElement('g', {
		class: `structure-object structure-object-${object.type} ${extraClass}`.trim(),
		transform: `rotate(${rotation * 90} ${cx} ${cy})`,
		'data-object-id': object.id ?? ''
	});

	if (object.type.startsWith('column_')) {
		const shadowAttrs = object.type === 'column_round'
			? { cx: cx + 6, cy: cy + 8, r: cellSize / 6 + 3, fill: appearance.shadow, stroke: 'none' }
			: { x: cx - cellSize / 6 + 6 - 3, y: cy - cellSize / 6 + 8 - 3, width: cellSize / 3 + 6, height: cellSize / 3 + 6, fill: appearance.shadow, stroke: 'none' };
		const shapeAttrs = object.type === 'column_round'
			? { cx, cy, r: cellSize / 6, fill: light, stroke: outline, 'stroke-width': 6 }
			: { x: cx - cellSize / 6, y: cy - cellSize / 6, width: cellSize / 3, height: cellSize / 3, fill: light, stroke: outline, 'stroke-width': 6 };
		group.append(
			svgElement(object.type === 'column_round' ? 'circle' : 'rect', shadowAttrs),
			svgElement(object.type === 'column_round' ? 'circle' : 'rect', shapeAttrs)
		);
	} else if (object.type.startsWith('rock_')) {
		group.append(svgElement('path', {
			d: rockPath(rockShapePoints(object), cx, cy), fill, stroke: outline,
			'stroke-width': 2, 'stroke-linejoin': 'round'
		}));
	} else if (object.type === 'fountain') {
		const outerRadius = cellSize * .7;
		group.append(
			svgElement('circle', { cx, cy, r: outerRadius, fill, stroke: outline, 'stroke-width': 2 }),
			svgElement('circle', { cx, cy, r: outerRadius * .82, fill: '#e8eef2', stroke: outline, 'stroke-width': 1.5 }),
			svgElement('circle', { cx, cy, r: outerRadius * .25, fill, stroke: outline, 'stroke-width': 1 })
		);
	} else if (object.type === 'dais') {
		const outerRadius = cellSize * 1.5;
		const innerRadius = outerRadius * .75;
		const flatY = cy - cellSize;
		group.append(
			svgElement('path', {
				d: `M${cx + outerRadius} ${flatY}A${outerRadius} ${outerRadius} 0 0 1 ${cx - outerRadius} ${flatY}Z`,
				fill, stroke: outline, 'stroke-width': 2
			}),
			svgElement('path', {
				d: `M${cx + innerRadius} ${flatY}A${innerRadius} ${innerRadius} 0 0 1 ${cx - innerRadius} ${flatY}`,
				fill: 'none', stroke: outline, 'stroke-width': 2
			})
		);
	} else if (object.type === 'coffin') {
		const x = cx - bounds.width * .35;
		const y = cy - bounds.height * .45;
		const width = bounds.width * .7;
		const height = bounds.height * .9;
		const insetX = width * .1;
		const insetY = height * .1;
		const outer = [
			[x + width / 2, y], [x + width, y + height / 6], [x + width, y + height * .75],
			[x + width / 2, y + height], [x, y + height * .75], [x, y + height / 6]
		];
		const inner = [
			[x + width / 2, y + insetY], [x + width - insetX, y + height / 6 + insetY],
			[x + width - insetX, y + height * .75 - insetY], [x + width / 2, y + height - insetY],
			[x + insetX, y + height * .75 - insetY], [x + insetX, y + height / 6 + insetY]
		];
		group.append(
			svgElement('path', { d: polygonPath(outer), fill: 'none', stroke: outline, 'stroke-width': 2 }),
			svgElement('path', { d: polygonPath(inner), fill: 'none', stroke: outline, 'stroke-width': 1 })
		);
	} else if (object.type === 'altar') {
		const x = cx - cellSize * .35;
		const y = cy - cellSize * .35;
		const width = cellSize * .3;
		const height = cellSize * .7;
		const dotX = x + width / 2;
		const dotY = y + height / 2;
		group.append(
			svgElement('rect', { x, y, width, height, fill, stroke: outline, 'stroke-width': 2 }),
			svgElement('circle', { cx: dotX, cy: dotY - height * .25, r: cellSize * .04, fill: outline, stroke: 'none' }),
			svgElement('circle', { cx: dotX, cy: dotY + height * .25, r: cellSize * .04, fill: outline, stroke: 'none' })
		);
	}
	parent.append(group);
}

function layoutObjectType(collection, item) {
	if (collection === 'doors') return `door_${item.type ?? 'closed'}`;
	if (collection === 'stairs') return `stairs_${item.type ?? 'up'}`;
	return item.main || item.type === 'entrance' ? 'entrance' : 'exit';
}

function appendLightweightLayoutObject(parent, collection, item, extraClass = '') {
	const [x, y] = mapPixel([item.x, item.y]);
	const type = layoutObjectType(collection, item);
	const directionIndex = Math.max(0, ['north', 'east', 'south', 'west'].indexOf(item.direction));
	const cx = x + cellSize / 2;
	const cy = y + cellSize / 2;
	const group = svgElement('g', {
		class: `structure-object structure-layout-object structure-object-${type} ${extraClass}`.trim(),
		transform: `rotate(${directionIndex * 90} ${cx} ${cy})`,
		'data-object-id': item.id ?? ''
	});
	if (collection === 'doors') {
		// Open and secret doors do not draw an overlay in the canonical renderer.
		if (type === 'door_closed' || type === 'door_locked') {
			const appearance = normalizeAppearance(currentProject?.appearance);
			const eastWest = item.direction === 'east' || item.direction === 'west';
			const thickness = cellSize * (eastWest ? 1 / 6 : 1 / 5);
			group.append(svgElement('rect', {
				x: x - 1,
				y: cy - thickness / 2 - 1,
				width: cellSize + 2,
				height: thickness + 2,
				fill: appearance.floor,
				stroke: appearance.walls,
				'stroke-width': 4
			}));
		}
	} else if (collection === 'stairs') {
		const stepCount = 6;
		for (let index = 0; index < stepCount; index += 1) {
			const progress = index / (stepCount - 1);
			const widthRatio = 1 - progress * .85;
			const extension = progress < .5 ? cellSize * .03 * (1 - progress) : 0;
			const halfWidth = cellSize * widthRatio / 2 + extension;
			const stepY = y + cellSize * progress;
			group.append(svgElement('line', {
				x1: cx - halfWidth,
				y1: stepY,
				x2: cx + halfWidth,
				y2: stepY,
				stroke: '#000000',
				'stroke-width': 3,
				'stroke-linecap': 'butt'
			}));
		}
	} else {
		const width = cellSize * .58;
		const height = cellSize * .42;
		const left = cx - width / 2;
		const right = cx + width / 2;
		const shoulderY = cy - height * .55;
		const apexY = cy - height;
		const handleX = width * .28;
		const handleY = Math.abs(shoulderY - apexY) * .85;
		const skewAngle = item.direction === 'south' || item.direction === 'west' ? -12 : 12;
		const arch = svgElement('path', {
			d: [
				`M${left} ${cy}`,
				`L${right} ${cy}`,
				`L${right} ${shoulderY}`,
				`C${right} ${shoulderY - handleY} ${cx + handleX} ${apexY} ${cx} ${apexY}`,
				`C${cx - handleX} ${apexY} ${left} ${shoulderY - handleY} ${left} ${shoulderY}`,
				'Z'
			].join(''),
			fill: '#000000',
			stroke: 'none',
			transform: `translate(${cx} ${cy}) skewX(${skewAngle}) translate(${-cx} ${-cy})`
		});
		group.append(arch);
	}
	parent.append(group);
}

function renderLightweightMap() {
	const structure = currentProject?.structure;
	elements.structureMap.replaceChildren();
	if (!structure) return;
	const { width, height } = workspaceDimensions();
	elements.mapSurface.style.width = `${width}px`;
	elements.mapSurface.style.height = `${height}px`;
	elements.structureMap.setAttribute('viewBox', `0 0 ${width} ${height}`);
	elements.structureMap.setAttribute('width', String(width));
	elements.structureMap.setAttribute('height', String(height));
	const appearance = normalizeAppearance(currentProject.appearance);
	const floorCells = structure.floorCells ?? [];
	elements.structureMap.append(svgElement('rect', { class: 'structure-background', x: 0, y: 0, width, height, fill: appearance.background }));
	if (floorCells.length) {
		elements.structureMap.append(svgElement('path', {
			class: 'structure-floor', d: cellsPath(floorCells, structure.mapBounds),
			fill: appearance.floor, stroke: appearance.grid
		}));
	}
	if (structure.waterCells?.length) {
		elements.structureMap.append(svgElement('path', {
			class: 'structure-water', d: cellsPath(structure.waterCells, structure.mapBounds), fill: appearance.water
		}));
	}
	if (floorCells.length) elements.structureMap.append(svgElement('path', {
		class: 'structure-walls', d: boundaryPath(floorCells), stroke: appearance.walls
	}));
	for (const object of structure.objects ?? []) appendLightweightObject(elements.structureMap, object);
	for (const collection of ['doors', 'stairs', 'exits']) {
		for (const item of currentProject.layout?.[collection] ?? []) appendLightweightLayoutObject(elements.structureMap, collection, item);
	}
	if (currentProject.parameters?.showNumbers !== false) {
		for (const room of structure.rooms ?? []) {
			if (room.suppressed || !room.number || !room.cells?.length) continue;
			const centerX = room.cells.reduce((sum, cell) => sum + cell[0] + .5, 0) / room.cells.length;
			const centerY = room.cells.reduce((sum, cell) => sum + cell[1] + .5, 0) / room.cells.length;
			const [x, y] = mapPixel([centerX, centerY]);
			const number = svgElement('text', { class: 'structure-number', x, y, fill: appearance.numbers });
			number.textContent = String(room.number);
			elements.structureMap.append(number);
		}
	}
}

function renderWorkspace() {
	const hasReadyImage = Boolean(currentImageUrl && elements.mapImage.src);
	const structureActive = Boolean(
		currentProject?.structure && (
			(fastMode && workspaceView === 'structure')
			|| !hasReadyImage
		)
	);
	elements.workspaceTabs.hidden = !fastMode || !currentProject?.structure;
	elements.structureTab.classList.toggle('active', structureActive);
	elements.previewTab.classList.toggle('active', fastMode && workspaceView === 'preview');
	elements.structureTab.setAttribute('aria-selected', String(structureActive));
	elements.previewTab.setAttribute('aria-selected', String(fastMode && workspaceView === 'preview'));
	elements.structureMap.toggleAttribute('hidden', !structureActive);
	elements.mapImage.hidden = structureActive;
	elements.mapImageBuffer.hidden = true;
	elements.structureOverlay.toggleAttribute('hidden', structureActive);
	elements.mapSurface.classList.toggle('structure-view', structureActive);
	if (currentProject?.structure) elements.emptyWorkspace.hidden = true;
	if (structureActive) renderLightweightMap();
	else if (currentProject?.renderSvg && !elements.mapImage.src) setProjectImage(currentProject.renderSvg, false, true);
	syncEditOverlaySize();
}

function setProjectImage(svg, fitOnLoad = true, force = false, timing = null, appearance = currentProject?.appearance) {
	const operation = performProjectImageSwap(svg, fitOnLoad, force, timing, appearance);
	pendingImageSwapPromise = operation;
	void operation.finally(() => {
		if (pendingImageSwapPromise === operation) pendingImageSwapPromise = null;
	});
	return operation;
}

async function performProjectImageSwap(svg, fitOnLoad, force, timing, appearance) {
	if (!svg) {
		imageSwapSequence += 1;
		imageSwapPending = false;
		if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
		if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
		pendingImageUrl = '';
		currentImageUrl = '';
		elements.mapImage.removeAttribute('src');
		elements.mapImageBuffer.removeAttribute('src');
		elements.mapImageBuffer.hidden = true;
		renderEditPreview();
		elements.emptyWorkspace.hidden = false;
		return false;
	}
	if (fastMode && workspaceView === 'structure' && !force) {
		elements.emptyWorkspace.hidden = true;
		renderWorkspace();
		return false;
	}
	const sequence = ++imageSwapSequence;
	if (pendingImageUrl) {
		URL.revokeObjectURL(pendingImageUrl);
		elements.mapImageBuffer.removeAttribute('src');
	}
	const nextUrl = URL.createObjectURL(
		new Blob([styledSvg(svg, appearance)], { type: 'image/svg+xml' })
	);
	pendingImageUrl = nextUrl;
	imageSwapPending = true;
	fitImageOnLoad = fitOnLoad;
	elements.emptyWorkspace.hidden = true;
	if (currentProject?.structure) renderWorkspace();
	const startedAt = performance.now();
	try {
		const readyImage = elements.mapImageBuffer;
		readyImage.src = nextUrl;
		await readyImage.decode();
		if (sequence !== imageSwapSequence || pendingImageUrl !== nextUrl) {
			URL.revokeObjectURL(nextUrl);
			return false;
		}
		const previousImage = elements.mapImage;
		const previousUrl = currentImageUrl;
		readyImage.hidden = false;
		previousImage.hidden = true;
		elements.mapImage = readyImage;
		elements.mapImageBuffer = previousImage;
		currentImageUrl = nextUrl;
		pendingImageUrl = '';
		imageSwapPending = false;
		if (previousUrl) {
			URL.revokeObjectURL(previousUrl);
			elements.mapImageBuffer.removeAttribute('src');
		}
		timing?.('image_decode', performance.now() - startedAt);
	} catch {
		if (pendingImageUrl === nextUrl) pendingImageUrl = '';
		if (sequence === imageSwapSequence) {
			imageSwapPending = false;
			elements.mapImageBuffer.removeAttribute('src');
			elements.mapImageBuffer.hidden = true;
		}
		URL.revokeObjectURL(nextUrl);
		renderAll();
		return false;
	}
	renderStructureOverlay();
	renderAll();
	return true;
}

function updateTransform() {
	elements.mapSurface.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
	elements.zoomValue.value = `${Math.round(scale * 100)}%`;
}

function fitMap() {
	const { width, height } = workspaceDimensions();
	const availableWidth = Math.max(100, elements.canvas.clientWidth - 48);
	const availableHeight = Math.max(100, elements.canvas.clientHeight - 48);
	scale = Math.min(1, availableWidth / width, availableHeight / height);
	panX = -(width * scale) / 2;
	panY = -(height * scale) / 2;
	updateTransform();
}

function zoom(multiplier) {
	const oldScale = scale;
	scale = Math.max(.1, Math.min(4, scale * multiplier));
	const { width, height } = workspaceDimensions();
	panX += (width * oldScale - width * scale) / 2;
	panY += (height * oldScale - height * scale) / 2;
	updateTransform();
}

function syncEditOverlaySize() {
	const { width, height } = workspaceDimensions();
	elements.mapSurface.style.width = `${width}px`;
	elements.mapSurface.style.height = `${height}px`;
	elements.structureOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
	elements.editOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
}

function eventCell(event) {
	const bounds = currentProject?.structure?.bounds;
	const mapBounds = currentProject?.structure?.mapBounds;
	if (!bounds || !mapBounds) return null;
	const target = activeMapElement();
	const rect = target.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	const dimensions = workspaceDimensions();
	const pixelX = (event.clientX - rect.left) * dimensions.width / rect.width;
	const pixelY = (event.clientY - rect.top) * dimensions.height / rect.height;
	const cell = [
		Math.floor((pixelX - canvasPadding) / cellSize + mapBounds[0]),
		Math.floor((pixelY - canvasPadding) / cellSize + mapBounds[1])
	];
	return cell[0] >= bounds[0] && cell[0] < bounds[2] && cell[1] >= bounds[1] && cell[1] < bounds[3]
		? cell : null;
}

function cellKey(cell) {
	return `${cell[0]},${cell[1]}`;
}

function keyCell(key) {
	return key.split(',').map(Number);
}

function lineCells(start, end) {
	let [x0, y0] = start;
	const [x1, y1] = end;
	const result = [];
	const dx = Math.abs(x1 - x0);
	const sx = x0 < x1 ? 1 : -1;
	const dy = -Math.abs(y1 - y0);
	const sy = y0 < y1 ? 1 : -1;
	let error = dx + dy;
	while (true) {
		result.push([x0, y0]);
		if (x0 === x1 && y0 === y1) break;
		const doubled = error * 2;
		if (doubled >= dy) { error += dy; x0 += sx; }
		if (doubled <= dx) { error += dx; y0 += sy; }
	}
	return result;
}

function rectangleCells(start, end) {
	const result = [];
	for (let y = Math.min(start[1], end[1]); y <= Math.max(start[1], end[1]); y += 1) {
		for (let x = Math.min(start[0], end[0]); x <= Math.max(start[0], end[0]); x += 1) result.push([x, y]);
	}
	return result;
}

function roundPreview(center, radius) {
	const bounds = currentProject.structure.bounds;
	const result = [];
	for (let y = center[1] - radius; y <= center[1] + radius; y += 1) {
		for (let x = center[0] - radius; x <= center[0] + radius; x += 1) {
			if (x < bounds[0] || x >= bounds[2] || y < bounds[1] || y >= bounds[3]) continue;
			if ((x - center[0]) ** 2 + (y - center[1]) ** 2 <= (radius + .5) ** 2) result.push([x, y]);
		}
	}
	return result;
}

function gestureCells(gesture, current, shiftKey = false) {
	if (gesture.tool === 'roundRoom') {
		const radius = Math.max(1, Math.abs(current[0] - gesture.start[0]), Math.abs(current[1] - gesture.start[1]));
		return roundPreview(gesture.start, radius);
	}
	if (gesture.tool === 'roomClass') return [current];
	if (gesture.shift || shiftKey) return rectangleCells(gesture.start, current);
	return [...gesture.cells].map(keyCell);
}

function objectFootprint(tool, cell, rotation = objectRotation) {
	let [width, height] = tool === 'dais' ? [3, 2] : tool === 'coffin' ? [1, 2] : [1, 1];
	if (rotation % 2) [width, height] = [height, width];
	const cells = [];
	for (let y = cell[1]; y < cell[1] + height; y += 1) {
		for (let x = cell[0]; x < cell[0] + width; x += 1) cells.push([x, y]);
	}
	return cells;
}

function placementIndex() {
	if (placementIndexCache.project === currentProject && placementIndexCache.value) return placementIndexCache.value;
	const structure = currentProject?.structure;
	const floor = new Set((structure?.floorCells ?? []).map(cellKey));
	const occupied = new Set();
	const propAt = new Map();
	for (const object of structure?.objects ?? []) {
		for (const cell of object.cells ?? []) {
			const key = cellKey(cell);
			propAt.set(key, { targetKind: 'prop', id: object.id, cells: object.cells });
			if (!object.type.startsWith('rock_')) occupied.add(key);
		}
	}
	const layoutAt = new Map();
	for (const [collection, kind] of [['doors', 'door'], ['stairs', 'stairs'], ['exits', 'exit']]) {
		for (const item of currentProject?.layout?.[collection] ?? []) {
			const key = cellKey([item.x, item.y]);
			const matches = layoutAt.get(key) ?? [];
			matches.push({ targetKind: kind, id: item.id, cells: [[item.x, item.y]] });
			layoutAt.set(key, matches);
		}
	}
	const roomCells = new Set();
	for (const room of structure?.rooms ?? []) {
		if (room.suppressed === true) continue;
		for (const cell of room.cells ?? []) roomCells.add(cellKey(cell));
	}
	const value = {
		floor, occupied, propAt, layoutAt, roomCells,
		water: new Set((structure?.waterCells ?? []).map(cellKey))
	};
	placementIndexCache.project = currentProject;
	placementIndexCache.value = value;
	return value;
}

function layoutItemsAt(cell, index = placementIndex()) {
	return index.layoutAt.get(cellKey(cell)) ?? [];
}

function corridorDoorRotations(cell, index = placementIndex()) {
	const key = cellKey(cell);
	if (index.roomCells.has(key)) return [];
	const northSouth = index.floor.has(cellKey([cell[0], cell[1] - 1])) && index.floor.has(cellKey([cell[0], cell[1] + 1]));
	const eastWest = index.floor.has(cellKey([cell[0] - 1, cell[1]])) && index.floor.has(cellKey([cell[0] + 1, cell[1]]));
	return [
		...(northSouth ? [0, 2] : []),
		...(eastWest ? [1, 3] : [])
	];
}

function eraseTarget(cell, index = placementIndex()) {
	const key = cellKey(cell);
	const prop = index.propAt.get(key);
	if (prop) return prop;
	const layoutTarget = index.layoutAt.get(key)?.[0];
	if (layoutTarget) return layoutTarget;
	if (index.water.has(key)) return { targetKind: 'water', cell, cells: [cell] };
	return null;
}

function placementPreview(tool, cell) {
	if (!cell) return { cells: [], valid: false, target: null, rotation: objectRotation };
	const index = placementIndex();
	if (tool === 'eraser') {
		const target = eraseTarget(cell, index);
		return { cells: target?.cells ?? [cell], valid: Boolean(target), target, rotation: objectRotation };
	}
	const cells = objectFootprint(tool, cell);
	let valid = cells.every((value) => index.floor.has(cellKey(value)));
	if (valid && propTools.has(tool) && !tool.startsWith('rock_')) {
		valid = cells.every((value) => !index.occupied.has(cellKey(value)));
	}
	if (valid && layoutTools.has(tool)) {
		valid = layoutItemsAt(cell, index).length === 0;
		if (valid && tool.startsWith('door_')) {
			const rotations = corridorDoorRotations(cell, index);
			const rotation = rotations.includes(objectRotation) ? objectRotation : rotations[0] ?? objectRotation;
			return { cells, valid: rotations.length > 0, target: null, rotation };
		}
		if (valid && (tool === 'entrance' || tool === 'exit')) {
			const facing = [[0, -1], [1, 0], [0, 1], [-1, 0]][objectRotation];
			valid = !index.floor.has(cellKey([cell[0] + facing[0], cell[1] + facing[1]]));
		}
	}
	return { cells, valid, target: null, rotation: objectRotation };
}

function localId(prefix) {
	const id = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}${Math.random()}`.replace('.', '');
	return `${prefix}-${id.slice(0, 12)}`;
}

function currentPlacementObjectId() {
	if (!placementObjectId) placementObjectId = localId('manual');
	return placementObjectId;
}

function sameCell(left, right) {
	return Boolean(left && right && left[0] === right[0] && left[1] === right[1]) || (!left && !right);
}

function cellSet(cells = []) {
	return new Set(cells.map(cellKey));
}

function sortedCells(keys) {
	return [...keys].map(keyCell).sort((left, right) => left[1] - right[1] || left[0] - right[0]);
}

function roomGeometryCells(room, bounds) {
	const result = [];
	const width = Math.max(0, Number(room.width) || 0);
	const height = Math.max(0, Number(room.height) || 0);
	const cx = room.x + width / 2;
	const cy = room.y + height / 2;
	for (let y = room.y; y < room.y + height; y += 1) {
		for (let x = room.x; x < room.x + width; x += 1) {
			if (x < bounds[0] || x >= bounds[2] || y < bounds[1] || y >= bounds[3]) continue;
			if (room.shape !== 'circle' || (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= (width / 2) ** 2) result.push([x, y]);
		}
	}
	return result;
}

function connectedComponents(keys) {
	const remaining = new Set(keys);
	const result = [];
	while (remaining.size) {
		const start = remaining.values().next().value;
		remaining.delete(start);
		const component = new Set([start]);
		const queue = [keyCell(start)];
		while (queue.length) {
			const [x, y] = queue.shift();
			for (const neighbor of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
				const key = cellKey(neighbor);
				if (!remaining.delete(key)) continue;
				component.add(key);
				queue.push(neighbor);
			}
		}
		result.push(component);
	}
	return result;
}

function nextRoomNumber(rooms) {
	const used = new Set(rooms.map((room) => room.number).filter((number) => number > 0));
	let number = 1;
	while (used.has(number)) number += 1;
	return number;
}

function roomFromCells(template, keys, kind = template.kind) {
	const cells = sortedCells(keys);
	const xs = cells.map((cell) => cell[0]);
	const ys = cells.map((cell) => cell[1]);
	return {
		...template, kind, shape: kind === 'round' ? 'circle' : 'rect',
		x: Math.min(...xs), y: Math.min(...ys),
		width: Math.max(...xs) - Math.min(...xs) + 1,
		height: Math.max(...ys) - Math.min(...ys) + 1,
		cells
	};
}

function minimumPositiveNumber(items) {
	const numbers = items.map((item) => item.number).filter((number) => number > 0);
	return numbers.length ? Math.min(...numbers) : 0;
}

function reclassifyLocal(structure) {
	const floor = cellSet(structure.floorCells);
	const explicit = [];
	const previousAuto = [];
	for (const raw of structure.rooms ?? []) {
		const sourceCells = ['generated', 'round'].includes(raw.kind)
			? roomGeometryCells(raw, structure.bounds)
			: raw.cells ?? [];
		const keys = new Set(sourceCells.map(cellKey).filter((key) => floor.has(key)));
		if (!keys.size) continue;
		const room = { ...raw, cells: sortedCells(keys) };
		(room.kind === 'auto' ? previousAuto : explicit).push(room);
	}

	const mergedExplicit = [];
	for (const room of explicit) {
		const roomKeys = cellSet(room.cells);
		const overlaps = mergedExplicit.filter((item) => item.cells.some((cell) => roomKeys.has(cellKey(cell))));
		if (!overlaps.length) {
			mergedExplicit.push(room);
			continue;
		}
		const candidates = [...overlaps, room];
		const target = candidates.reduce((best, item) => ((item.number || 513) < (best.number || 513) ? item : best));
		const combined = new Set(roomKeys);
		for (const item of overlaps) {
			for (const cell of item.cells) combined.add(cellKey(cell));
			mergedExplicit.splice(mergedExplicit.indexOf(item), 1);
		}
		mergedExplicit.push(roomFromCells({
			...target,
			number: minimumPositiveNumber(candidates),
			suppressed: candidates.every((item) => item.suppressed), decorationCleared: true
		}, combined, 'merged'));
	}

	const remainingAuto = [];
	for (const autoRoom of previousAuto) {
		const autoKeys = cellSet(autoRoom.cells);
		const overlaps = mergedExplicit.filter((room) => room.cells.some((cell) => autoKeys.has(cellKey(cell))));
		if (!overlaps.length) {
			remainingAuto.push(autoRoom);
			continue;
		}
		const combined = new Set(autoKeys);
		for (const room of overlaps) {
			for (const cell of room.cells) combined.add(cellKey(cell));
			mergedExplicit.splice(mergedExplicit.indexOf(room), 1);
		}
		const candidates = [...overlaps, autoRoom];
		const target = candidates.reduce((best, item) => ((item.number || 513) < (best.number || 513) ? item : best));
		mergedExplicit.push(roomFromCells({
			...target,
			number: minimumPositiveNumber(candidates),
			suppressed: candidates.every((item) => item.suppressed), decorationCleared: true
		}, combined, 'merged'));
	}

	const explicitKeys = new Set(mergedExplicit.flatMap((room) => room.cells.map(cellKey)));
	const qualified = new Set();
	const bounds = structure.bounds;
	for (let y = bounds[1]; y <= bounds[3] - 4; y += 1) {
		for (let x = bounds[0]; x <= bounds[2] - 4; x += 1) {
			const window = rectangleCells([x, y], [x + 3, y + 3]).map(cellKey);
			if (window.every((key) => floor.has(key) && !explicitKeys.has(key))) window.forEach((key) => qualified.add(key));
		}
	}
	const usedPrevious = new Set();
	const autoRooms = [];
	for (const keys of connectedComponents(qualified)) {
		let previous = null;
		let overlapCount = 0;
		for (const room of remainingAuto) {
			if (usedPrevious.has(room.id)) continue;
			const count = room.cells.reduce((sum, cell) => sum + Number(keys.has(cellKey(cell))), 0);
			if (count > overlapCount) { previous = room; overlapCount = count; }
		}
		if (previous) usedPrevious.add(previous.id);
		const number = previous?.number || nextRoomNumber([...mergedExplicit, ...autoRooms]);
		autoRooms.push(roomFromCells({
			id: previous?.id ?? localId('auto'), kind: 'auto', number,
			suppressed: previous?.suppressed === true, decorationCleared: true
		}, keys, 'auto'));
	}
	structure.rooms = [...mergedExplicit, ...autoRooms];
	structure.nextRoomNumber = nextRoomNumber(structure.rooms);
}

function applyLocalOperation(project, operation) {
	const next = cloneProject(project);
	const structure = next.structure;
	const layout = next.layout;
	const floor = cellSet(structure.floorCells);
	let affected = [];
	if (operation.type === 'paint') {
		affected = operation.cells;
		if (operation.mode === 'wall') {
			const removed = cellSet(affected);
			removed.forEach((key) => floor.delete(key));
			structure.objects = (structure.objects ?? []).filter((item) => !(item.cells ?? []).some((cell) => removed.has(cellKey(cell))));
			structure.waterCells = (structure.waterCells ?? []).filter((cell) => !removed.has(cellKey(cell)));
			structure.roundAreas = (structure.roundAreas ?? []).filter((area) => roomGeometryCells({ shape: 'circle', x: area.x, y: area.y, width: area.diameter, height: area.diameter }, structure.bounds).some((cell) => floor.has(cellKey(cell))));
			for (const collection of ['doors', 'stairs', 'exits']) layout[collection] = (layout[collection] ?? []).filter((item) => !removed.has(cellKey([item.x, item.y])));
		} else operation.cells.forEach((cell) => floor.add(cellKey(cell)));
	} else if (operation.type === 'roundRoom') {
		const radius = operation.radius;
		affected = roundPreview(operation.center, radius);
		affected.forEach((cell) => floor.add(cellKey(cell)));
		const descriptor = {
			id: localId('round'), kind: 'round', shape: 'circle',
			x: operation.center[0] - radius, y: operation.center[1] - radius,
			width: radius * 2 + 1, height: radius * 2 + 1,
			number: structure.nextRoomNumber, suppressed: false, decorationCleared: true,
			cells: affected
		};
		structure.rooms.push(descriptor);
		structure.roundAreas.push({ id: descriptor.id, x: descriptor.x, y: descriptor.y, diameter: descriptor.width });
	} else if (operation.type === 'toggleRoom') {
		const key = cellKey(operation.cell);
		const room = (structure.rooms ?? []).filter((item) => item.cells?.some((cell) => cellKey(cell) === key)).sort((a, b) => a.cells.length - b.cells.length)[0];
		if (!room) return null;
		room.suppressed = !room.suppressed;
	} else if (operation.type === 'placeObject') {
		const cells = objectFootprint(operation.objectType, operation.cell, operation.rotation);
		if (propTools.has(operation.objectType)) {
			const centered = ['fountain', 'column_round', 'column_square', 'rock_small', 'rock_medium', 'rock_large'].includes(operation.objectType);
			const descriptor = {
				id: operation.objectId || localId('manual'), type: operation.objectType,
				x: operation.cell[0] + (centered ? .5 : 0), y: operation.cell[1] + (centered ? .5 : 0),
				rotation: operation.rotation, source: 'manual', cells
			};
			if (operation.objectType.startsWith('rock_')) {
				descriptor.size = Number(operation.size) || defaultRockSize(operation.objectType);
				descriptor.shape = Array.isArray(operation.shape) ? operation.shape : rockShapePoints(descriptor).map((point) => point.map((value) => value / cellSize));
			}
			structure.objects.push(descriptor);
		} else {
			const direction = ['north', 'east', 'south', 'west'][operation.rotation];
			const definition = layoutObjectDefinitions[operation.objectType];
			const [collection, type] = definition;
			const item = { id: localId('manual'), x: operation.cell[0], y: operation.cell[1], direction, type, manual: true };
			if (collection === 'doors') Object.assign(item, { roomId: '', passageId: '' });
			if (collection === 'stairs') item.passageId = '';
			if (collection === 'exits') Object.assign(item, { roomId: '', main: operation.objectType === 'entrance' });
			layout[collection].push(item);
		}
	} else if (operation.type === 'eraseObject') {
		if (operation.targetKind === 'water') structure.waterCells = structure.waterCells.filter((cell) => cellKey(cell) !== cellKey(operation.cell));
		else if (operation.targetKind === 'prop') structure.objects = structure.objects.filter((item) => item.id !== operation.id);
		else {
			const collection = { door: 'doors', stairs: 'stairs', exit: 'exits' }[operation.targetKind];
			layout[collection] = layout[collection].filter((item) => item.id !== operation.id);
		}
	} else if (operation.type === 'paintWater') {
		const water = cellSet(structure.waterCells);
		operation.cells.forEach((cell) => water.add(cellKey(cell)));
		structure.waterCells = sortedCells(water);
	} else return null;

	if (affected.length) {
		const affectedKeys = cellSet(affected);
		const cleared = new Set(structure.clearedDecorationRoomIds ?? []);
		for (const room of layout.rooms ?? []) {
			if (roomGeometryCells(room, structure.bounds).some((cell) => affectedKeys.has(cellKey(cell)))) cleared.add(String(room.id));
		}
		structure.clearedDecorationRoomIds = [...cleared].filter(Boolean).sort();
		for (const room of structure.rooms ?? []) {
			if (room.cells?.some((cell) => affectedKeys.has(cellKey(cell)))) room.decorationCleared = true;
		}
	}
	structure.floorCells = sortedCells(floor);
	reclassifyLocal(structure);
	structure.revision = Number(structure.revision ?? 0) + 1;
	next.clientRevision = Number(project.clientRevision ?? 0) + 1;
	next.stats = {
		...(next.stats ?? {}),
		rooms: structure.rooms.filter((room) => !room.suppressed).length,
		doors: layout.doors?.length ?? 0,
		stairs: layout.stairs?.length ?? 0,
		exits: layout.exits?.length ?? 0
	};
	return next;
}

function structureNeedsRender(project = currentProject) {
	const structure = project?.structure;
	return Boolean(structure && (
		!project?.renderSvg
		|| Number(structure.renderedRevision ?? 0) !== Number(structure.revision ?? 0)
	));
}

function cellsPath(cells, mapBounds) {
	return cells.map((cell) => {
		const x = canvasPadding + (cell[0] - mapBounds[0]) * cellSize;
		const y = canvasPadding + (cell[1] - mapBounds[1]) * cellSize;
		return `M${x} ${y}h${cellSize}v${cellSize}h-${cellSize}z`;
	}).join('');
}

function appendStructurePath(cells, className, fill, stroke) {
	const mapBounds = currentProject?.structure?.mapBounds;
	if (!mapBounds || !cells.length) return;
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', cellsPath(cells, mapBounds));
	path.setAttribute('class', `structure-pending-cell ${className}`);
	if (fill) path.setAttribute('fill', fill);
	if (stroke) path.setAttribute('stroke', stroke);
	elements.structureOverlay.append(path);
}

function renderStructureOverlay() {
	elements.structureOverlay.replaceChildren();
	const structure = currentProject?.structure;
	if (!structure || !structureNeedsRender()) return;
	const currentFloor = new Set((structure.floorCells ?? []).map(cellKey));
	const renderedFloor = new Set((structure.renderedFloorCells ?? structure.floorCells ?? []).map(cellKey));
	const additions = [...currentFloor].filter((key) => !renderedFloor.has(key)).map(keyCell);
	const removals = [...renderedFloor].filter((key) => !currentFloor.has(key)).map(keyCell);
	const appearance = normalizeAppearance(currentProject.appearance);
	appendStructurePath(additions, 'structure-pending-add', appearance.floor, appearance.walls);
	appendStructurePath(removals, 'structure-pending-remove', appearance.background, appearance.walls);
	appendStructurePath([...pendingClassificationCells].map(keyCell), 'structure-pending-class', '', '');
}

function queueEditPreview(cells = [], tool = activeTool, validity = null) {
	queuedEditPreview = { cells, tool, validity };
	if (editPreviewFrame) return;
	editPreviewFrame = requestAnimationFrame(() => {
		editPreviewFrame = 0;
		const request = queuedEditPreview;
		queuedEditPreview = null;
		if (request) renderEditPreview(request.cells, request.tool, request.validity);
	});
}

function renderEditPreview(cells = [], tool = activeTool, validity = null) {
	if (editPreviewFrame) cancelAnimationFrame(editPreviewFrame);
	editPreviewFrame = 0;
	queuedEditPreview = null;
	elements.editOverlay.replaceChildren();
	const mapBounds = currentProject?.structure?.mapBounds;
	if (!mapBounds) return;
	let previewCells = cells;
	let previewValidity = validity;
	let placement = null;
	if ((propTools.has(tool) || layoutTools.has(tool) || tool === 'eraser') && hoveredCell && !cells.length) {
		placement = placementPreview(tool, hoveredCell);
		previewCells = placement.cells;
		previewValidity = placement.valid;
	}
	if (tool === 'waterBrush' && previewCells.length && previewValidity == null) {
		const floor = placementIndex().floor;
		previewValidity = previewCells.every((cell) => floor.has(cellKey(cell)));
	}
	if (!previewCells.length) return;
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', cellsPath(previewCells, mapBounds));
	const stateClass = previewValidity == null ? '' : previewValidity ? ' placement-valid' : ' placement-invalid';
	path.setAttribute('class', `edit-preview-cell ${tool}${stateClass}`);
	elements.editOverlay.append(path);
	if (hoveredCell && placement && (propTools.has(tool) || layoutTools.has(tool))) {
		const objectClass = `edit-preview-object${placement.valid ? '' : ' placement-invalid'}`;
		if (propTools.has(tool)) {
			const object = {
				id: currentPlacementObjectId(), type: tool,
				cells: objectFootprint(tool, hoveredCell, placement.rotation),
				rotation: placement.rotation
			};
			if (tool.startsWith('rock_')) {
				object.size = defaultRockSize(tool);
				object.shape = rockShapePoints(object).map((point) => point.map((value) => value / cellSize));
			}
			appendLightweightObject(elements.editOverlay, object, objectClass);
		} else {
			const [collection, type] = layoutObjectDefinitions[tool];
			appendLightweightLayoutObject(elements.editOverlay, collection, {
				x: hoveredCell[0], y: hoveredCell[1], type,
				direction: ['north', 'east', 'south', 'west'][placement.rotation],
				main: tool === 'entrance'
			}, objectClass);
		}
	}
}

async function makePreviewBase64() {
	if (!currentProject?.structure) return '';
	let source = elements.mapImage;
	let temporaryUrl = '';
	if (!source.naturalWidth || !source.naturalHeight) {
		if (!elements.structureMap.childElementCount) renderLightweightMap();
		const lightweight = elements.structureMap.cloneNode(true);
		const style = svgElement('style');
		style.textContent = '.structure-object{fill:rgba(216,139,53,.18);stroke:#1c0919;stroke-width:3}.structure-layout-object{fill:none;stroke-width:4}.structure-number{dominant-baseline:central;text-anchor:middle;font:700 30px Georgia,serif;paint-order:stroke;stroke:rgba(255,255,255,.72);stroke-width:4px}';
		lightweight.prepend(style);
		temporaryUrl = URL.createObjectURL(new Blob(
			[new XMLSerializer().serializeToString(lightweight)],
			{ type: 'image/svg+xml;charset=utf-8' }
		));
		source = new Image();
		source.src = temporaryUrl;
		await source.decode().catch(() => undefined);
	}
	if (!source.naturalWidth || !source.naturalHeight) {
		if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
		return '';
	}
	const canvas = document.createElement('canvas');
	canvas.width = previewSizePixels;
	canvas.height = previewSizePixels;
	const context = canvas.getContext('2d');
	context.fillStyle = normalizeAppearance(currentProject.appearance).background;
	context.fillRect(0, 0, previewSizePixels, previewSizePixels);
	const ratio = Math.min(
		previewSizePixels / source.naturalWidth,
		previewSizePixels / source.naturalHeight
	);
	const width = source.naturalWidth * ratio;
	const height = source.naturalHeight * ratio;
	context.drawImage(
		source,
		(previewSizePixels - width) / 2,
		(previewSizePixels - height) / 2,
		width,
		height
	);
	const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .58));
	if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
	if (!blob) return '';
	return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function autosaveCurrent(timing = null, includePreview = true) {
	if (!currentProjectId || !currentProject?.structure) return;
	const projectId = currentProjectId;
	const project = compactProject(currentProject);
	pendingHostSaveRevision = Number(currentProject.clientRevision ?? 0);
	let startedAt = performance.now();
	timing?.('autosave_project_prepare', performance.now() - startedAt);
	let previewBase64 = '';
	if (includePreview && currentProjectId === projectId) {
		startedAt = performance.now();
		await elements.mapImage.decode().catch(() => undefined);
		timing?.('image_decode', performance.now() - startedAt);
		startedAt = performance.now();
		previewBase64 = await makePreviewBase64();
		timing?.('autosave_preview', performance.now() - startedAt);
	}
	startedAt = performance.now();
	send('dungeongen:autosave', {
		projectId,
		projectData: project,
		previewBase64
	});
	timing?.('autosave_dispatch', performance.now() - startedAt);
}

function cancelCanonicalRender() {
	if (canonicalRenderTimer) clearTimeout(canonicalRenderTimer);
	canonicalRenderTimer = null;
	canonicalRenderSequence += 1;
}

async function renderCanonicalProject(projectId, revision, clientRevision, sequence, persistPreview = false) {
	const requestId = newEditRequestId();
	const timing = (stage, elapsedMs) => logEditTime(requestId, `canonical_${stage}`, elapsedMs);
	try {
		let startedAt = performance.now();
		const body = JSON.stringify({ project: projectForEdit() });
		timing('request_serialization', performance.now() - startedAt);
		startedAt = performance.now();
		const response = await fetch('/dungeon-editor/api/render', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Dungeongen-Capability': capability,
				'X-Dungeongen-Request-Id': requestId
			},
			body
		});
		timing('fetch_until_headers', performance.now() - startedAt);
		startedAt = performance.now();
		const payload = await response.json().catch(() => null);
		timing('response_decode', performance.now() - startedAt);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'editFailed');
		if (
			sequence !== canonicalRenderSequence
			|| currentProjectId !== projectId
			|| Number(currentProject?.structure?.revision ?? -1) !== revision
			|| Number(currentProject?.clientRevision ?? -1) !== clientRevision
		) return false;
		const appearance = currentProject.appearance;
		const nextProject = { ...payload.project, appearance };
		const imageReady = await setProjectImage(
			nextProject.renderSvg,
			false,
			workspaceView === 'preview',
			timing,
			nextProject.appearance
		);
		if (
			!imageReady
			|| sequence !== canonicalRenderSequence
			|| currentProjectId !== projectId
			|| Number(currentProject?.structure?.revision ?? -1) !== revision
			|| Number(currentProject?.clientRevision ?? -1) !== clientRevision
		) return false;
		currentProject = nextProject;
		pendingClassificationCells.clear();
		localStatus = workingCopyDirty ? 'statusUnsaved' : '';
		renderAll();
		if (persistPreview) await autosaveCurrent(timing, true);
		return true;
	} catch {
		if (sequence === canonicalRenderSequence && currentProjectId === projectId) {
			localStatus = 'errorEditFailed';
			renderAll();
		}
		return false;
	}
}

function scheduleCanonicalRender() {
	if (fastMode && workspaceView === 'structure') return;
	if (!currentProjectId || !currentProject?.structure || !structureNeedsRender()) return;
	if (canonicalRenderTimer) clearTimeout(canonicalRenderTimer);
	const projectId = currentProjectId;
	const revision = Number(currentProject.structure.revision ?? 0);
	const clientRevision = Number(currentProject.clientRevision ?? 0);
	const sequence = ++canonicalRenderSequence;
	canonicalRenderTimer = setTimeout(() => {
		canonicalRenderTimer = null;
		if (sequence !== canonicalRenderSequence || currentProjectId !== projectId) return;
		if (editing || generating) {
			scheduleCanonicalRender();
			return;
		}
		const needsPreview = !hostState.projects?.find((project) => project.id === projectId)?.previewUrl;
		void renderCanonicalProject(projectId, revision, clientRevision, sequence, needsPreview);
	}, canonicalRenderDelayMs);
}

async function ensureCanonicalProject({ persistPreview = true } = {}) {
	if (!currentProjectId || !currentProject?.structure) return false;
	if (!structureNeedsRender() && currentProject.renderSvg) {
		if (imageSwapPending && pendingImageSwapPromise) await pendingImageSwapPromise;
		if (!currentImageUrl || !elements.mapImage.src) {
			return setProjectImage(currentProject.renderSvg, false, true);
		}
		return true;
	}
	cancelCanonicalRender();
	const projectId = currentProjectId;
	const revision = Number(currentProject.structure.revision ?? 0);
	const clientRevision = Number(currentProject.clientRevision ?? 0);
	const sequence = ++canonicalRenderSequence;
	localStatus = 'statusPreparingPreview';
	renderAll();
	return renderCanonicalProject(projectId, revision, clientRevision, sequence, persistPreview);
}

async function restoreHistory(nextProject, destination) {
	if (!nextProject || editing || generating) return;
	cancelCanonicalRender();
	pendingClassificationCells.clear();
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = null;
	pendingAppearanceSnapshot = null;
	destination.push(cloneProject());
	if (destination.length > maxHistoryEntries) destination.shift();
	const nextClientRevision = Number(currentProject?.clientRevision ?? 0) + 1;
	currentProject = { ...cloneProject(nextProject), clientRevision: nextClientRevision };
	writeParameters(currentProject.parameters);
	writeAppearance(currentProject.appearance);
	setProjectImage(currentProject.renderSvg, false);
	localStatus = 'statusUnsaved';
	renderAll();
	markWorkingCopyDirty();
}

async function undoEdit() {
	if (!undoStack.length || editing || generating) return;
	const snapshot = undoStack.pop();
	await restoreHistory(snapshot, redoStack);
	renderAll();
}

async function redoEdit() {
	if (!redoStack.length || editing || generating) return;
	const snapshot = redoStack.pop();
	await restoreHistory(snapshot, undoStack);
	renderAll();
}

async function commitStructure(operation) {
	if (!canEditMap()) return;
	const requestId = newEditRequestId();
	const totalStartedAt = performance.now();
	const timing = (stage, elapsedMs) => logEditTime(requestId, stage, elapsedMs);
	const previous = cloneProject();
	const startedAt = performance.now();
	const next = applyLocalOperation(currentProject, operation);
	if (!next) {
		localStatus = 'errorEditFailed';
		return;
	}
	currentProject = next;
	if (operation.type === 'toggleRoom' && Array.isArray(operation.cell)) pendingClassificationCells.add(cellKey(operation.cell));
	pushHistory(previous);
	writeParameters(currentProject.parameters);
	writeAppearance(currentProject.appearance);
	timing('client_operation', performance.now() - startedAt);
	localStatus = 'statusUnsaved';
	markWorkingCopyDirty();
	renderEditPreview();
	renderAll();
	timing('browser_total', performance.now() - totalStartedAt);
}

async function initializeProjectStructure() {
	if (!capability || !currentProjectId || !currentProject?.renderSvg || !currentProject?.layout || editing) return;
	const needsStructure = !currentProject.structure;
	const needsObjects = currentProject.structure && !currentProject.structure.objectsInitialized;
	if (!needsStructure && !needsObjects) return;
	const projectId = currentProjectId;
	const project = cloneProject();
	editing = true;
	localStatus = 'statusEditing';
	elements.loadingLabel.textContent = t('preparingEditor');
	elements.loading.hidden = false;
	renderAll();
	try {
		const response = await fetch('/dungeon-editor/api/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Dungeongen-Capability': capability },
			body: JSON.stringify({
				project: projectForEdit(project),
				operation: { type: needsStructure ? 'initialize' : 'initializeObjects' },
				deferRender: !needsStructure
			})
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'editFailed');
		if (currentProjectId !== projectId) return;
		const renderedSvg = payload.project.renderSvg ?? currentProject.renderSvg;
		currentProject = {
			...payload.project,
			renderSvg: renderedSvg,
			clientRevision: Number(currentProject.clientRevision ?? 0) + 1
		};
		setProjectImage(currentProject.renderSvg, false);
		workingCopyDirty = true;
		void persistWorkingDraft();
		localStatus = 'statusUnsaved';
		await checkpointWorkingCopy();
	} catch {
		if (currentProjectId === projectId) localStatus = 'errorEditFailed';
	} finally {
		editing = false;
		elements.loadingLabel.textContent = t('generating');
		elements.loading.hidden = true;
		renderAll();
		if (currentProjectId === projectId && needsStructure) void initializeProjectStructure();
		else if (structureNeedsRender()) scheduleCanonicalRender();
	}
}

async function generate() {
	if (!currentProjectId || generating) return;
	cancelCanonicalRender();
	pendingClassificationCells.clear();
	if (appearanceUpdateTimer) {
		clearTimeout(appearanceUpdateTimer);
		appearanceUpdateTimer = null;
		if (currentProject?.renderSvg) currentProject.appearance = normalizeAppearance(readAppearance());
	}
	pendingAppearanceSnapshot = null;
	generating = true;
	localStatus = 'statusGenerating';
	elements.loading.hidden = false;
	renderAll();
	try {
		const response = await fetch('/api/dungeongen/editor/generate', {
			method: 'POST', headers: {
				'Content-Type': 'application/json',
				'X-Dungeongen-Capability': capability
			},
			body: JSON.stringify({ parameters: readParameters(), deferRender: true })
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'generationFailed');
		const previousClientRevision = Number(currentProject?.clientRevision ?? 0);
		currentProject = {
			...payload.project,
			appearance: normalizeAppearance(currentProject?.appearance),
			clientRevision: previousClientRevision + 1
		};
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		workingCopyDirty = true;
		void persistWorkingDraft();
		setProjectImage(currentProject.renderSvg);
		resetHistory();
		fitMap();
		localStatus = 'statusSaving';
		renderAll();
		await checkpointWorkingCopy();
	} catch {
		localStatus = 'errorGenerationFailed';
	} finally {
		generating = false;
		elements.loading.hidden = true;
		renderAll();
		if (structureNeedsRender()) scheduleCanonicalRender();
	}
}

async function openProject(message) {
	cancelCanonicalRender();
	pendingClassificationCells.clear();
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = null;
	resetHistory();
	workingCopyDirty = false;
	pendingHostSaveRevision = null;
	renderEditPreview();
	localStatus = 'statusLoading';
	currentProjectId = String(message.projectId ?? '');
	const openingProjectId = currentProjectId;
	currentProjectName = String(message.name ?? '');
	try {
		const serverProject = message.projectData && typeof message.projectData === 'object'
			? cloneProject(message.projectData)
			: JSON.parse(base64ToUtf8(String(message.projectBase64 ?? '')));
		currentProject = serverProject;
		const draft = await readWorkingDraft(currentProjectId);
		if (currentProjectId !== openingProjectId) return;
		if (
			draft?.project?.formatVersion === serverProject.formatVersion
			&& Number(draft.clientRevision ?? 0) > Number(serverProject.clientRevision ?? 0)
		) {
			currentProject = { ...draft.project, renderSvg: serverProject.renderSvg ?? null };
			workingCopyDirty = true;
			localStatus = 'statusDraftRecovered';
		} else if (draft) {
			void deleteWorkingDraft(currentProjectId);
		}
		currentProject.appearance = normalizeAppearance(currentProject.appearance);
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		setProjectImage(currentProject.renderSvg);
		if (!workingCopyDirty) localStatus = '';
	} catch {
		currentProject = null;
		setProjectImage(null);
		localStatus = 'errorGeneric';
	}
	renderAll();
	void initializeProjectStructure();
	if (workingCopyDirty) scheduleWorkingCopyCheckpoint();
	if (structureNeedsRender()) scheduleCanonicalRender();
}

function applyHostState(next) {
	hostState = { ...hostState, ...(next ?? {}) };
	capability = typeof hostState.capability === 'string' ? hostState.capability : capability;
	if (hostState.statusCode || hostState.errorCode) localStatus = '';
	if (hostState.selectedProjectId && hostState.selectedProjectId !== currentProjectId) {
		currentProjectId = hostState.selectedProjectId;
	}
	if (hostState.theme === 'light' || hostState.theme === 'dark') {
		applyTheme(hostState.theme, { persist: false });
	}
	if (hostState.statusCode === 'saved' && !hostState.errorCode) acknowledgeHostSave();
	renderAll();
	void initializeProjectStructure();
}

function activateTool(name) {
	if (name === 'editing' && !canEditMap()) return;
	if (name !== 'colors' && paletteMenuOpen) closeColorPresetMenu();
	activePanel = name;
	editGesture = null;
	renderEditPreview();
	document.querySelectorAll('[data-tool-button]').forEach((button) => {
		button.classList.toggle('active', button.dataset.toolButton === name);
	});
	document.querySelectorAll('[data-tool-panel]').forEach((panel) => {
		panel.classList.toggle('active', panel.dataset.toolPanel === name);
	});
}

document.querySelectorAll('[data-tool-button]').forEach((button) => {
	button.addEventListener('click', () => activateTool(button.dataset.toolButton));
});
document.querySelectorAll('[data-edit-tool]').forEach((button) => {
	button.addEventListener('pointerenter', () => showEditToolTooltip(button));
	button.addEventListener('pointerleave', () => hideEditToolTooltip(button));
	button.addEventListener('focus', () => showEditToolTooltip(button));
	button.addEventListener('blur', () => hideEditToolTooltip(button));
	button.addEventListener('click', () => {
		if (!canEditMap() || !editingTools.has(button.dataset.editTool)) return;
		activeTool = button.dataset.editTool;
		editGesture = null;
		placementObjectId = '';
		renderEditPreview();
		renderEditingTool();
	});
});

async function setWorkspaceView(view) {
	if (!fastMode || !['structure', 'preview'].includes(view)) return;
	workspaceView = view;
	hoveredCell = null;
	placementObjectId = '';
	renderEditPreview();
	if (view === 'structure') {
		cancelCanonicalRender();
		setProjectImage(currentProject?.renderSvg, false);
		renderAll();
		fitMap();
		return;
	}
	renderAll();
	const ready = structureNeedsRender()
		? await ensureCanonicalProject()
		: await checkpointWorkingCopy();
	if (ready) fitMap();
}

function setFastMode(enabled) {
	fastMode = enabled;
	workspaceView = enabled ? 'structure' : 'preview';
	try { localStorage.setItem(fastModeStorageKey, String(enabled)); } catch {}
	if (enabled) {
		cancelCanonicalRender();
		setProjectImage(currentProject?.renderSvg, false);
	} else {
		setProjectImage(currentProject?.renderSvg, false, true);
		if (structureNeedsRender()) scheduleCanonicalRender();
	}
	renderAll();
	if (currentProject?.structure) fitMap();
}

async function saveAppearance() {
	if (!currentProjectId || !currentProject?.renderSvg) return;
	localStatus = 'statusSaving';
	renderAll();
	await autosaveCurrent(null, !(fastMode && workspaceView === 'structure'));
}

async function updateAppearance() {
	appearanceUpdateTimer = null;
	if (!currentProject?.structure) return;
	const nextAppearance = normalizeAppearance(readAppearance());
	if (JSON.stringify(nextAppearance) === JSON.stringify(currentProject.appearance)) {
		pendingAppearanceSnapshot = null;
		return;
	}
	pushHistory(pendingAppearanceSnapshot ?? cloneProject());
	pendingAppearanceSnapshot = null;
	currentProject.appearance = nextAppearance;
	currentProject.clientRevision = Number(currentProject.clientRevision ?? 0) + 1;
	if (currentProject.renderSvg) setProjectImage(currentProject.renderSvg, false);
	else renderWorkspace();
	localStatus = 'statusUnsaved';
	markWorkingCopyDirty();
	renderAll();
}

function scheduleAppearanceUpdate() {
	if (!currentProject?.structure) return;
	if (!pendingAppearanceSnapshot) pendingAppearanceSnapshot = cloneProject();
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = setTimeout(() => void updateAppearance(), colorApplyDelayMs);
}

elements.createProjectForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const name = elements.newProjectName.value.trim() || t('productTitle');
	void checkpointWorkingCopy().then(() => send('dungeongen:project-create', { name }));
	elements.newProjectName.value = '';
});
elements.generateButton.addEventListener('click', generate);
elements.openGeneration.addEventListener('click', () => activateTool('generation'));
elements.structureTab.addEventListener('click', () => void setWorkspaceView('structure'));
elements.previewTab.addEventListener('click', () => void setWorkspaceView('preview'));
elements.fastMode.addEventListener('change', () => setFastMode(elements.fastMode.checked));
elements.palettePresetButton.addEventListener('click', () => {
	paletteMenuOpen = !paletteMenuOpen;
	elements.palettePresetMenu.hidden = !paletteMenuOpen;
	elements.palettePresetButton.setAttribute('aria-expanded', String(paletteMenuOpen));
});
for (const input of Object.values(elements.colors)) input.addEventListener('input', () => {
	syncColorPreset(readAppearance());
	scheduleAppearanceUpdate();
});
elements.exportButton.addEventListener('click', async () => {
	if (!currentProjectId || !currentProject?.structure) return;
	localStatus = 'statusExporting';
	renderAll();
	if (!await ensureCanonicalProject({ persistPreview: false })) return;
	localStatus = 'statusExporting';
	renderAll();
	await elements.mapImage.decode().catch(() => undefined);
	const projectId = currentProjectId;
	const project = currentProject;
	const previewBase64 = await makePreviewBase64();
	send('dungeongen:export', {
		projectId,
		projectData: compactProject(project),
		previewBase64
	});
});
elements.backButton.addEventListener('click', () => void checkpointWorkingCopy().then(() => send('dungeongen:back')));
elements.themeToggle.addEventListener('click', toggleTheme);
elements.undoEdit.addEventListener('click', () => void undoEdit());
elements.redoEdit.addEventListener('click', () => void redoEdit());
elements.zoomIn.addEventListener('click', () => zoom(1.2));
elements.zoomOut.addEventListener('click', () => zoom(1 / 1.2));
elements.fitMap.addEventListener('click', fitMap);
function handleMapImageLoad(event) {
	if (event.currentTarget !== elements.mapImage) return;
	syncEditOverlaySize();
	if (fitImageOnLoad) fitMap();
}
elements.mapImage.addEventListener('load', handleMapImageLoad);
elements.mapImageBuffer.addEventListener('load', handleMapImageLoad);
elements.canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
elements.canvas.addEventListener('pointerdown', (event) => {
	if (activePanel === 'editing' && canEditMap() && event.button === 0) {
		const cell = eventCell(event);
		if (!cell) return;
		event.preventDefault();
		editGesture = {
			tool: activeTool, start: cell, current: cell, last: cell,
			shift: event.shiftKey, cells: new Set([cellKey(cell)]), pointerId: event.pointerId,
			objectId: propTools.has(activeTool) ? currentPlacementObjectId() : ''
		};
		elements.canvas.setPointerCapture(event.pointerId);
		hoveredCell = cell;
		if (propTools.has(activeTool) || layoutTools.has(activeTool) || activeTool === 'eraser') renderEditPreview();
		else renderEditPreview(gestureCells(editGesture, cell, event.shiftKey), activeTool);
		return;
	}
	pointerStart = { x: event.clientX, y: event.clientY, panX, panY };
	elements.canvas.setPointerCapture(event.pointerId);
	elements.canvas.classList.add('panning');
});
elements.canvas.addEventListener('pointermove', (event) => {
	if (editGesture) {
		const cell = eventCell(event);
		if (!cell) return;
		const cellChanged = !sameCell(cell, editGesture.current);
		const shiftChanged = editGesture.shift !== event.shiftKey;
		if (!cellChanged && !shiftChanged) return;
		if (cellChanged && (editGesture.tool === 'wall' || editGesture.tool === 'corridor' || editGesture.tool === 'waterBrush')) {
			for (const pathCell of lineCells(editGesture.last, cell)) editGesture.cells.add(cellKey(pathCell));
		}
		editGesture.last = cell;
		editGesture.current = cell;
		editGesture.shift = event.shiftKey;
		hoveredCell = cell;
		if (propTools.has(editGesture.tool) || layoutTools.has(editGesture.tool) || editGesture.tool === 'eraser') queueEditPreview();
		else queueEditPreview(gestureCells(editGesture, cell, event.shiftKey), editGesture.tool);
		return;
	}
	if (activePanel === 'editing' && canEditMap()) {
		const cell = eventCell(event);
		if (!sameCell(cell, hoveredCell)) {
			hoveredCell = cell;
			if (propTools.has(activeTool) || layoutTools.has(activeTool) || activeTool === 'eraser') queueEditPreview();
			else queueEditPreview(cell ? (activeTool === 'roundRoom' ? roundPreview(cell, 1) : [cell]) : [], activeTool);
		}
	}
	if (!pointerStart) return;
	panX = pointerStart.panX + event.clientX - pointerStart.x;
	panY = pointerStart.panY + event.clientY - pointerStart.y;
	updateTransform();
});

elements.canvas.addEventListener('pointerup', (event) => {
	if (editGesture) {
		const gesture = editGesture;
		const current = eventCell(event) ?? gesture.current;
		const cells = gestureCells(gesture, current, event.shiftKey);
		editGesture = null;
		if (elements.canvas.hasPointerCapture(event.pointerId)) elements.canvas.releasePointerCapture(event.pointerId);
		hoveredCell = current;
		if (gesture.tool === 'wall' || gesture.tool === 'corridor') {
			renderEditPreview(cells, gesture.tool);
			void commitStructure({ type: 'paint', mode: gesture.tool, cells });
		} else if (gesture.tool === 'roundRoom') {
			renderEditPreview(cells, gesture.tool);
			const radius = Math.max(1, Math.abs(current[0] - gesture.start[0]), Math.abs(current[1] - gesture.start[1]));
			void commitStructure({ type: 'roundRoom', center: gesture.start, radius });
		} else if (gesture.tool === 'roomClass') {
			renderEditPreview(cells, gesture.tool);
			void commitStructure({ type: 'toggleRoom', cell: current });
		} else if (gesture.tool === 'waterBrush') {
			const floor = new Set((currentProject.structure.floorCells ?? []).map(cellKey));
			const valid = cells.every((cell) => floor.has(cellKey(cell)));
			renderEditPreview(cells, gesture.tool, valid);
			if (valid) void commitStructure({ type: 'paintWater', cells });
			else localStatus = 'invalidPlacement';
		} else if (gesture.tool === 'eraser') {
			const { target, valid } = placementPreview('eraser', current);
			renderEditPreview([], gesture.tool);
			if (valid) void commitStructure({ type: 'eraseObject', ...target });
			else localStatus = 'invalidPlacement';
		} else {
			const placement = placementPreview(gesture.tool, current);
			renderEditPreview([], gesture.tool);
			if (placement.valid) {
				const operation = {
					type: 'placeObject', objectType: gesture.tool, cell: current, rotation: placement.rotation,
					objectId: gesture.objectId || currentPlacementObjectId()
				};
				if (gesture.tool.startsWith('rock_')) {
					operation.size = defaultRockSize(gesture.tool);
					operation.shape = rockShapePoints({ id: operation.objectId, type: gesture.tool, size: operation.size })
						.map((point) => point.map((value) => value / cellSize));
				}
				placementObjectId = '';
				void commitStructure(operation);
			} else localStatus = 'invalidPlacement';
		}
		renderAll();
		return;
	}
	pointerStart = null;
	elements.canvas.classList.remove('panning');
});
elements.canvas.addEventListener('pointercancel', () => {
	editGesture = null;
	pointerStart = null;
	placementObjectId = '';
	elements.canvas.classList.remove('panning');
	hoveredCell = null;
	renderEditPreview();
});
elements.canvas.addEventListener('pointerleave', () => {
	if (!editGesture) {
		hoveredCell = null;
		renderEditPreview();
	}
});
elements.canvas.addEventListener('contextmenu', (event) => {
	if (activePanel === 'editing') event.preventDefault();
});
document.addEventListener('keydown', async (event) => {
	const target = event.target;
	if (event.code === 'Escape' && paletteMenuOpen) {
		event.preventDefault();
		closeColorPresetMenu();
		elements.palettePresetButton.focus();
		return;
	}
	if (target instanceof HTMLElement && (target.matches('textarea, select, input:not([type="color"])') || target.isContentEditable)) return;
	if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyS') {
		event.preventDefault();
		if (appearanceUpdateTimer) {
			clearTimeout(appearanceUpdateTimer);
			appearanceUpdateTimer = null;
			await updateAppearance();
		}
		if (!fastMode && structureNeedsRender()) await ensureCanonicalProject();
		else await checkpointWorkingCopy();
		return;
	}
	if (!event.ctrlKey && !event.metaKey && !event.altKey && rotatableTools.has(activeTool) && activePanel === 'editing') {
		if (event.code !== 'KeyQ' && event.code !== 'KeyR') return;
		event.preventDefault();
		objectRotation = (objectRotation + (event.code === 'KeyR' ? 1 : 3)) % 4;
		renderEditPreview();
		return;
	}
	if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
	const redo = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey);
	if (event.code !== 'KeyZ' && event.code !== 'KeyY') return;
	event.preventDefault();
	if (appearanceUpdateTimer) {
		clearTimeout(appearanceUpdateTimer);
		appearanceUpdateTimer = null;
		await updateAppearance();
	}
	if (redo) await redoEdit();
	else await undoEdit();
});
document.addEventListener('pointerdown', (event) => {
	if (paletteMenuOpen && !elements.palettePresetButton.contains(event.target) && !elements.palettePresetMenu.contains(event.target)) {
		closeColorPresetMenu();
	}
});
window.addEventListener('resize', () => currentProject?.structure && fitMap());
window.addEventListener('pagehide', () => {
	if (!workingCopyDirty) return;
	void persistWorkingDraft();
	void checkpointWorkingCopy();
});
window.addEventListener('message', (event) => {
	if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
	if (event.data.type === 'dungeongen:host-state') {
		void loadLocale(String(event.data.locale ?? fallbackLocale));
		applyHostState({ ...event.data.state, theme: event.data.theme });
	}
	if (event.data.type === 'dungeongen:open') void openProject(event.data);
});

void Promise.all([loadEditorConfig(), loadColorPresets(), loadLocale(fallbackLocale)]).then(() => {
	renderColorPresetOptions();
	if (periodicCheckpointTimer) clearInterval(periodicCheckpointTimer);
	periodicCheckpointTimer = setInterval(() => { if (workingCopyDirty) void checkpointWorkingCopy(); }, workingCopyIntervalMs);
	renderSideFire();
	renderAll();
	send('dungeongen:ready');
});
