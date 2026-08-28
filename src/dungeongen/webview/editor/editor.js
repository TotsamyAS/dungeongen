const fallbackLocale = 'ru';
const editorAssetVersion = '20260810-2';
const defaultColorApplyDelayMs = 350;
const defaultCanonicalRenderDelayMs = 10000;
const defaultPreviewSizePixels = 48;
const defaultWorkingCopyIdleSaveMs = 15000;
const defaultWorkingCopyIntervalMs = 300000;
const defaultThemeSaveTimeoutMs = 20000;
const defaultCellSize = 60;
const defaultCanvasPaddingCells = 2;
const alwaysAvailablePanels = new Set(['projects', 'support', 'about']);
const maxHistoryEntries = 20;
const structureTools = new Set(['wall', 'corridor', 'roundRoom', 'roomClass']);
const propTools = new Set([
	'coffin',
	'dais',
	'altar',
	'fountain',
	'column_round',
	'column_square',
	'rock_small',
	'rock_medium',
	'rock_large'
]);
const layoutTools = new Set([
	'stairs_up',
	'stairs_down',
	'entrance',
	'exit',
	'door_open',
	'door_closed',
	'door_locked',
	'door_secret'
]);
const layoutObjectDefinitions = {
	door_open: ['doors', 'open'],
	door_closed: ['doors', 'closed'],
	door_locked: ['doors', 'locked'],
	door_secret: ['doors', 'secret'],
	stairs_up: ['stairs', 'up'],
	stairs_down: ['stairs', 'down'],
	entrance: ['exits', 'entrance'],
	exit: ['exits', 'exit']
};
const editingTools = new Set([
	...structureTools,
	...propTools,
	...layoutTools,
	'waterBrush',
	'eraser'
]);
const rotatableTools = new Set([...propTools, ...layoutTools]);
const spawnNpcSizes = [1, 2, 3, 4];
const nonBlockingSpawnDecorTypes = new Set(['dais']);
const isNonBlockingSpawnDecor = (type) =>
	nonBlockingSpawnDecorTypes.has(type) || type.startsWith('rock_');
const fastModeStorageKey = 'dungeongen-fast-mode';
const defaultAppearance = {
	background: '#ffffff',
	shading: '#d0d2d5',
	floor: '#ffffff',
	shadow: '#d0d0d0',
	walls: '#000000',
	hatching: '#000000',
	grid: '#202020',
	water: '#505050',
	numbers: '#000000'
};
const templateColors = {
	background: '#f10101',
	shading: '#f20202',
	floor: '#f30303',
	shadow: '#f40404',
	walls: '#f50505',
	hatching: '#f60606',
	grid: '#f70707',
	water: '#f80808',
	numbers: '#f90909'
};
try {
	document.documentElement.dataset.theme =
		localStorage.getItem('dungeon-overlord-theme') === 'light' ? 'light' : 'dark';
} catch {
	document.documentElement.dataset.theme = 'dark';
}
const dictionaries = new Map();
let labels = {};
let hostState = {
	projects: [],
	customThemes: [],
	selectedProjectId: null,
	storage: null,
	supportEmail: ''
};
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
let cellSize = defaultCellSize;
let canvasPadding = cellSize * defaultCanvasPaddingCells;
let colorApplyDelayMs = defaultColorApplyDelayMs;
let canonicalRenderDelayMs = defaultCanonicalRenderDelayMs;
let previewSizePixels = defaultPreviewSizePixels;
let editTimeLogging = false;
let themeSaveLogging = false;
let themeSaveTimeoutMs = defaultThemeSaveTimeoutMs;
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
let draftPersistTimer = null;
let draftPersistIdleHandle = 0;
let fastMode = false;
let workspaceView = 'preview';
let objectRotation = 0;
let hoveredCell = null;
let colorPresets = [];
let selectedCustomThemeId = null;
let themeSaving = false;
let themeStatusKey = '';
let themeStatusError = false;
let pendingThemeRequestId = '';
let pendingThemeTimeout = null;
let paletteMenuOpen = false;
let editPreviewFrame = 0;
let queuedEditPreview = null;
let placementObjectId = '';
let spawnOverlayVisible = false;
let renameProjectCandidate = null;
let lastHostStatusCode = '';
let toastTimer = 0;
let allowNextProjectOpen = false;
let generatedSeedValue = '';
const placementIndexCache = { project: null, value: null };
const encoderRequests = new Map();
const pendingClassificationCells = new Set();
const pendingDecorationObjectIds = new Set();
const renderedDecorationObjectIds = new Set();
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
	spawnOverlay: document.getElementById('spawnOverlay'),
	editOverlay: document.getElementById('editOverlay'),
	emptyWorkspace: document.getElementById('emptyWorkspace'),
	loading: document.getElementById('loading'),
	loadingLabel: document.getElementById('loadingLabel'),
	loadingProgress: document.getElementById('loadingProgress'),
	loadingProgressValue: document.getElementById('loadingProgressValue'),
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
	saveProject: document.getElementById('saveProject'),
	exportProject: document.getElementById('exportProject'),
	backButton: document.getElementById('backButton'),
	themeToggle: document.getElementById('themeToggle'),
	undoEdit: document.getElementById('undoEdit'),
	redoEdit: document.getElementById('redoEdit'),
	editToolTitle: document.getElementById('editToolTitle'),
	editToolHint: document.getElementById('editToolHint'),
	editAreaShortcut: document.getElementById('editAreaShortcut'),
	stats: document.getElementById('stats'),
	spawnNpcSize: document.getElementById('spawnNpcSize'),
	spawnSummary: document.getElementById('spawnSummary'),
	spawnOverlayToggle: document.getElementById('spawnOverlayToggle'),
	spawnDownload: document.getElementById('spawnDownload'),
	sourceLink: document.getElementById('sourceLink'),
	supportEmailLink: document.getElementById('supportEmailLink'),
	supportEmailText: document.getElementById('supportEmailText'),
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
	paletteName: document.getElementById('paletteName'),
	paletteSave: document.getElementById('paletteSave'),
	paletteSaveText: document.getElementById('paletteSaveText'),
	paletteDelete: document.getElementById('paletteDelete'),
	paletteStatus: document.getElementById('paletteStatus'),
	appToast: document.getElementById('appToast'),
	renameProjectDialog: document.getElementById('renameProjectDialog'),
	renameProjectForm: document.getElementById('renameProjectForm'),
	renameProjectName: document.getElementById('renameProjectName'),
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

const appSelectInstances = new Map();
let openAppSelect = null;
let appSelectSequence = 0;

function appSelectAccessibleLabel(select) {
	const field = select.closest('.field');
	return (
		field?.querySelector(':scope > span')?.textContent?.trim() ||
		select.getAttribute('aria-label') ||
		'—'
	);
}

function firstEnabledAppSelectIndex(instance) {
	return Array.from(instance.select.options).findIndex((option) => !option.disabled);
}

function lastEnabledAppSelectIndex(instance) {
	const options = instance.select.options;
	for (let index = options.length - 1; index >= 0; index -= 1) {
		if (!options[index].disabled) return index;
	}
	return -1;
}

function selectedAppSelectIndex(instance) {
	const index = instance.select.selectedIndex;
	return index >= 0 && !instance.select.options[index]?.disabled
		? index
		: firstEnabledAppSelectIndex(instance);
}

function positionAppSelectMenu(instance) {
	if (openAppSelect !== instance || instance.menu.hidden || !instance.trigger.isConnected) return;
	const gap = 7;
	const margin = 12;
	const anchorRect = instance.trigger.getBoundingClientRect();
	const viewportWidth = document.documentElement.clientWidth;
	const viewportHeight = document.documentElement.clientHeight;
	const maximumWidth = Math.max(0, viewportWidth - margin * 2);
	instance.menu.dataset.floatingPositioned = 'false';
	instance.menu.style.width = 'max-content';
	instance.menu.style.minWidth = `${Math.min(anchorRect.width, maximumWidth)}px`;
	instance.menu.style.maxWidth = `${maximumWidth}px`;
	const menuRect = instance.menu.getBoundingClientRect();
	const left = Math.min(
		Math.max(anchorRect.left, margin),
		Math.max(margin, viewportWidth - menuRect.width - margin)
	);
	const availableBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - margin);
	const availableAbove = Math.max(0, anchorRect.top - gap - margin);
	const placeBelow = availableBelow >= menuRect.height || availableBelow >= availableAbove;
	const availableHeight = Math.max(placeBelow ? availableBelow : availableAbove, 80);
	const visibleHeight = Math.min(menuRect.height, availableHeight);
	const top = placeBelow
		? anchorRect.bottom + gap
		: Math.max(margin, anchorRect.top - gap - visibleHeight);
	instance.menu.style.left = `${Math.round(left)}px`;
	instance.menu.style.top = `${Math.round(top)}px`;
	instance.menu.style.setProperty(
		'--floating-available-height',
		`${Math.floor(availableHeight)}px`
	);
	instance.menu.dataset.placement = placeBelow ? 'bottom' : 'top';
	instance.menu.dataset.floatingPositioned = 'true';
}

function scrollAppSelectHighlightIntoView(instance) {
	requestAnimationFrame(() => {
		instance.menu
			.querySelector(`[data-option-index="${instance.highlightedIndex}"]`)
			?.scrollIntoView({ block: 'nearest' });
	});
}

function updateAppSelectOptionState(instance) {
	instance.menu.querySelectorAll('.app-select-option').forEach((button) => {
		const index = Number(button.dataset.optionIndex);
		const selected = index === instance.select.selectedIndex;
		button.classList.toggle('selected', selected);
		button.classList.toggle('highlighted', index === instance.highlightedIndex);
		button.setAttribute('aria-selected', String(selected));
	});
	instance.trigger.setAttribute(
		'aria-activedescendant',
		openAppSelect === instance && instance.highlightedIndex >= 0
			? `${instance.id}-option-${instance.highlightedIndex}`
			: ''
	);
}

function renderAppSelectOptions(instance) {
	instance.menu.replaceChildren();
	Array.from(instance.select.options).forEach((option, index) => {
		const button = document.createElement('button');
		button.className = 'app-select-option';
		button.id = `${instance.id}-option-${index}`;
		button.dataset.optionIndex = String(index);
		button.type = 'button';
		button.setAttribute('role', 'option');
		button.disabled = option.disabled;
		button.textContent = option.textContent?.trim() || option.value;
		button.addEventListener('mouseenter', () => {
			if (option.disabled) return;
			instance.highlightedIndex = index;
			updateAppSelectOptionState(instance);
		});
		button.addEventListener('click', () => chooseAppSelectOption(instance, index));
		instance.menu.append(button);
	});
	updateAppSelectOptionState(instance);
}

function syncAppSelect(instance) {
	const selected = instance.select.selectedOptions[0] ?? instance.select.options[0];
	instance.value.textContent = selected?.textContent?.trim() || '—';
	instance.trigger.disabled = instance.select.disabled || instance.select.options.length === 0;
	const accessibleLabel = appSelectAccessibleLabel(instance.select);
	instance.trigger.setAttribute('aria-label', accessibleLabel);
	instance.menu.setAttribute('aria-label', accessibleLabel);
	if (openAppSelect === instance) {
		if (
			instance.highlightedIndex < 0 ||
			instance.select.options[instance.highlightedIndex]?.disabled
		) {
			instance.highlightedIndex = selectedAppSelectIndex(instance);
		}
		renderAppSelectOptions(instance);
		requestAnimationFrame(() => positionAppSelectMenu(instance));
	}
}

function syncAppSelects() {
	for (const instance of appSelectInstances.values()) syncAppSelect(instance);
}

function closeAppSelect(instance = openAppSelect, { restoreFocus = false } = {}) {
	if (!instance) return;
	instance.root.classList.remove('open');
	instance.trigger.setAttribute('aria-expanded', 'false');
	instance.trigger.removeAttribute('aria-activedescendant');
	instance.menu.hidden = true;
	instance.menu.dataset.floatingPositioned = 'false';
	if (openAppSelect === instance) openAppSelect = null;
	if (restoreFocus) instance.trigger.focus();
}

function openAppSelectMenu(instance) {
	if (instance.trigger.disabled || instance.select.options.length === 0) return;
	if (openAppSelect && openAppSelect !== instance) closeAppSelect(openAppSelect);
	openAppSelect = instance;
	instance.highlightedIndex = selectedAppSelectIndex(instance);
	instance.root.classList.add('open');
	instance.trigger.setAttribute('aria-expanded', 'true');
	instance.menu.hidden = false;
	renderAppSelectOptions(instance);
	requestAnimationFrame(() => {
		positionAppSelectMenu(instance);
		scrollAppSelectHighlightIntoView(instance);
	});
}

function toggleAppSelect(instance) {
	if (openAppSelect === instance) closeAppSelect(instance);
	else openAppSelectMenu(instance);
}

function chooseAppSelectOption(instance, index) {
	const option = instance.select.options[index];
	if (!option || option.disabled || instance.select.disabled) return;
	const changed = instance.select.value !== option.value;
	instance.select.value = option.value;
	instance.highlightedIndex = index;
	syncAppSelect(instance);
	closeAppSelect(instance, { restoreFocus: true });
	if (changed) {
		instance.select.dispatchEvent(new Event('input', { bubbles: true }));
		instance.select.dispatchEvent(new Event('change', { bubbles: true }));
	}
}

function moveAppSelectHighlight(instance, direction) {
	const options = instance.select.options;
	if (options.length === 0) return;
	let nextIndex = instance.highlightedIndex;
	for (let step = 0; step < options.length; step += 1) {
		nextIndex = (nextIndex + direction + options.length) % options.length;
		if (!options[nextIndex].disabled) {
			instance.highlightedIndex = nextIndex;
			updateAppSelectOptionState(instance);
			scrollAppSelectHighlightIntoView(instance);
			return;
		}
	}
}

function handleAppSelectKeydown(instance, event) {
	if (instance.trigger.disabled) return;
	switch (event.key) {
		case 'ArrowDown':
			event.preventDefault();
			event.stopPropagation();
			if (openAppSelect !== instance) openAppSelectMenu(instance);
			else moveAppSelectHighlight(instance, 1);
			break;
		case 'ArrowUp':
			event.preventDefault();
			event.stopPropagation();
			if (openAppSelect !== instance) openAppSelectMenu(instance);
			else moveAppSelectHighlight(instance, -1);
			break;
		case 'Home':
			if (openAppSelect !== instance) return;
			event.preventDefault();
			event.stopPropagation();
			instance.highlightedIndex = firstEnabledAppSelectIndex(instance);
			updateAppSelectOptionState(instance);
			scrollAppSelectHighlightIntoView(instance);
			break;
		case 'End':
			if (openAppSelect !== instance) return;
			event.preventDefault();
			event.stopPropagation();
			instance.highlightedIndex = lastEnabledAppSelectIndex(instance);
			updateAppSelectOptionState(instance);
			scrollAppSelectHighlightIntoView(instance);
			break;
		case 'Enter':
		case ' ':
			event.preventDefault();
			event.stopPropagation();
			if (openAppSelect !== instance) openAppSelectMenu(instance);
			else if (instance.highlightedIndex >= 0)
				chooseAppSelectOption(instance, instance.highlightedIndex);
			break;
		case 'Escape':
			if (openAppSelect !== instance) return;
			event.preventDefault();
			event.stopPropagation();
			closeAppSelect(instance);
			break;
		case 'Tab':
			if (openAppSelect === instance) closeAppSelect(instance);
			break;
	}
}

function initializeAppSelect(select) {
	if (!(select instanceof HTMLSelectElement) || appSelectInstances.has(select)) return;
	const id = `app-select-${select.id || ++appSelectSequence}`;
	const root = document.createElement('div');
	root.className = 'app-select';
	root.dataset.selectFor = select.id;
	const trigger = document.createElement('button');
	trigger.className = 'app-select-trigger';
	trigger.type = 'button';
	trigger.setAttribute('role', 'combobox');
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', 'false');
	trigger.setAttribute('aria-controls', `${id}-listbox`);
	const value = document.createElement('span');
	value.className = 'app-select-value';
	const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	chevron.classList.add('app-select-chevron');
	chevron.setAttribute('aria-hidden', 'true');
	const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
	use.setAttribute('href', '#icon-chevron-down');
	chevron.append(use);
	trigger.append(value, chevron);
	root.append(trigger);
	select.insertAdjacentElement('afterend', root);
	const menu = document.createElement('div');
	menu.className = 'app-select-menu';
	menu.id = `${id}-listbox`;
	menu.setAttribute('role', 'listbox');
	menu.dataset.floatingPositioned = 'false';
	menu.hidden = true;
	document.body.append(menu);
	const instance = { id, select, root, trigger, value, menu, highlightedIndex: -1 };
	appSelectInstances.set(select, instance);
	trigger.addEventListener('click', () => toggleAppSelect(instance));
	trigger.addEventListener('keydown', (event) => handleAppSelectKeydown(instance, event));
	select.addEventListener('change', () => syncAppSelect(instance));
	syncAppSelect(instance);
}

function initializeAppSelects() {
	document.querySelectorAll('.field select').forEach(initializeAppSelect);
}

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
	if (top + tooltipBounds.height > window.innerHeight - 8)
		top = buttonBounds.top - tooltipBounds.height - 8;
	editToolTooltip.style.left = `${Math.round(left)}px`;
	editToolTooltip.style.top = `${Math.round(Math.max(8, top))}px`;
}

function hideEditToolTooltip(button = null) {
	if (button?.getAttribute('aria-describedby') === editToolTooltip.id)
		button.removeAttribute('aria-describedby');
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
		try {
			localStorage.setItem('dungeon-overlord-theme', normalized);
		} catch {}
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
		const response = await fetch(`/dungeon-editor/config.json?v=${editorAssetVersion}`, {
			cache: 'no-store'
		});
		if (!response.ok) return;
		const config = await response.json();
		const configuredCellSize = Number(config?.gridSizePixels);
		const configuredPaddingCells = Number(config?.canvasPaddingCells);
		if (Number.isInteger(configuredCellSize) && configuredCellSize > 0) {
			cellSize = configuredCellSize;
		}
		const paddingCells =
			Number.isInteger(configuredPaddingCells) && configuredPaddingCells >= 0
				? configuredPaddingCells
				: defaultCanvasPaddingCells;
		canvasPadding = cellSize * paddingCells;
		const delay = Number(config?.colorApplyDelayMs);
		if (Number.isFinite(delay)) colorApplyDelayMs = Math.max(0, Math.min(5000, Math.round(delay)));
		const renderDelay = Number(config?.canonicalRenderDelayMs);
		if (Number.isFinite(renderDelay))
			canonicalRenderDelayMs = Math.max(0, Math.min(60000, Math.round(renderDelay)));
		const previewSize = Number(config?.previewSizePixels);
		if (Number.isFinite(previewSize))
			previewSizePixels = Math.max(32, Math.min(256, Math.round(previewSize)));
		editTimeLogging = config?.editTimeLogging === true;
		themeSaveLogging = config?.themeSaveLogging === true;
		const themeTimeout = Number(config?.themeSaveTimeoutMs);
		if (Number.isFinite(themeTimeout))
			themeSaveTimeoutMs = Math.max(5000, Math.min(120000, Math.round(themeTimeout)));
		const idleSave = Number(config?.workingCopyIdleSaveMs);
		if (Number.isFinite(idleSave))
			workingCopyIdleSaveMs = Math.max(1000, Math.min(300000, Math.round(idleSave)));
		const intervalSave = Number(config?.workingCopyIntervalMs);
		if (Number.isFinite(intervalSave))
			workingCopyIntervalMs = Math.max(10000, Math.min(1800000, Math.round(intervalSave)));
	} catch {
		colorApplyDelayMs = defaultColorApplyDelayMs;
		canonicalRenderDelayMs = defaultCanonicalRenderDelayMs;
		previewSizePixels = defaultPreviewSizePixels;
		editTimeLogging = false;
		themeSaveLogging = false;
		themeSaveTimeoutMs = defaultThemeSaveTimeoutMs;
		workingCopyIdleSaveMs = defaultWorkingCopyIdleSaveMs;
		workingCopyIntervalMs = defaultWorkingCopyIntervalMs;
	}
}

async function loadColorPresets() {
	try {
		const response = await fetch(`/dungeon-editor/palettes.json?v=${editorAssetVersion}`, {
			cache: 'no-store'
		});
		if (!response.ok) return;
		const value = await response.json();
		colorPresets = Array.isArray(value)
			? value
					.filter((preset) => preset && typeof preset.id === 'string' && preset.colors)
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
		projects: 'toolProjects',
		generation: 'toolGeneration',
		editing: 'toolEditing',
		spawn: 'toolSpawn',
		colors: 'toolColors',
		export: 'toolExport',
		settings: 'toolSettings',
		support: 'toolSupport',
		about: 'toolAbout'
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
	setControlLabel(elements.saveProject, t('save'));
	setControlLabel(elements.exportProject, t('export'));
	renderThemeToggle();
	setControlLabel(elements.zoomIn, t('zoomIn'));
	setControlLabel(elements.zoomOut, t('zoomOut'));
	setControlLabel(elements.fitMap, t('fit'));
	setControlLabel(elements.undoEdit, t('undo'));
	setControlLabel(elements.redoEdit, t('redo'));
	elements.createProjectForm.querySelector('button').setAttribute('aria-label', t('createProject'));
	renderColorPresetOptions();
	syncAppSelects();
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
	const objectLabel = document.querySelector(`[data-edit-tool="${activeTool}"] [data-label]`)
		?.dataset.label;
	elements.editToolTitle.textContent = content
		? t(content[0])
		: t(objectLabel ?? 'objectPlacementTitle');
	elements.editToolHint.textContent = content
		? t(content[1])
		: t(activeTool.startsWith('door_') ? 'doorPlacementHint' : 'objectPlacementHint');
	elements.editAreaShortcut.textContent = rotatableTools.has(activeTool)
		? t('rotationShortcut')
		: t('areaShortcut');
	elements.editAreaShortcut.hidden =
		!['wall', 'corridor', 'waterBrush'].includes(activeTool) && !rotatableTools.has(activeTool);
	document.querySelectorAll('[data-edit-tool]').forEach((button) => {
		const selected = button.dataset.editTool === activeTool;
		button.classList.toggle('active', selected);
		button.setAttribute('aria-pressed', String(selected));
	});
}

function renderSideFire() {
	const sparks = Array.from({ length: 78 }, (_, index) => ({
		x: `${4 + ((index * 47) % 93)}%`,
		y: `${(index * 11) % 19}%`,
		size: `${2 + ((index * 5) % 6)}px`,
		rotation: `${-34 + ((index * 29) % 69)}deg`,
		duration: `${3.4 + ((index * 13) % 47) / 10}s`,
		delay: `${-((index * 17) % 83) / 10}s`,
		drift: `${-34 + ((index * 31) % 69)}px`,
		rise: `${150 + ((index * 37) % 361)}px`
	}));
	for (const spark of sparks) {
		const element = document.createElement('i');
		element.className = 'game-side-spark';
		for (const [name, value] of Object.entries(spark))
			element.style.setProperty(`--spark-${name}`, value);
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
	return (
		globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12) ??
		`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
	);
}

function logEditTime(requestId, stage, elapsedMs) {
	if (!editTimeLogging) return;
	console.info(`[EDIT-TIME] id=${requestId} stage=${stage} elapsed_ms=${elapsedMs.toFixed(2)}`);
}

function logThemeSave(requestId, stage, details = {}) {
	if (!themeSaveLogging) return;
	console.info('[THEME-SAVE]', { requestId, stage, ...details });
}

function clearThemeRequestTimeout() {
	if (pendingThemeTimeout) clearTimeout(pendingThemeTimeout);
	pendingThemeTimeout = null;
}

function armThemeRequestTimeout(operation) {
	clearThemeRequestTimeout();
	const requestId = pendingThemeRequestId;
	pendingThemeTimeout = setTimeout(() => {
		if (!requestId || pendingThemeRequestId !== requestId) return;
		logThemeSave(requestId, 'editor_timeout', { operation, timeoutMs: themeSaveTimeoutMs });
		pendingThemeRequestId = '';
		themeSaving = false;
		themeStatusKey =
			operation === 'delete' ? 'paletteThemeDeleteTimeout' : 'paletteThemeSaveTimeout';
		themeStatusError = true;
		renderPaletteThemeControls();
	}, themeSaveTimeoutMs);
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
		return t(
			{
				storageQuotaExceeded: 'errorStorageQuotaExceeded',
				projectTooLarge: 'errorProjectTooLarge',
				serviceUnavailable: 'errorServiceUnavailable',
				openFailed: 'errorOpenFailed',
				saveFailed: 'errorSaveFailed',
				exportFailed: 'errorExportFailed'
			}[hostState.errorCode] ?? 'errorGeneric'
		);
	}
	return t(
		{
			loadingProject: 'statusLoading',
			saving: 'statusSaving',
			saved: 'statusSaved',
			exporting: 'statusExporting',
			exported: 'statusExported'
		}[hostState.statusCode] ?? 'statusReady'
	);
}

function showToast(text) {
	if (!text || !elements.appToast) return;
	elements.appToast.querySelector('span').textContent = text;
	elements.appToast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => {
		elements.appToast.hidden = true;
	}, 3200);
}

function syncHostToast() {
	const statusCode = String(hostState.statusCode ?? '');
	if (!statusCode) {
		lastHostStatusCode = '';
		return;
	}
	if (statusCode === lastHostStatusCode) return;
	lastHostStatusCode = statusCode;
	if (statusCode === 'saved') showToast(t('statusSaved'));
	if (statusCode === 'exported') showToast(t('statusExported'));
}

function openRenameProjectDialog(project) {
	renameProjectCandidate = project;
	elements.renameProjectName.value = project.name;
	elements.renameProjectDialog.showModal();
	elements.renameProjectName.focus();
	elements.renameProjectName.select();
}

function closeRenameProjectDialog() {
	renameProjectCandidate = null;
	if (elements.renameProjectDialog.open) elements.renameProjectDialog.close();
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

function writeAppearance(value, { preservePaletteSelection = false } = {}) {
	const appearance = normalizeAppearance(value);
	for (const [key, input] of Object.entries(elements.colors)) input.value = appearance[key];
	if (!preservePaletteSelection) setPaletteNameFromAppearance(appearance);
	syncColorPreset(appearance);
}

function readAppearance() {
	return Object.fromEntries(
		Object.entries(elements.colors).map(([key, input]) => [key, input.value])
	);
}

const palettePreviewKeys = ['background', 'floor', 'walls', 'hatching', 'water', 'numbers'];

function customColorPresets() {
	if (!Array.isArray(hostState.customThemes)) return [];
	return hostState.customThemes
		.filter(
			(theme) =>
				theme && typeof theme.id === 'string' && typeof theme.name === 'string' && theme.colors
		)
		.map((theme) => ({
			id: theme.id,
			name: theme.name,
			kind: 'custom',
			colors: normalizeAppearance(theme.colors)
		}));
}

function allColorPresets() {
	return [...colorPresets.map((preset) => ({ ...preset, kind: 'base' })), ...customColorPresets()];
}

function paletteKey(preset) {
	return `${preset.kind}:${preset.id}`;
}

function paletteName(preset) {
	return preset.kind === 'custom' ? preset.name : t(preset.labelKey);
}

function matchingColorPreset(value) {
	const appearance = normalizeAppearance(value);
	return (
		allColorPresets().find((preset) =>
			Object.keys(defaultAppearance).every((key) => preset.colors[key] === appearance[key])
		) ?? null
	);
}

function selectedCustomPreset() {
	return customColorPresets().find((preset) => preset.id === selectedCustomThemeId) ?? null;
}

function fillPalettePreview(element, colors) {
	element.replaceChildren();
	for (const key of palettePreviewKeys) {
		const swatch = document.createElement('span');
		swatch.style.backgroundColor = colors[key];
		element.append(swatch);
	}
}

function themeErrorKey(code, operation) {
	if (code === 'duplicate') return 'paletteThemeDuplicate';
	if (code === 'limitReached') return 'paletteThemeLimit';
	if (code === 'invalid') return 'paletteThemeInvalid';
	if (code === 'timeout')
		return operation === 'delete' ? 'paletteThemeDeleteTimeout' : 'paletteThemeSaveTimeout';
	return operation === 'delete' ? 'paletteThemeDeleteFailed' : 'paletteThemeSaveFailed';
}

function renderPaletteThemeControls() {
	const custom = selectedCustomPreset();
	const enabled = Boolean(currentProject?.structure) && !themeSaving;
	elements.paletteName.disabled = !enabled;
	elements.paletteSave.disabled = !enabled;
	elements.paletteDelete.disabled = !enabled || !custom;
	elements.paletteDelete.hidden = !custom;
	elements.paletteSaveText.textContent = t(custom ? 'paletteUpdateTheme' : 'paletteSaveTheme');
	elements.paletteStatus.textContent = themeStatusKey ? t(themeStatusKey) : '';
	elements.paletteStatus.classList.toggle('error', themeStatusError);
}

function syncColorPreset(value = readAppearance()) {
	if (!elements.palettePresetName || !elements.palettePresetPreview) return;
	const appearance = normalizeAppearance(value);
	const selected = selectedCustomPreset();
	const preset = selected ?? matchingColorPreset(appearance);
	elements.palettePresetName.textContent = preset ? paletteName(preset) : t('paletteCustom');
	fillPalettePreview(
		elements.palettePresetPreview,
		selected ? appearance : (preset?.colors ?? appearance)
	);
	const selectedKey = preset ? paletteKey(preset) : '';
	elements.palettePresetMenu?.querySelectorAll('[data-palette-key]').forEach((option) => {
		option.setAttribute('aria-selected', String(option.dataset.paletteKey === selectedKey));
	});
	renderPaletteThemeControls();
}

function setPaletteNameFromAppearance(value) {
	const preset = matchingColorPreset(value);
	selectedCustomThemeId = preset?.kind === 'custom' ? preset.id : null;
	elements.paletteName.value = preset ? paletteName(preset) : '';
}

function closeColorPresetMenu() {
	paletteMenuOpen = false;
	elements.palettePresetMenu.hidden = true;
	elements.palettePresetButton.setAttribute('aria-expanded', 'false');
}

function appendPaletteGroupLabel(key) {
	const label = document.createElement('div');
	label.className = 'palette-group-label';
	label.textContent = t(key);
	elements.palettePresetMenu.append(label);
}

function appendPaletteOption(preset) {
	const option = document.createElement('button');
	option.type = 'button';
	option.className = 'palette-option';
	option.dataset.paletteKey = paletteKey(preset);
	option.setAttribute('role', 'option');
	const preview = document.createElement('span');
	preview.className = 'palette-preview';
	preview.setAttribute('aria-hidden', 'true');
	fillPalettePreview(preview, preset.colors);
	const name = document.createElement('strong');
	name.textContent = paletteName(preset);
	option.append(preview, name);
	option.addEventListener('click', () => {
		if (!currentProject?.structure) return;
		if (!pendingAppearanceSnapshot) pendingAppearanceSnapshot = cloneProject();
		selectedCustomThemeId = preset.kind === 'custom' ? preset.id : null;
		elements.paletteName.value = paletteName(preset);
		themeStatusKey = '';
		themeStatusError = false;
		writeAppearance(preset.colors, { preservePaletteSelection: true });
		closeColorPresetMenu();
		void updateAppearance();
	});
	elements.palettePresetMenu.append(option);
}

function renderColorPresetOptions() {
	if (!elements.palettePresetMenu) return;
	elements.palettePresetMenu.replaceChildren();
	appendPaletteGroupLabel('paletteBaseThemes');
	for (const preset of colorPresets) appendPaletteOption({ ...preset, kind: 'base' });
	const divider = document.createElement('div');
	divider.className = 'palette-group-divider';
	divider.setAttribute('role', 'separator');
	elements.palettePresetMenu.append(divider);
	appendPaletteGroupLabel('paletteUserThemes');
	const custom = customColorPresets();
	if (custom.length) {
		for (const preset of custom) appendPaletteOption(preset);
	} else {
		const empty = document.createElement('p');
		empty.className = 'palette-group-empty';
		empty.textContent = t('paletteNoUserThemes');
		elements.palettePresetMenu.append(empty);
	}
	syncColorPreset(currentProject?.appearance ?? defaultAppearance);
}

function cloneProject(project = currentProject) {
	if (!project) return null;
	const renderSvg = project.renderSvg ?? null;
	const withoutSvg = { ...project, renderSvg: null };
	const cloned =
		typeof structuredClone === 'function'
			? structuredClone(withoutSvg)
			: JSON.parse(JSON.stringify(withoutSvg));
	return { ...cloned, renderSvg };
}

function compactProject(project = currentProject) {
	if (!project) return null;
	refreshProjectSpawnData(project);
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
		request.onupgradeneeded = () =>
			request.result.createObjectStore('drafts', { keyPath: 'projectId' });
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
	return draftTransaction('readwrite', (store) =>
		store.put({
			projectId: currentProjectId,
			clientRevision: Number(currentProject.clientRevision ?? 0),
			updatedAt: Date.now(),
			project: compactProject(currentProject)
		})
	);
}

function cancelScheduledDraftPersist() {
	if (draftPersistTimer) clearTimeout(draftPersistTimer);
	draftPersistTimer = null;
	if (draftPersistIdleHandle && typeof cancelIdleCallback === 'function')
		cancelIdleCallback(draftPersistIdleHandle);
	draftPersistIdleHandle = 0;
}

function scheduleWorkingDraftPersist() {
	cancelScheduledDraftPersist();
	draftPersistTimer = setTimeout(() => {
		draftPersistTimer = null;
		const persist = () => {
			draftPersistIdleHandle = 0;
			if (workingCopyDirty) void persistWorkingDraft();
		};
		if (typeof requestIdleCallback === 'function') {
			draftPersistIdleHandle = requestIdleCallback(persist, { timeout: 1500 });
		} else persist();
	}, 250);
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

function markWorkingCopyDirty(canonicalDelay = canonicalRenderDelayMs) {
	workingCopyDirty = true;
	scheduleWorkingDraftPersist();
	scheduleWorkingCopyCheckpoint();
	if (!fastMode) scheduleCanonicalRender(canonicalDelay);
}

async function checkpointWorkingCopy() {
	if (!workingCopyDirty || !currentProjectId || !currentProject?.structure || !capability)
		return true;
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
			if (
				currentProjectId !== projectId ||
				Number(currentProject?.clientRevision ?? -1) !== clientRevision
			)
				return false;
			const renderSvg = currentProject.renderSvg;
			currentProject = { ...payload.project, renderSvg };
			pendingHostSaveRevision = clientRevision;
			localStatus = 'statusSaving';
			renderAll();
			const needsPreview = !hostState.projects?.find((project) => project.id === projectId)
				?.previewUrl;
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
		cancelScheduledDraftPersist();
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
		currentProjectId &&
			currentProject?.structure &&
			currentProject.structure.objectsInitialized &&
			!generating &&
			!editing
	);
}

function renderAll() {
	elements.projectTitle.textContent = currentProjectName || t('productTitle');
	elements.statusText.textContent = statusLabel();
	syncHostToast();
	elements.sourceLink.href = hostState.sourceCodeURL || '#';
	elements.sourceLink.hidden = !hostState.sourceCodeURL;
	const supportEmail =
		typeof hostState.supportEmail === 'string' ? hostState.supportEmail.trim() : '';
	elements.supportEmailLink.href = supportEmail ? `mailto:${supportEmail}` : '#';
	elements.supportEmailLink.hidden = !supportEmail;
	elements.supportEmailLink.setAttribute(
		'aria-label',
		t('supportContactAria', { email: supportEmail })
	);
	elements.supportEmailText.textContent = supportEmail;
	const hasActiveProject = Boolean(currentProjectId);
	elements.generateButton.disabled = !hasActiveProject || generating || Boolean(hostState.loading);
	elements.exportButton.disabled =
		!currentProject?.structure || generating || Boolean(hostState.exporting);
	elements.saveProject.disabled =
		!currentProject?.structure || generating || Boolean(hostState.saving);
	elements.exportProject.disabled =
		!currentProject?.structure || generating || Boolean(hostState.exporting);
	elements.exportProject.classList.toggle('loading', Boolean(hostState.exporting));
	elements.exportProject.setAttribute('aria-busy', String(Boolean(hostState.exporting)));
	elements.openGeneration.disabled = !hasActiveProject;
	elements.openGeneration.hidden = !hasActiveProject;
	for (const input of Object.values(elements.colors)) input.disabled = !currentProject?.structure;
	elements.palettePresetButton.disabled = !currentProject?.structure || !colorPresets.length;
	renderPaletteThemeControls();
	document.querySelectorAll('[data-tool-button]').forEach((button) => {
		const panel = button.dataset.toolButton;
		button.disabled = !hasActiveProject && !alwaysAvailablePanels.has(panel);
	});
	document.querySelector('[data-tool-button="editing"]').disabled = !canEditMap();
	if (!hasActiveProject && !alwaysAvailablePanels.has(activePanel)) activateTool('projects');
	document.querySelectorAll('[data-edit-tool]').forEach((button) => {
		button.disabled = !canEditMap();
	});
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
	renderSpawnDiagnostics();
}

function renderStorage() {
	const storage = hostState.storage;
	elements.storageMeter.hidden = !storage;
	if (!storage) return;
	elements.storageUsed.textContent = t('storageUsed', { value: formatBytes(storage.usedBytes) });
	elements.storageAvailable.textContent = t('storageAvailable', {
		value: formatBytes(storage.availableBytes)
	});
	const percent =
		storage.limitBytes > 0 ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;
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
		open.addEventListener(
			'click',
			() =>
				void checkpointWorkingCopy().then(() => {
					allowNextProjectOpen = true;
					send('dungeongen:project-open', { projectId: project.id });
				})
		);

		const actions = document.createElement('div');
		actions.className = 'project-actions';
		const print = document.createElement('button');
		print.type = 'button';
		print.className = 'ui-button icon-only project-print';
		print.innerHTML = icon('printer');
		setControlLabel(print, t('printProject'));
		print.addEventListener('click', () => void printProject(project));
		const rename = document.createElement('button');
		rename.type = 'button';
		rename.className = 'ui-button icon-only project-rename';
		rename.innerHTML = icon('pencil');
		setControlLabel(rename, `${t('renameProject')}: ${project.name}`);
		rename.addEventListener('click', () => openRenameProjectDialog(project));
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'ui-button danger icon-only project-delete';
		remove.innerHTML = icon('trash');
		setControlLabel(remove, t('deleteProject'));
		remove.addEventListener('click', () => {
			if (window.confirm(t('deleteConfirm', { name: project.name }))) {
				send('dungeongen:project-delete', { projectId: project.id });
			}
		});
		actions.append(print, rename, remove);
		card.append(preview, open, actions);
		elements.projectList.append(card);
	}
}

function renderStats() {
	elements.stats.replaceChildren();
	const stats = currentProject?.stats;
	if (!stats) return;
	for (const [label, value] of [
		['statRooms', stats.rooms],
		['statPassages', stats.passages],
		['statDoors', stats.doors],
		['statExits', stats.exits]
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
	const seedValue = elements.fields.seed.value.trim();
	return {
		size: elements.fields.size.value,
		symmetry: elements.fields.symmetry.value,
		cross: elements.fields.cross.value,
		pack: elements.fields.pack.value,
		roomSize: elements.fields.roomSize.value,
		water: elements.fields.water.value,
		seed: seedValue && seedValue !== generatedSeedValue ? seedValue : null,
		roundRooms: elements.fields.roundRooms.checked,
		halls: elements.fields.halls.checked,
		showNumbers: elements.fields.showNumbers.checked
	};
}

function writeParameters(parameters = {}) {
	for (const key of ['size', 'symmetry', 'cross', 'pack', 'roomSize', 'water']) {
		if (typeof parameters[key] === 'string') elements.fields[key].value = parameters[key];
	}
	generatedSeedValue = parameters.seed == null ? '' : String(parameters.seed);
	elements.fields.seed.value = generatedSeedValue;
	elements.fields.roundRooms.checked = parameters.roundRooms === true;
	elements.fields.halls.checked = parameters.halls !== false;
	elements.fields.showNumbers.checked = parameters.showNumbers !== false;
	syncAppSelects();
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
		if (!floor.has(cellKey([cell[0], cell[1] + 1])))
			path += `M${x + cellSize} ${y + cellSize}h-${cellSize}`;
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
		x,
		y,
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
	return { rock_small: 0.08, rock_medium: 0.135, rock_large: 0.21 }[type] ?? 0.135;
}

function rockShapePoints(object) {
	if (Array.isArray(object.shape) && object.shape.length >= 3) {
		return object.shape.map((point) => [Number(point[0]) * cellSize, Number(point[1]) * cellSize]);
	}
	const radius = Number(object.size) || defaultRockSize(object.type);
	const state = { value: fnv1a32(String(object.id ?? object.type)) };
	return Array.from({ length: 8 }, (_, index) => {
		const radiusVariation = xorshiftRandom(state) * 0.8 - 0.4;
		const angleVariation = xorshiftRandom(state) * 0.52 - 0.26;
		const angle = (index * Math.PI) / 4 + angleVariation;
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
	const rotation = (((Number(object.rotation) || 0) % 4) + 4) % 4;
	const group = svgElement('g', {
		class: `structure-object structure-object-${object.type} ${extraClass}`.trim(),
		transform: `rotate(${rotation * 90} ${cx} ${cy})`,
		'data-object-id': object.id ?? ''
	});

	if (object.type.startsWith('column_')) {
		const shadowAttrs =
			object.type === 'column_round'
				? { cx: cx + 6, cy: cy + 8, r: cellSize / 6 + 3, fill: appearance.shadow, stroke: 'none' }
				: {
						x: cx - cellSize / 6 + 6 - 3,
						y: cy - cellSize / 6 + 8 - 3,
						width: cellSize / 3 + 6,
						height: cellSize / 3 + 6,
						fill: appearance.shadow,
						stroke: 'none'
					};
		const shapeAttrs =
			object.type === 'column_round'
				? { cx, cy, r: cellSize / 6, fill: light, stroke: outline, 'stroke-width': 6 }
				: {
						x: cx - cellSize / 6,
						y: cy - cellSize / 6,
						width: cellSize / 3,
						height: cellSize / 3,
						fill: light,
						stroke: outline,
						'stroke-width': 6
					};
		group.append(
			svgElement(object.type === 'column_round' ? 'circle' : 'rect', shadowAttrs),
			svgElement(object.type === 'column_round' ? 'circle' : 'rect', shapeAttrs)
		);
	} else if (object.type.startsWith('rock_')) {
		group.append(
			svgElement('path', {
				d: rockPath(rockShapePoints(object), cx, cy),
				fill,
				stroke: outline,
				'stroke-width': 2,
				'stroke-linejoin': 'round'
			})
		);
	} else if (object.type === 'fountain') {
		const outerRadius = cellSize * 0.7;
		const waterRadius = outerRadius * 0.82;
		group.append(
			svgElement('circle', { cx, cy, r: outerRadius, fill, stroke: outline, 'stroke-width': 2 }),
			svgElement('circle', {
				cx,
				cy,
				r: waterRadius,
				fill: appearance.water,
				'fill-opacity': 0.39,
				stroke: appearance.water,
				'stroke-width': 1.5
			}),
			svgElement('circle', {
				cx,
				cy,
				r: waterRadius * 0.62,
				fill: 'none',
				stroke: appearance.water,
				'stroke-opacity': 0.78,
				'stroke-width': 0.8
			}),
			svgElement('circle', {
				cx,
				cy,
				r: outerRadius * 0.25,
				fill,
				stroke: outline,
				'stroke-width': 1
			})
		);
	} else if (object.type === 'dais') {
		const outerRadius = cellSize * 1.5;
		const innerRadius = outerRadius * 0.75;
		const flatY = cy - cellSize;
		group.append(
			svgElement('path', {
				d: `M${cx + outerRadius} ${flatY}A${outerRadius} ${outerRadius} 0 0 1 ${cx - outerRadius} ${flatY}Z`,
				fill,
				stroke: outline,
				'stroke-width': 2
			}),
			svgElement('path', {
				d: `M${cx + innerRadius} ${flatY}A${innerRadius} ${innerRadius} 0 0 1 ${cx - innerRadius} ${flatY}`,
				fill: 'none',
				stroke: outline,
				'stroke-width': 2
			})
		);
	} else if (object.type === 'coffin') {
		const x = cx - bounds.width * 0.35;
		const y = cy - bounds.height * 0.45;
		const width = bounds.width * 0.7;
		const height = bounds.height * 0.9;
		const insetX = width * 0.1;
		const insetY = height * 0.1;
		const outer = [
			[x + width / 2, y],
			[x + width, y + height / 6],
			[x + width, y + height * 0.75],
			[x + width / 2, y + height],
			[x, y + height * 0.75],
			[x, y + height / 6]
		];
		const inner = [
			[x + width / 2, y + insetY],
			[x + width - insetX, y + height / 6 + insetY],
			[x + width - insetX, y + height * 0.75 - insetY],
			[x + width / 2, y + height - insetY],
			[x + insetX, y + height * 0.75 - insetY],
			[x + insetX, y + height / 6 + insetY]
		];
		group.append(
			svgElement('path', {
				d: polygonPath(outer),
				fill: 'none',
				stroke: outline,
				'stroke-width': 2
			}),
			svgElement('path', {
				d: polygonPath(inner),
				fill: 'none',
				stroke: outline,
				'stroke-width': 1
			})
		);
	} else if (object.type === 'altar') {
		const x = cx - cellSize * 0.35;
		const y = cy - cellSize * 0.35;
		const width = cellSize * 0.3;
		const height = cellSize * 0.7;
		const dotX = x + width / 2;
		const dotY = y + height / 2;
		group.append(
			svgElement('rect', { x, y, width, height, fill, stroke: outline, 'stroke-width': 2 }),
			svgElement('circle', {
				cx: dotX,
				cy: dotY - height * 0.25,
				r: cellSize * 0.04,
				fill: outline,
				stroke: 'none'
			}),
			svgElement('circle', {
				cx: dotX,
				cy: dotY + height * 0.25,
				r: cellSize * 0.04,
				fill: outline,
				stroke: 'none'
			})
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
			group.append(
				svgElement('rect', {
					x: x - 1,
					y: cy - thickness / 2 - 1,
					width: cellSize + 2,
					height: thickness + 2,
					fill: appearance.floor,
					stroke: appearance.walls,
					'stroke-width': 4
				})
			);
		}
	} else if (collection === 'stairs') {
		const stepCount = 6;
		for (let index = 0; index < stepCount; index += 1) {
			const progress = index / (stepCount - 1);
			const widthRatio = 1 - progress * 0.85;
			const extension = progress < 0.5 ? cellSize * 0.03 * (1 - progress) : 0;
			const halfWidth = (cellSize * widthRatio) / 2 + extension;
			const stepY = y + cellSize * progress;
			group.append(
				svgElement('line', {
					x1: cx - halfWidth,
					y1: stepY,
					x2: cx + halfWidth,
					y2: stepY,
					stroke: '#000000',
					'stroke-width': 3,
					'stroke-linecap': 'butt'
				})
			);
		}
	} else {
		const width = cellSize * 0.58;
		const height = cellSize * 0.42;
		const left = cx - width / 2;
		const right = cx + width / 2;
		const shoulderY = cy - height * 0.55;
		const apexY = cy - height;
		const handleX = width * 0.28;
		const handleY = Math.abs(shoulderY - apexY) * 0.85;
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
	elements.structureMap.append(
		svgElement('rect', {
			class: 'structure-background',
			x: 0,
			y: 0,
			width,
			height,
			fill: appearance.background
		})
	);
	if (floorCells.length) {
		elements.structureMap.append(
			svgElement('path', {
				class: 'structure-floor',
				d: cellsPath(floorCells, structure.mapBounds),
				fill: appearance.floor,
				stroke: appearance.grid
			})
		);
	}
	if (structure.waterCells?.length) {
		elements.structureMap.append(
			svgElement('path', {
				class: 'structure-water',
				d: cellsPath(structure.waterCells, structure.mapBounds),
				fill: appearance.water
			})
		);
	}
	if (floorCells.length)
		elements.structureMap.append(
			svgElement('path', {
				class: 'structure-walls',
				d: boundaryPath(floorCells),
				stroke: appearance.walls
			})
		);
	for (const object of structure.objects ?? [])
		appendLightweightObject(elements.structureMap, object);
	for (const collection of ['doors', 'stairs', 'exits']) {
		for (const item of currentProject.layout?.[collection] ?? [])
			appendLightweightLayoutObject(elements.structureMap, collection, item);
	}
	if (currentProject.parameters?.showNumbers !== false) {
		for (const room of structure.rooms ?? []) {
			if (room.suppressed || !room.number || !room.cells?.length) continue;
			const centerX = room.cells.reduce((sum, cell) => sum + cell[0] + 0.5, 0) / room.cells.length;
			const centerY = room.cells.reduce((sum, cell) => sum + cell[1] + 0.5, 0) / room.cells.length;
			const [x, y] = mapPixel([centerX, centerY]);
			const number = svgElement('text', {
				class: 'structure-number',
				x,
				y,
				fill: appearance.numbers
			});
			number.textContent = String(room.number);
			elements.structureMap.append(number);
		}
	}
}

function removeLightweightObject(objectId) {
	const id = String(objectId ?? '');
	for (const element of elements.structureMap.querySelectorAll('[data-object-id]')) {
		if (element.getAttribute('data-object-id') === id) element.remove();
	}
}

function updateLightweightDecoration(operation) {
	if (elements.structureMap.hasAttribute('hidden') || !elements.structureMap.childElementCount)
		return;
	if (operation.type === 'eraseObject') {
		removeLightweightObject(operation.id);
		return;
	}
	if (operation.type !== 'placeObject') return;
	if (propTools.has(operation.objectType)) {
		const object = (currentProject?.structure?.objects ?? []).find(
			(item) => item.id === operation.objectId
		);
		if (object) appendLightweightObject(elements.structureMap, object);
		return;
	}
	const definition = layoutObjectDefinitions[operation.objectType];
	if (!definition) return;
	const [collection] = definition;
	const item = (currentProject?.layout?.[collection] ?? []).find(
		(value) => value.id === operation.objectId
	);
	if (item) appendLightweightLayoutObject(elements.structureMap, collection, item);
}

function updatePendingDecorationOverlay(operation) {
	if (elements.structureOverlay.hasAttribute('hidden')) return;
	const id = String(operation.type === 'placeObject' ? operation.objectId : operation.id);
	for (const element of elements.structureOverlay.querySelectorAll('[data-object-id]')) {
		if (element.getAttribute('data-object-id') === id) element.remove();
	}
	if (operation.type !== 'placeObject' || !pendingDecorationObjectIds.has(id)) return;
	if (propTools.has(operation.objectType)) {
		const object = (currentProject?.structure?.objects ?? []).find(
			(item) => String(item.id) === id
		);
		if (object)
			appendLightweightObject(elements.structureOverlay, object, 'structure-pending-decoration');
		return;
	}
	const definition = layoutObjectDefinitions[operation.objectType];
	if (!definition) return;
	const [collection] = definition;
	const item = (currentProject?.layout?.[collection] ?? []).find(
		(value) => String(value.id) === id
	);
	if (item)
		appendLightweightLayoutObject(
			elements.structureOverlay,
			collection,
			item,
			'structure-pending-decoration'
		);
}

function renderDecorationCommitState(operation) {
	updateLightweightDecoration(operation);
	updatePendingDecorationOverlay(operation);
	elements.statusText.textContent = statusLabel();
	elements.undoEdit.disabled = !undoStack.length || generating || editing;
	elements.redoEdit.disabled = !redoStack.length || generating || editing;
	renderStats();
	renderSpawnDiagnostics();
}

function renderWorkspace() {
	const hasReadyImage = Boolean(currentImageUrl && elements.mapImage.src);
	const structureActive = Boolean(
		currentProject?.structure && ((fastMode && workspaceView === 'structure') || !hasReadyImage)
	);
	elements.workspaceTabs.hidden = !fastMode || !currentProject?.structure;
	elements.structureTab.classList.toggle('active', structureActive);
	elements.previewTab.classList.toggle('active', fastMode && workspaceView === 'preview');
	elements.structureTab.setAttribute('aria-selected', String(structureActive));
	elements.previewTab.setAttribute(
		'aria-selected',
		String(fastMode && workspaceView === 'preview')
	);
	elements.structureMap.toggleAttribute('hidden', !structureActive);
	elements.mapImage.hidden = structureActive;
	elements.mapImageBuffer.hidden = true;
	elements.structureOverlay.toggleAttribute('hidden', structureActive);
	elements.mapSurface.classList.toggle('structure-view', structureActive);
	if (currentProject?.structure) elements.emptyWorkspace.hidden = true;
	if (structureActive) renderLightweightMap();
	else if (currentProject?.renderSvg && !elements.mapImage.src)
		setProjectImage(currentProject.renderSvg, false, true);
	syncEditOverlaySize();
}

function setProjectImage(
	svg,
	fitOnLoad = true,
	force = false,
	timing = null,
	appearance = currentProject?.appearance
) {
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

function zoom(multiplier, clientX = null, clientY = null) {
	const oldScale = scale;
	const nextScale = Math.max(0.1, Math.min(4, scale * multiplier));
	if (nextScale === oldScale) return;
	const canvasRect = elements.canvas.getBoundingClientRect();
	const focalX = clientX == null ? 0 : clientX - canvasRect.left - canvasRect.width / 2;
	const focalY = clientY == null ? 0 : clientY - canvasRect.top - canvasRect.height / 2;
	const scaleRatio = nextScale / oldScale;
	panX = focalX - (focalX - panX) * scaleRatio;
	panY = focalY - (focalY - panY) * scaleRatio;
	scale = nextScale;
	updateTransform();
}

function syncEditOverlaySize() {
	const { width, height } = workspaceDimensions();
	elements.mapSurface.style.width = `${width}px`;
	elements.mapSurface.style.height = `${height}px`;
	elements.structureOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
	elements.spawnOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
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
	const pixelX = ((event.clientX - rect.left) * dimensions.width) / rect.width;
	const pixelY = ((event.clientY - rect.top) * dimensions.height) / rect.height;
	const cell = [
		Math.floor((pixelX - canvasPadding) / cellSize + mapBounds[0]),
		Math.floor((pixelY - canvasPadding) / cellSize + mapBounds[1])
	];
	return cell[0] >= bounds[0] && cell[0] < bounds[2] && cell[1] >= bounds[1] && cell[1] < bounds[3]
		? cell
		: null;
}

function cellKey(cell) {
	return `${cell[0]},${cell[1]}`;
}

function keyCell(key) {
	return key.split(',').map(Number);
}

function spawnCellSet(values) {
	const result = new Set();
	for (const value of Array.isArray(values) ? values : []) {
		if (!Array.isArray(value) || value.length !== 2) continue;
		if (!Number.isInteger(value[0]) || !Number.isInteger(value[1])) continue;
		result.add(cellKey(value));
	}
	return result;
}

function buildProjectSpawnData(project = currentProject) {
	const structure = project?.structure;
	const mapBounds = structure?.mapBounds;
	if (
		!structure ||
		!Array.isArray(mapBounds) ||
		mapBounds.length !== 4 ||
		!mapBounds.every(Number.isInteger)
	)
		return null;
	const [minX, minY, maxX, maxY] = mapBounds;
	const cols = maxX - minX;
	const rows = maxY - minY;
	if (cols <= 0 || rows <= 0) return null;

	const floor = spawnCellSet(structure.floorCells);
	const decorReasons = new Map();
	const blockers = [];
	for (let index = 0; index < (structure.objects ?? []).length; index += 1) {
		const object = structure.objects[index];
		if (!object || typeof object.type !== 'string' || isNonBlockingSpawnDecor(object.type))
			continue;
		const cells = [...spawnCellSet(object.cells)]
			.map(keyCell)
			.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
		if (!cells.length) continue;
		const reason = `decor:${object.type}`;
		for (const cell of cells) {
			const key = cellKey(cell);
			if (!decorReasons.has(key)) decorReasons.set(key, new Set());
			decorReasons.get(key).add(reason);
		}
		blockers.push({
			id: index + 1,
			source: object.source === 'generated' || object.source === 'manual' ? object.source : 'decor',
			reason,
			shape: 'cells',
			objectId: String(object.id ?? ''),
			objectType: object.type,
			cells
		});
	}

	function analyze(col, row, size) {
		if (col < 0 || row < 0 || col + size > cols || row + size > rows)
			return { allowed: false, reasons: ['map-edge'] };
		const reasons = new Set();
		for (let localY = row; localY < row + size; localY += 1) {
			for (let localX = col; localX < col + size; localX += 1) {
				const key = cellKey([minX + localX, minY + localY]);
				if (!floor.has(key)) reasons.add('not-floor');
				for (const reason of decorReasons.get(key) ?? []) reasons.add(reason);
			}
		}
		const ordered = [...reasons].sort();
		return { allowed: ordered.length === 0, reasons: ordered };
	}

	const totalCount = cols * rows;
	const bySize = {};
	for (const size of spawnNpcSizes) {
		const anchors = [];
		let allowedCount = 0;
		for (let row = 0; row < rows; row += 1) {
			for (let col = 0; col < cols; col += 1) {
				const result = analyze(col, row, size);
				if (result.allowed) allowedCount += 1;
				anchors.push({ col, row, allowed: result.allowed, reasons: result.reasons });
			}
		}
		bySize[String(size)] = { sizeCells: size, allowedCount, totalCount, anchors };
	}

	const cells = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			const index = row * cols + col;
			let maxNpcSizeCells = 0;
			for (const size of spawnNpcSizes) {
				if (bySize[String(size)].anchors[index]?.allowed) maxNpcSizeCells = size;
			}
			const base = bySize['1'].anchors[index];
			cells.push({
				col,
				row,
				spawnable: Boolean(base?.allowed),
				reasons: base?.reasons ?? [],
				maxNpcSizeCells
			});
		}
	}

	const waterCells = [...spawnCellSet(structure.waterCells)]
		.map(keyCell)
		.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
	const seed = project?.parameters?.seed ?? project?.layout?.seed ?? '';
	return {
		version: 2,
		seed: seed == null ? '' : String(seed),
		biome: 'underdark',
		blockers,
		water: {
			features: waterCells.length
				? [
						{
							id: 'dungeongen-water',
							kind: 'cells',
							source: 'structure',
							width: 0,
							points: [],
							cells: waterCells
						}
					]
				: [],
			terrainPolygons: []
		},
		road: null,
		grid: {
			type: 'square',
			cols,
			rows,
			cellSizePx: defaultCellSize,
			cellSizeFeet: 5,
			anchorCount: totalCount
		},
		semantics: {
			anchor: 'top-left',
			footprint: 'square-cells',
			sizesCells: [...spawnNpcSizes],
			waterBlocksSpawn: false,
			note: 'For size 2x2 and larger, each anchor cell is the top-left cell of the square NPC footprint.'
		},
		cells,
		bySize
	};
}

function refreshProjectSpawnData(project = currentProject) {
	if (!project) return null;
	const spawnData = buildProjectSpawnData(project);
	project.spawnData = spawnData;
	return spawnData;
}

function selectedSpawnNpcSize() {
	const requested = Number(elements.spawnNpcSize?.value ?? 1);
	return spawnNpcSizes.includes(requested) ? requested : 1;
}

function renderSpawnOverlay() {
	elements.spawnOverlay.replaceChildren();
	if (!spawnOverlayVisible || !currentProject?.spawnData || !currentProject?.structure?.mapBounds)
		return;
	const size = String(selectedSpawnNpcSize());
	const anchors = currentProject.spawnData.bySize?.[size]?.anchors ?? [];
	const [minX, minY] = currentProject.structure.mapBounds;
	const allowed = [];
	const blocked = [];
	for (const anchor of anchors) {
		const target = anchor.allowed ? allowed : blocked;
		target.push([minX + anchor.col, minY + anchor.row]);
	}
	for (const [cells, className] of [
		[blocked, 'spawn-blocked'],
		[allowed, 'spawn-allowed']
	]) {
		if (!cells.length) continue;
		const path = svgElement('path', {
			d: cellsPath(cells, currentProject.structure.mapBounds),
			class: `spawn-cell ${className}`
		});
		elements.spawnOverlay.append(path);
	}
}

function renderSpawnDiagnostics() {
	const data =
		currentProject?.spawnData ?? (currentProject ? refreshProjectSpawnData(currentProject) : null);
	const enabled = Boolean(data);
	if (elements.spawnNpcSize) {
		elements.spawnNpcSize.disabled = !enabled;
		const appSelect = appSelectInstances.get(elements.spawnNpcSize);
		if (appSelect) syncAppSelect(appSelect);
	}
	if (elements.spawnOverlayToggle) elements.spawnOverlayToggle.disabled = !enabled;
	if (elements.spawnDownload) elements.spawnDownload.disabled = !enabled;
	if (!enabled) {
		if (elements.spawnSummary) elements.spawnSummary.textContent = t('spawnNoData');
		if (elements.spawnOverlayToggle) {
			elements.spawnOverlayToggle.textContent = t('spawnShow');
			elements.spawnOverlayToggle.classList.remove('active');
		}
		elements.spawnOverlay.replaceChildren();
		return;
	}
	const size = String(selectedSpawnNpcSize());
	const stat = data.bySize?.[size];
	const total = stat?.totalCount ?? data.grid?.anchorCount ?? 0;
	const percent = stat ? Math.round((stat.allowedCount / Math.max(1, total)) * 100) : 0;
	elements.spawnSummary.textContent = stat
		? t('spawnAvailable', { size, count: stat.allowedCount, total, percent })
		: t('spawnNoData');
	elements.spawnOverlayToggle.textContent = t(spawnOverlayVisible ? 'spawnHide' : 'spawnShow');
	elements.spawnOverlayToggle.classList.toggle('active', spawnOverlayVisible);
	renderSpawnOverlay();
}

function downloadSpawnData() {
	const data = refreshProjectSpawnData(currentProject);
	if (!data) return;
	const json = JSON.stringify(data, null, 2);
	const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const safeSeed = String(data.seed || 'map')
		.replace(/[^a-z0-9_-]+/gi, '-')
		.slice(0, 60);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `${data.biome}-${safeSeed}-spawn.json`;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
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
		if (doubled >= dy) {
			error += dy;
			x0 += sx;
		}
		if (doubled <= dx) {
			error += dx;
			y0 += sy;
		}
	}
	return result;
}

function rectangleCells(start, end) {
	const result = [];
	for (let y = Math.min(start[1], end[1]); y <= Math.max(start[1], end[1]); y += 1) {
		for (let x = Math.min(start[0], end[0]); x <= Math.max(start[0], end[0]); x += 1)
			result.push([x, y]);
	}
	return result;
}

function roundPreview(center, radius) {
	const bounds = currentProject.structure.bounds;
	const result = [];
	for (let y = center[1] - radius; y <= center[1] + radius; y += 1) {
		for (let x = center[0] - radius; x <= center[0] + radius; x += 1) {
			if (x < bounds[0] || x >= bounds[2] || y < bounds[1] || y >= bounds[3]) continue;
			if ((x - center[0]) ** 2 + (y - center[1]) ** 2 <= (radius + 0.5) ** 2) result.push([x, y]);
		}
	}
	return result;
}

function gestureCells(gesture, current, shiftKey = false) {
	if (gesture.tool === 'roundRoom') {
		const radius = Math.max(
			1,
			Math.abs(current[0] - gesture.start[0]),
			Math.abs(current[1] - gesture.start[1])
		);
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
	if (placementIndexCache.project === currentProject && placementIndexCache.value)
		return placementIndexCache.value;
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
	for (const [collection, kind] of [
		['doors', 'door'],
		['stairs', 'stairs'],
		['exits', 'exit']
	]) {
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
		floor,
		occupied,
		propAt,
		layoutAt,
		roomCells,
		water: new Set((structure?.waterCells ?? []).map(cellKey))
	};
	placementIndexCache.project = currentProject;
	placementIndexCache.value = value;
	return value;
}

function reusePlacementIndexAfterDecoration(previousProject, nextProject) {
	if (placementIndexCache.project !== previousProject || !placementIndexCache.value) return;
	const index = placementIndexCache.value;
	index.occupied = new Set();
	index.propAt = new Map();
	for (const object of nextProject?.structure?.objects ?? []) {
		for (const cell of object.cells ?? []) {
			const key = cellKey(cell);
			index.propAt.set(key, { targetKind: 'prop', id: object.id, cells: object.cells });
			if (!object.type.startsWith('rock_')) index.occupied.add(key);
		}
	}
	index.layoutAt = new Map();
	for (const [collection, kind] of [
		['doors', 'door'],
		['stairs', 'stairs'],
		['exits', 'exit']
	]) {
		for (const item of nextProject?.layout?.[collection] ?? []) {
			const key = cellKey([item.x, item.y]);
			const matches = index.layoutAt.get(key) ?? [];
			matches.push({ targetKind: kind, id: item.id, cells: [[item.x, item.y]] });
			index.layoutAt.set(key, matches);
		}
	}
	placementIndexCache.project = nextProject;
}

function layoutItemsAt(cell, index = placementIndex()) {
	return index.layoutAt.get(cellKey(cell)) ?? [];
}

function corridorDoorRotations(cell, index = placementIndex()) {
	const key = cellKey(cell);
	if (index.roomCells.has(key)) return [];
	const northSouth =
		index.floor.has(cellKey([cell[0], cell[1] - 1])) &&
		index.floor.has(cellKey([cell[0], cell[1] + 1]));
	const eastWest =
		index.floor.has(cellKey([cell[0] - 1, cell[1]])) &&
		index.floor.has(cellKey([cell[0] + 1, cell[1]]));
	return [...(northSouth ? [0, 2] : []), ...(eastWest ? [1, 3] : [])];
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
		return {
			cells: target?.cells ?? [cell],
			valid: Boolean(target),
			target,
			rotation: objectRotation
		};
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
			const rotation = rotations.includes(objectRotation)
				? objectRotation
				: (rotations[0] ?? objectRotation);
			return { cells, valid: rotations.length > 0, target: null, rotation };
		}
		if (valid && (tool === 'entrance' || tool === 'exit')) {
			const facing = [
				[0, -1],
				[1, 0],
				[0, 1],
				[-1, 0]
			][objectRotation];
			valid = !index.floor.has(cellKey([cell[0] + facing[0], cell[1] + facing[1]]));
		}
	}
	return { cells, valid, target: null, rotation: objectRotation };
}

function localId(prefix) {
	const id =
		globalThis.crypto?.randomUUID?.().replaceAll('-', '') ??
		`${Date.now()}${Math.random()}`.replace('.', '');
	return `${prefix}-${id.slice(0, 12)}`;
}

function currentPlacementObjectId() {
	if (!placementObjectId) placementObjectId = localId('manual');
	return placementObjectId;
}

function sameCell(left, right) {
	return (
		Boolean(left && right && left[0] === right[0] && left[1] === right[1]) || (!left && !right)
	);
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
			if (room.shape !== 'circle' || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= (width / 2) ** 2)
				result.push([x, y]);
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
			for (const neighbor of [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			]) {
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
		...template,
		kind,
		shape: kind === 'round' ? 'circle' : 'rect',
		x: Math.min(...xs),
		y: Math.min(...ys),
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
			: (raw.cells ?? []);
		const keys = new Set(sourceCells.map(cellKey).filter((key) => floor.has(key)));
		if (!keys.size) continue;
		const room = { ...raw, cells: sortedCells(keys) };
		(room.kind === 'auto' ? previousAuto : explicit).push(room);
	}

	const mergedExplicit = [];
	for (const room of explicit) {
		const roomKeys = cellSet(room.cells);
		const overlaps = mergedExplicit.filter((item) =>
			item.cells.some((cell) => roomKeys.has(cellKey(cell)))
		);
		if (!overlaps.length) {
			mergedExplicit.push(room);
			continue;
		}
		const candidates = [...overlaps, room];
		const target = candidates.reduce((best, item) =>
			(item.number || 513) < (best.number || 513) ? item : best
		);
		const combined = new Set(roomKeys);
		for (const item of overlaps) {
			for (const cell of item.cells) combined.add(cellKey(cell));
			mergedExplicit.splice(mergedExplicit.indexOf(item), 1);
		}
		mergedExplicit.push(
			roomFromCells(
				{
					...target,
					number: minimumPositiveNumber(candidates),
					suppressed: candidates.every((item) => item.suppressed),
					decorationCleared: true
				},
				combined,
				'merged'
			)
		);
	}

	const remainingAuto = [];
	for (const autoRoom of previousAuto) {
		const autoKeys = cellSet(autoRoom.cells);
		const overlaps = mergedExplicit.filter((room) =>
			room.cells.some((cell) => autoKeys.has(cellKey(cell)))
		);
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
		const target = candidates.reduce((best, item) =>
			(item.number || 513) < (best.number || 513) ? item : best
		);
		mergedExplicit.push(
			roomFromCells(
				{
					...target,
					number: minimumPositiveNumber(candidates),
					suppressed: candidates.every((item) => item.suppressed),
					decorationCleared: true
				},
				combined,
				'merged'
			)
		);
	}

	const explicitKeys = new Set(mergedExplicit.flatMap((room) => room.cells.map(cellKey)));
	const qualified = new Set();
	const bounds = structure.bounds;
	for (let y = bounds[1]; y <= bounds[3] - 4; y += 1) {
		for (let x = bounds[0]; x <= bounds[2] - 4; x += 1) {
			const window = rectangleCells([x, y], [x + 3, y + 3]).map(cellKey);
			if (window.every((key) => floor.has(key) && !explicitKeys.has(key)))
				window.forEach((key) => qualified.add(key));
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
			if (count > overlapCount) {
				previous = room;
				overlapCount = count;
			}
		}
		if (previous) usedPrevious.add(previous.id);
		const number = previous?.number || nextRoomNumber([...mergedExplicit, ...autoRooms]);
		autoRooms.push(
			roomFromCells(
				{
					id: previous?.id ?? localId('auto'),
					kind: 'auto',
					number,
					suppressed: previous?.suppressed === true,
					decorationCleared: true
				},
				keys,
				'auto'
			)
		);
	}
	structure.rooms = [...mergedExplicit, ...autoRooms];
	structure.nextRoomNumber = nextRoomNumber(structure.rooms);
}

function isDecorationOperation(operation) {
	return (
		operation?.type === 'placeObject' ||
		(operation?.type === 'eraseObject' && operation.targetKind !== 'water')
	);
}

function nextProjectStats(project, structure, layout) {
	return {
		...(project.stats ?? {}),
		rooms: (structure.rooms ?? []).filter((room) => !room.suppressed).length,
		doors: layout.doors?.length ?? 0,
		stairs: layout.stairs?.length ?? 0,
		exits: layout.exits?.length ?? 0
	};
}

function applyLocalDecorationOperation(project, operation) {
	const structure = project?.structure;
	const layout = project?.layout;
	if (!structure || !layout) return null;
	let nextStructure = structure;
	let nextLayout = layout;

	if (operation.type === 'placeObject') {
		const cells = objectFootprint(operation.objectType, operation.cell, operation.rotation);
		if (propTools.has(operation.objectType)) {
			const centered = [
				'fountain',
				'column_round',
				'column_square',
				'rock_small',
				'rock_medium',
				'rock_large'
			].includes(operation.objectType);
			const descriptor = {
				id: operation.objectId || localId('manual'),
				type: operation.objectType,
				x: operation.cell[0] + (centered ? 0.5 : 0),
				y: operation.cell[1] + (centered ? 0.5 : 0),
				rotation: operation.rotation,
				source: 'manual',
				cells
			};
			if (operation.objectType.startsWith('rock_')) {
				descriptor.size = Number(operation.size) || defaultRockSize(operation.objectType);
				descriptor.shape = Array.isArray(operation.shape)
					? operation.shape
					: rockShapePoints(descriptor).map((point) => point.map((value) => value / cellSize));
			}
			nextStructure = { ...structure, objects: [...(structure.objects ?? []), descriptor] };
		} else {
			const definition = layoutObjectDefinitions[operation.objectType];
			if (!definition) return null;
			const direction = ['north', 'east', 'south', 'west'][operation.rotation];
			const [collection, type] = definition;
			const item = {
				id: operation.objectId || localId('manual'),
				x: operation.cell[0],
				y: operation.cell[1],
				direction,
				type,
				manual: true
			};
			if (collection === 'doors') Object.assign(item, { roomId: '', passageId: '' });
			if (collection === 'stairs') item.passageId = '';
			if (collection === 'exits')
				Object.assign(item, { roomId: '', main: operation.objectType === 'entrance' });
			nextLayout = { ...layout, [collection]: [...(layout[collection] ?? []), item] };
		}
	} else if (operation.type === 'eraseObject') {
		if (operation.targetKind === 'prop') {
			nextStructure = {
				...structure,
				objects: (structure.objects ?? []).filter((item) => item.id !== operation.id)
			};
		} else {
			const collection = { door: 'doors', stairs: 'stairs', exit: 'exits' }[operation.targetKind];
			if (!collection) return null;
			nextLayout = {
				...layout,
				[collection]: (layout[collection] ?? []).filter((item) => item.id !== operation.id)
			};
		}
	} else return null;

	nextStructure = {
		...nextStructure,
		revision: Number(structure.revision ?? 0) + 1
	};
	return {
		...project,
		structure: nextStructure,
		layout: nextLayout,
		clientRevision: Number(project.clientRevision ?? 0) + 1,
		stats: nextProjectStats(project, nextStructure, nextLayout)
	};
}

function applyLocalOperation(project, operation) {
	if (isDecorationOperation(operation)) return applyLocalDecorationOperation(project, operation);
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
			structure.objects = (structure.objects ?? []).filter(
				(item) => !(item.cells ?? []).some((cell) => removed.has(cellKey(cell)))
			);
			structure.waterCells = (structure.waterCells ?? []).filter(
				(cell) => !removed.has(cellKey(cell))
			);
			structure.roundAreas = (structure.roundAreas ?? []).filter((area) =>
				roomGeometryCells(
					{ shape: 'circle', x: area.x, y: area.y, width: area.diameter, height: area.diameter },
					structure.bounds
				).some((cell) => floor.has(cellKey(cell)))
			);
			for (const collection of ['doors', 'stairs', 'exits'])
				layout[collection] = (layout[collection] ?? []).filter(
					(item) => !removed.has(cellKey([item.x, item.y]))
				);
		} else operation.cells.forEach((cell) => floor.add(cellKey(cell)));
	} else if (operation.type === 'roundRoom') {
		const radius = operation.radius;
		affected = roundPreview(operation.center, radius);
		affected.forEach((cell) => floor.add(cellKey(cell)));
		const descriptor = {
			id: localId('round'),
			kind: 'round',
			shape: 'circle',
			x: operation.center[0] - radius,
			y: operation.center[1] - radius,
			width: radius * 2 + 1,
			height: radius * 2 + 1,
			number: structure.nextRoomNumber,
			suppressed: false,
			decorationCleared: true,
			cells: affected
		};
		structure.rooms.push(descriptor);
		structure.roundAreas.push({
			id: descriptor.id,
			x: descriptor.x,
			y: descriptor.y,
			diameter: descriptor.width
		});
	} else if (operation.type === 'toggleRoom') {
		const key = cellKey(operation.cell);
		const room = (structure.rooms ?? [])
			.filter((item) => item.cells?.some((cell) => cellKey(cell) === key))
			.sort((a, b) => a.cells.length - b.cells.length)[0];
		if (!room) return null;
		room.suppressed = !room.suppressed;
	} else if (operation.type === 'placeObject') {
		const cells = objectFootprint(operation.objectType, operation.cell, operation.rotation);
		if (propTools.has(operation.objectType)) {
			const centered = [
				'fountain',
				'column_round',
				'column_square',
				'rock_small',
				'rock_medium',
				'rock_large'
			].includes(operation.objectType);
			const descriptor = {
				id: operation.objectId || localId('manual'),
				type: operation.objectType,
				x: operation.cell[0] + (centered ? 0.5 : 0),
				y: operation.cell[1] + (centered ? 0.5 : 0),
				rotation: operation.rotation,
				source: 'manual',
				cells
			};
			if (operation.objectType.startsWith('rock_')) {
				descriptor.size = Number(operation.size) || defaultRockSize(operation.objectType);
				descriptor.shape = Array.isArray(operation.shape)
					? operation.shape
					: rockShapePoints(descriptor).map((point) => point.map((value) => value / cellSize));
			}
			structure.objects.push(descriptor);
		} else {
			const direction = ['north', 'east', 'south', 'west'][operation.rotation];
			const definition = layoutObjectDefinitions[operation.objectType];
			const [collection, type] = definition;
			const item = {
				id: localId('manual'),
				x: operation.cell[0],
				y: operation.cell[1],
				direction,
				type,
				manual: true
			};
			if (collection === 'doors') Object.assign(item, { roomId: '', passageId: '' });
			if (collection === 'stairs') item.passageId = '';
			if (collection === 'exits')
				Object.assign(item, { roomId: '', main: operation.objectType === 'entrance' });
			layout[collection].push(item);
		}
	} else if (operation.type === 'eraseObject') {
		if (operation.targetKind === 'water')
			structure.waterCells = structure.waterCells.filter(
				(cell) => cellKey(cell) !== cellKey(operation.cell)
			);
		else if (operation.targetKind === 'prop')
			structure.objects = structure.objects.filter((item) => item.id !== operation.id);
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
			if (roomGeometryCells(room, structure.bounds).some((cell) => affectedKeys.has(cellKey(cell))))
				cleared.add(String(room.id));
		}
		structure.clearedDecorationRoomIds = [...cleared].filter(Boolean).sort();
		for (const room of structure.rooms ?? []) {
			if (room.cells?.some((cell) => affectedKeys.has(cellKey(cell))))
				room.decorationCleared = true;
		}
	}
	structure.floorCells = sortedCells(floor);
	reclassifyLocal(structure);
	structure.revision = Number(structure.revision ?? 0) + 1;
	next.clientRevision = Number(project.clientRevision ?? 0) + 1;
	next.stats = nextProjectStats(next, structure, layout);
	return next;
}

function structureNeedsRender(project = currentProject) {
	const structure = project?.structure;
	return Boolean(
		structure &&
			(!project?.renderSvg ||
				Number(structure.renderedRevision ?? 0) !== Number(structure.revision ?? 0))
	);
}

function cellsPath(cells, mapBounds) {
	return cells
		.map((cell) => {
			const x = canvasPadding + (cell[0] - mapBounds[0]) * cellSize;
			const y = canvasPadding + (cell[1] - mapBounds[1]) * cellSize;
			return `M${x} ${y}h${cellSize}v${cellSize}h-${cellSize}z`;
		})
		.join('');
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

function decorationObjectIds(project = currentProject) {
	const ids = new Set((project?.structure?.objects ?? []).map((object) => String(object.id)));
	for (const collection of ['doors', 'stairs', 'exits']) {
		for (const item of project?.layout?.[collection] ?? []) ids.add(String(item.id));
	}
	return ids;
}

function setRenderedDecorationObjects(project = currentProject) {
	renderedDecorationObjectIds.clear();
	for (const id of decorationObjectIds(project)) renderedDecorationObjectIds.add(id);
	pendingDecorationObjectIds.clear();
}

function refreshPendingDecorationObjects(project = currentProject) {
	pendingDecorationObjectIds.clear();
	for (const id of decorationObjectIds(project)) {
		if (!renderedDecorationObjectIds.has(id)) pendingDecorationObjectIds.add(id);
	}
}

function appendPendingDecorations() {
	if (!pendingDecorationObjectIds.size) return;
	const objects = new Map(
		(currentProject?.structure?.objects ?? []).map((object) => [String(object.id), object])
	);
	const layoutObjects = new Map();
	for (const collection of ['doors', 'stairs', 'exits']) {
		for (const item of currentProject?.layout?.[collection] ?? []) {
			layoutObjects.set(String(item.id), { collection, item });
		}
	}
	for (const id of pendingDecorationObjectIds) {
		const object = objects.get(id);
		if (object) {
			appendLightweightObject(elements.structureOverlay, object, 'structure-pending-decoration');
			continue;
		}
		const layoutObject = layoutObjects.get(id);
		if (layoutObject) {
			appendLightweightLayoutObject(
				elements.structureOverlay,
				layoutObject.collection,
				layoutObject.item,
				'structure-pending-decoration'
			);
		}
	}
}

function renderStructureOverlay() {
	elements.structureOverlay.replaceChildren();
	const structure = currentProject?.structure;
	if (!structure || !structureNeedsRender()) return;
	const currentFloor = new Set((structure.floorCells ?? []).map(cellKey));
	const renderedFloor = new Set(
		(structure.renderedFloorCells ?? structure.floorCells ?? []).map(cellKey)
	);
	const additions = [...currentFloor].filter((key) => !renderedFloor.has(key)).map(keyCell);
	const removals = [...renderedFloor].filter((key) => !currentFloor.has(key)).map(keyCell);
	const appearance = normalizeAppearance(currentProject.appearance);
	appendStructurePath(additions, 'structure-pending-add', appearance.floor, appearance.walls);
	appendStructurePath(
		removals,
		'structure-pending-remove',
		appearance.background,
		appearance.walls
	);
	appendStructurePath(
		[...pendingClassificationCells].map(keyCell),
		'structure-pending-class',
		'',
		''
	);
	appendPendingDecorations();
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
	if (
		(propTools.has(tool) || layoutTools.has(tool) || tool === 'eraser') &&
		hoveredCell &&
		!cells.length
	) {
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
	const stateClass =
		previewValidity == null ? '' : previewValidity ? ' placement-valid' : ' placement-invalid';
	path.setAttribute('class', `edit-preview-cell ${tool}${stateClass}`);
	elements.editOverlay.append(path);
	if (hoveredCell && placement && (propTools.has(tool) || layoutTools.has(tool))) {
		const objectClass = `edit-preview-object${placement.valid ? '' : ' placement-invalid'}`;
		if (propTools.has(tool)) {
			const object = {
				id: currentPlacementObjectId(),
				type: tool,
				cells: objectFootprint(tool, hoveredCell, placement.rotation),
				rotation: placement.rotation
			};
			if (tool.startsWith('rock_')) {
				object.size = defaultRockSize(tool);
				object.shape = rockShapePoints(object).map((point) =>
					point.map((value) => value / cellSize)
				);
			}
			appendLightweightObject(elements.editOverlay, object, objectClass);
		} else {
			const [collection, type] = layoutObjectDefinitions[tool];
			appendLightweightLayoutObject(
				elements.editOverlay,
				collection,
				{
					x: hoveredCell[0],
					y: hoveredCell[1],
					type,
					direction: ['north', 'east', 'south', 'west'][placement.rotation],
					main: tool === 'entrance'
				},
				objectClass
			);
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
		style.textContent =
			'.structure-object{fill:rgba(216,139,53,.18);stroke:#1c0919;stroke-width:3}.structure-layout-object{fill:none;stroke-width:4}.structure-number{dominant-baseline:central;text-anchor:middle;font:700 30px Georgia,serif;paint-order:stroke;stroke:rgba(255,255,255,.72);stroke-width:4px}';
		lightweight.prepend(style);
		temporaryUrl = URL.createObjectURL(
			new Blob([new XMLSerializer().serializeToString(lightweight)], {
				type: 'image/svg+xml;charset=utf-8'
			})
		);
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
	const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.58));
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

async function renderCanonicalProject(
	projectId,
	revision,
	clientRevision,
	sequence,
	persistPreview = false
) {
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
			sequence !== canonicalRenderSequence ||
			currentProjectId !== projectId ||
			Number(currentProject?.structure?.revision ?? -1) !== revision ||
			Number(currentProject?.clientRevision ?? -1) !== clientRevision
		)
			return false;
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
			!imageReady ||
			sequence !== canonicalRenderSequence ||
			currentProjectId !== projectId ||
			Number(currentProject?.structure?.revision ?? -1) !== revision ||
			Number(currentProject?.clientRevision ?? -1) !== clientRevision
		)
			return false;
		currentProject = nextProject;
		pendingClassificationCells.clear();
		setRenderedDecorationObjects(nextProject);
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

function scheduleCanonicalRender(delay = canonicalRenderDelayMs) {
	if (fastMode && workspaceView === 'structure') return;
	if (!currentProjectId || !currentProject?.structure || !structureNeedsRender()) return;
	if (canonicalRenderTimer) clearTimeout(canonicalRenderTimer);
	const projectId = currentProjectId;
	const revision = Number(currentProject.structure.revision ?? 0);
	const clientRevision = Number(currentProject.clientRevision ?? 0);
	const sequence = ++canonicalRenderSequence;
	canonicalRenderTimer = setTimeout(
		() => {
			canonicalRenderTimer = null;
			if (sequence !== canonicalRenderSequence || currentProjectId !== projectId) return;
			if (editing || generating) {
				scheduleCanonicalRender(delay);
				return;
			}
			const needsPreview = !hostState.projects?.find((project) => project.id === projectId)
				?.previewUrl;
			void renderCanonicalProject(projectId, revision, clientRevision, sequence, needsPreview);
		},
		Math.max(0, Number(delay) || 0)
	);
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
	refreshProjectSpawnData(currentProject);
	refreshPendingDecorationObjects();
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
	const decorationOperation = isDecorationOperation(operation);
	if (operation.type === 'placeObject' && !operation.objectId)
		operation.objectId = currentPlacementObjectId();
	const requestId = newEditRequestId();
	const totalStartedAt = performance.now();
	const timing = (stage, elapsedMs) => logEditTime(requestId, stage, elapsedMs);
	const previous = decorationOperation ? currentProject : cloneProject();
	const startedAt = performance.now();
	const next = applyLocalOperation(currentProject, operation);
	if (!next) {
		localStatus = 'errorEditFailed';
		renderAll();
		return;
	}
	refreshProjectSpawnData(next);
	currentProject = next;
	if (decorationOperation) reusePlacementIndexAfterDecoration(previous, next);
	if (operation.type === 'toggleRoom' && Array.isArray(operation.cell))
		pendingClassificationCells.add(cellKey(operation.cell));
	if (decorationOperation) refreshPendingDecorationObjects();
	pushHistory(previous);
	writeParameters(currentProject.parameters);
	writeAppearance(currentProject.appearance, { preservePaletteSelection: true });
	timing('client_operation', performance.now() - startedAt);
	localStatus = 'statusUnsaved';
	markWorkingCopyDirty(
		decorationOperation ? Math.min(canonicalRenderDelayMs, 750) : canonicalRenderDelayMs
	);
	renderEditPreview();
	if (decorationOperation) renderDecorationCommitState(operation);
	else renderAll();
	timing('browser_total', performance.now() - totalStartedAt);
}

let loadingProgress = 0;
let loadingStartedAt = 0;
let loadingCycle = 0;
let loadingHideTimer = null;
let generationProgressTimer = null;

function setLoadingProgress(value) {
	loadingProgress = Math.max(loadingProgress, Math.max(0, Math.min(100, Math.round(value))));
	elements.loadingProgress.value = loadingProgress;
	elements.loadingProgressValue.textContent = `${loadingProgress}%`;
}

function showLoading(labelKey, progress = 0) {
	if (loadingHideTimer) clearTimeout(loadingHideTimer);
	loadingCycle += 1;
	loadingStartedAt = performance.now();
	loadingProgress = 0;
	elements.loadingLabel.textContent = t(labelKey);
	setLoadingProgress(progress);
	elements.loading.hidden = false;
}

function hideLoading() {
	const cycle = loadingCycle;
	setLoadingProgress(100);
	const minimumVisible = Math.max(0, 420 - (performance.now() - loadingStartedAt));
	if (loadingHideTimer) clearTimeout(loadingHideTimer);
	loadingHideTimer = setTimeout(
		() => {
			if (cycle === loadingCycle) elements.loading.hidden = true;
		},
		Math.max(180, minimumVisible)
	);
}

function startGenerationProgress() {
	if (generationProgressTimer) clearInterval(generationProgressTimer);
	generationProgressTimer = setInterval(() => {
		if (loadingProgress >= 68) return;
		const increment = loadingProgress < 30 ? 3 : loadingProgress < 50 ? 2 : 1;
		setLoadingProgress(Math.min(68, loadingProgress + increment));
	}, 280);
}

function stopGenerationProgress() {
	if (!generationProgressTimer) return;
	clearInterval(generationProgressTimer);
	generationProgressTimer = null;
}

async function initializeProjectStructure() {
	if (
		!capability ||
		!currentProjectId ||
		!currentProject?.renderSvg ||
		!currentProject?.layout ||
		editing
	)
		return;
	const needsStructure = !currentProject.structure;
	const needsObjects = currentProject.structure && !currentProject.structure.objectsInitialized;
	if (!needsStructure && !needsObjects) return;
	const projectId = currentProjectId;
	const project = cloneProject();
	editing = true;
	localStatus = 'statusEditing';
	showLoading('preparingEditor', 12);
	setLoadingProgress(36);
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
		setRenderedDecorationObjects(currentProject);
		setProjectImage(currentProject.renderSvg, false);
		workingCopyDirty = true;
		void persistWorkingDraft();
		localStatus = 'statusUnsaved';
		await checkpointWorkingCopy();
		setLoadingProgress(98);
	} catch {
		if (currentProjectId === projectId) localStatus = 'errorEditFailed';
	} finally {
		editing = false;
		hideLoading();
		renderAll();
		if (currentProjectId === projectId && needsStructure) void initializeProjectStructure();
		else if (structureNeedsRender()) scheduleCanonicalRender();
	}
}

async function generate() {
	if (!currentProjectId || generating) return;
	cancelCanonicalRender();
	pendingClassificationCells.clear();
	pendingDecorationObjectIds.clear();
	renderedDecorationObjectIds.clear();
	if (appearanceUpdateTimer) {
		clearTimeout(appearanceUpdateTimer);
		appearanceUpdateTimer = null;
		if (currentProject?.renderSvg)
			currentProject.appearance = normalizeAppearance(readAppearance());
	}
	pendingAppearanceSnapshot = null;
	generating = true;
	localStatus = 'statusGenerating';
	showLoading('generating', 4);
	startGenerationProgress();
	renderAll();
	try {
		const response = await fetch('/api/dungeongen/editor/generate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Dungeongen-Capability': capability
			},
			body: JSON.stringify({ parameters: readParameters(), deferRender: true })
		});
		setLoadingProgress(72);
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'generationFailed');
		setLoadingProgress(78);
		const previousClientRevision = Number(currentProject?.clientRevision ?? 0);
		currentProject = {
			...payload.project,
			appearance: normalizeAppearance(currentProject?.appearance),
			clientRevision: previousClientRevision + 1
		};
		if (structureNeedsRender(currentProject)) refreshPendingDecorationObjects();
		else setRenderedDecorationObjects(currentProject);
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		setLoadingProgress(84);
		workingCopyDirty = true;
		void persistWorkingDraft();
		setProjectImage(currentProject.renderSvg);
		resetHistory();
		fitMap();
		setLoadingProgress(92);
		localStatus = 'statusSaving';
		renderAll();
		await checkpointWorkingCopy();
		setLoadingProgress(98);
	} catch {
		localStatus = 'errorGenerationFailed';
	} finally {
		stopGenerationProgress();
		generating = false;
		hideLoading();
		renderAll();
		if (structureNeedsRender()) scheduleCanonicalRender();
	}
}

async function openProject(message) {
	cancelCanonicalRender();
	pendingClassificationCells.clear();
	pendingDecorationObjectIds.clear();
	renderedDecorationObjectIds.clear();
	cancelScheduledDraftPersist();
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = null;
	resetHistory();
	workingCopyDirty = false;
	pendingHostSaveRevision = null;
	renderEditPreview();
	localStatus = 'statusLoading';
	showLoading('statusLoading', 8);
	currentProjectId = String(message.projectId ?? '');
	const openingProjectId = currentProjectId;
	currentProjectName = String(message.name ?? '');
	try {
		const serverProject =
			message.projectData && typeof message.projectData === 'object'
				? cloneProject(message.projectData)
				: JSON.parse(base64ToUtf8(String(message.projectBase64 ?? '')));
		setLoadingProgress(38);
		setRenderedDecorationObjects(serverProject);
		currentProject = serverProject;
		const draft = await readWorkingDraft(currentProjectId);
		if (currentProjectId !== openingProjectId) return;
		if (
			draft?.project?.formatVersion === serverProject.formatVersion &&
			Number(draft.clientRevision ?? 0) > Number(serverProject.clientRevision ?? 0)
		) {
			currentProject = { ...draft.project, renderSvg: serverProject.renderSvg ?? null };
			workingCopyDirty = true;
			localStatus = 'statusDraftRecovered';
		} else if (draft) {
			void deleteWorkingDraft(currentProjectId);
		}
		refreshPendingDecorationObjects();
		setLoadingProgress(68);
		currentProject.appearance = normalizeAppearance(currentProject.appearance);
		refreshProjectSpawnData(currentProject);
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		setProjectImage(currentProject.renderSvg);
		setLoadingProgress(92);
		if (!workingCopyDirty) localStatus = '';
	} catch {
		currentProject = null;
		pendingDecorationObjectIds.clear();
		renderedDecorationObjectIds.clear();
		setProjectImage(null);
		localStatus = 'errorGeneric';
	}
	renderAll();
	hideLoading();
	if (currentProject?.structure) fitMap();
	void initializeProjectStructure();
	if (workingCopyDirty) scheduleWorkingCopyCheckpoint();
	if (structureNeedsRender()) scheduleCanonicalRender();
}

function applyHostState(next) {
	const previousThemes = JSON.stringify(hostState.customThemes ?? []);
	hostState = { ...hostState, ...(next ?? {}) };
	capability = typeof hostState.capability === 'string' ? hostState.capability : capability;
	if (hostState.statusCode || hostState.errorCode) localStatus = '';
	if (hostState.theme === 'light' || hostState.theme === 'dark') {
		applyTheme(hostState.theme, { persist: false });
	}
	if (hostState.statusCode === 'saved' && !hostState.errorCode) acknowledgeHostSave();
	if (JSON.stringify(hostState.customThemes ?? []) !== previousThemes) {
		if (selectedCustomThemeId && !selectedCustomPreset()) selectedCustomThemeId = null;
		renderColorPresetOptions();
	}
	renderAll();
	void initializeProjectStructure();
}

function activateTool(name) {
	if (!currentProjectId && !alwaysAvailablePanels.has(name)) return;
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

if (elements.spawnNpcSize) {
	elements.spawnNpcSize.addEventListener('change', () => renderSpawnDiagnostics());
}
if (elements.spawnOverlayToggle) {
	elements.spawnOverlayToggle.addEventListener('click', () => {
		spawnOverlayVisible = !spawnOverlayVisible;
		renderSpawnDiagnostics();
	});
}
if (elements.spawnDownload) elements.spawnDownload.addEventListener('click', downloadSpawnData);
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
	try {
		localStorage.setItem(fastModeStorageKey, String(enabled));
	} catch {}
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

function nextThemeRequestId() {
	return (
		globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}

function savePaletteTheme() {
	if (!currentProject?.structure || themeSaving) return;
	const name = elements.paletteName.value.trim();
	if (!name) {
		themeStatusKey = 'paletteThemeNameRequired';
		themeStatusError = true;
		renderPaletteThemeControls();
		elements.paletteName.focus();
		return;
	}
	themeSaving = true;
	themeStatusKey = 'paletteThemeSaving';
	themeStatusError = false;
	pendingThemeRequestId = nextThemeRequestId();
	logThemeSave(pendingThemeRequestId, 'editor_send', {
		operation: selectedCustomThemeId ? 'update' : 'create',
		timeoutMs: themeSaveTimeoutMs
	});
	send('dungeongen:theme-save', {
		requestId: pendingThemeRequestId,
		themeId: selectedCustomThemeId,
		name,
		colors: normalizeAppearance(readAppearance()),
		debug: themeSaveLogging,
		timeoutMs: themeSaveTimeoutMs
	});
	armThemeRequestTimeout('save');
	renderPaletteThemeControls();
}

function deletePaletteTheme() {
	const preset = selectedCustomPreset();
	if (!preset || themeSaving) return;
	if (!window.confirm(t('paletteDeleteConfirm', { name: preset.name }))) return;
	themeSaving = true;
	themeStatusKey = 'paletteThemeSaving';
	themeStatusError = false;
	pendingThemeRequestId = nextThemeRequestId();
	logThemeSave(pendingThemeRequestId, 'editor_send', {
		operation: 'delete',
		timeoutMs: themeSaveTimeoutMs
	});
	send('dungeongen:theme-delete', {
		requestId: pendingThemeRequestId,
		themeId: preset.id,
		debug: themeSaveLogging,
		timeoutMs: themeSaveTimeoutMs
	});
	armThemeRequestTimeout('delete');
	renderPaletteThemeControls();
}

function replaceHostTheme(theme) {
	const themes = Array.isArray(hostState.customThemes) ? hostState.customThemes : [];
	const exists = themes.some((item) => item?.id === theme.id);
	hostState.customThemes = exists
		? themes.map((item) => (item?.id === theme.id ? theme : item))
		: [...themes, theme];
}

function handleThemeSaved(message) {
	if (!pendingThemeRequestId || message.requestId !== pendingThemeRequestId || !message.theme)
		return;
	logThemeSave(pendingThemeRequestId, 'editor_success', { operation: 'save' });
	clearThemeRequestTimeout();
	pendingThemeRequestId = '';
	themeSaving = false;
	replaceHostTheme(message.theme);
	selectedCustomThemeId = message.theme.id;
	elements.paletteName.value = message.theme.name;
	themeStatusKey = 'paletteThemeSaved';
	themeStatusError = false;
	renderColorPresetOptions();
	renderAll();
}

function handleThemeDeleted(message) {
	if (!pendingThemeRequestId || message.requestId !== pendingThemeRequestId) return;
	logThemeSave(pendingThemeRequestId, 'editor_success', { operation: 'delete' });
	clearThemeRequestTimeout();
	pendingThemeRequestId = '';
	themeSaving = false;
	hostState.customThemes = (hostState.customThemes ?? []).filter(
		(theme) => theme?.id !== message.themeId
	);
	selectedCustomThemeId = null;
	setPaletteNameFromAppearance(readAppearance());
	themeStatusKey = 'paletteThemeDeleted';
	themeStatusError = false;
	renderColorPresetOptions();
	renderAll();
}

function handleThemeFailure(message, operation) {
	if (!pendingThemeRequestId || message.requestId !== pendingThemeRequestId) return;
	logThemeSave(pendingThemeRequestId, 'editor_failure', {
		operation,
		error: String(message.error ?? 'saveFailed')
	});
	clearThemeRequestTimeout();
	pendingThemeRequestId = '';
	themeSaving = false;
	themeStatusKey = themeErrorKey(String(message.error ?? ''), operation);
	themeStatusError = true;
	renderPaletteThemeControls();
}

elements.createProjectForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const name = elements.newProjectName.value.trim() || t('productTitle');
	void checkpointWorkingCopy().then(() => {
		allowNextProjectOpen = true;
		send('dungeongen:project-create', { name });
	});
	elements.newProjectName.value = '';
});
elements.fields.seed.addEventListener('input', () => {
	generatedSeedValue = '';
});
elements.renameProjectForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const project = renameProjectCandidate;
	const name = elements.renameProjectName.value.trim();
	if (!project || !name) return;
	if (name !== project.name) send('dungeongen:project-rename', { projectId: project.id, name });
	closeRenameProjectDialog();
});
document.querySelectorAll('[data-rename-close]').forEach((button) => {
	button.addEventListener('click', closeRenameProjectDialog);
});
elements.renameProjectDialog.addEventListener('close', () => {
	renameProjectCandidate = null;
});
elements.renameProjectDialog.addEventListener('click', (event) => {
	if (event.target === elements.renameProjectDialog) closeRenameProjectDialog();
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
elements.paletteSave.addEventListener('click', savePaletteTheme);
elements.paletteDelete.addEventListener('click', deletePaletteTheme);
elements.paletteName.addEventListener('input', () => {
	themeStatusKey = '';
	themeStatusError = false;
	renderPaletteThemeControls();
});
elements.paletteName.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter') return;
	event.preventDefault();
	savePaletteTheme();
});
for (const input of Object.values(elements.colors))
	input.addEventListener('input', () => {
		syncColorPreset(readAppearance());
		scheduleAppearanceUpdate();
	});
async function saveCurrentProject() {
	if (!currentProjectId || !currentProject?.structure) return;
	localStatus = 'statusSaving';
	renderAll();
	if (!(await checkpointWorkingCopy())) return;
	if (!(await ensureCanonicalProject({ persistPreview: false }))) return;
	await autosaveCurrent(null, true);
}

async function exportCurrentProject() {
	if (!currentProjectId || !currentProject?.structure) return;
	localStatus = 'statusExporting';
	renderAll();
	if (!(await ensureCanonicalProject({ persistPreview: false }))) return;
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
}

async function printProject(project) {
	if (project.id !== currentProjectId) {
		send('dungeongen:print', {
			projectId: project.id,
			name: project.name,
			gridSizePixels: cellSize
		});
		return;
	}
	if (!currentProject?.structure) return;
	if (!(await checkpointWorkingCopy())) return;
	if (!(await ensureCanonicalProject({ persistPreview: false }))) return;
	await elements.mapImage.decode().catch(() => undefined);
	const previewBase64 = await makePreviewBase64();
	send('dungeongen:print', {
		projectId: currentProjectId,
		name: project.name,
		projectData: compactProject(currentProject),
		previewBase64,
		gridSizePixels: cellSize
	});
}

elements.saveProject.addEventListener('click', () => void saveCurrentProject());
elements.exportProject.addEventListener('click', () => void exportCurrentProject());
elements.exportButton.addEventListener('click', () => void exportCurrentProject());
elements.backButton.addEventListener(
	'click',
	() => void checkpointWorkingCopy().then(() => send('dungeongen:back'))
);
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
elements.canvas.addEventListener(
	'wheel',
	(event) => {
		event.preventDefault();
		zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
	},
	{ passive: false }
);
elements.canvas.addEventListener('pointerdown', (event) => {
	if (activePanel === 'editing' && canEditMap() && event.button === 0) {
		const cell = eventCell(event);
		if (!cell) return;
		event.preventDefault();
		editGesture = {
			tool: activeTool,
			start: cell,
			current: cell,
			last: cell,
			shift: event.shiftKey,
			cells: new Set([cellKey(cell)]),
			pointerId: event.pointerId,
			objectId:
				propTools.has(activeTool) || layoutTools.has(activeTool) ? currentPlacementObjectId() : ''
		};
		elements.canvas.setPointerCapture(event.pointerId);
		hoveredCell = cell;
		if (propTools.has(activeTool) || layoutTools.has(activeTool) || activeTool === 'eraser')
			renderEditPreview();
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
		if (
			cellChanged &&
			(editGesture.tool === 'wall' ||
				editGesture.tool === 'corridor' ||
				editGesture.tool === 'waterBrush')
		) {
			for (const pathCell of lineCells(editGesture.last, cell))
				editGesture.cells.add(cellKey(pathCell));
		}
		editGesture.last = cell;
		editGesture.current = cell;
		editGesture.shift = event.shiftKey;
		hoveredCell = cell;
		if (
			propTools.has(editGesture.tool) ||
			layoutTools.has(editGesture.tool) ||
			editGesture.tool === 'eraser'
		)
			queueEditPreview();
		else queueEditPreview(gestureCells(editGesture, cell, event.shiftKey), editGesture.tool);
		return;
	}
	if (activePanel === 'editing' && canEditMap()) {
		const cell = eventCell(event);
		if (!sameCell(cell, hoveredCell)) {
			hoveredCell = cell;
			if (propTools.has(activeTool) || layoutTools.has(activeTool) || activeTool === 'eraser')
				queueEditPreview();
			else
				queueEditPreview(
					cell ? (activeTool === 'roundRoom' ? roundPreview(cell, 1) : [cell]) : [],
					activeTool
				);
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
		if (elements.canvas.hasPointerCapture(event.pointerId))
			elements.canvas.releasePointerCapture(event.pointerId);
		hoveredCell = current;
		if (gesture.tool === 'wall' || gesture.tool === 'corridor') {
			renderEditPreview(cells, gesture.tool);
			void commitStructure({ type: 'paint', mode: gesture.tool, cells });
		} else if (gesture.tool === 'roundRoom') {
			renderEditPreview(cells, gesture.tool);
			const radius = Math.max(
				1,
				Math.abs(current[0] - gesture.start[0]),
				Math.abs(current[1] - gesture.start[1])
			);
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
					type: 'placeObject',
					objectType: gesture.tool,
					cell: current,
					rotation: placement.rotation,
					objectId: gesture.objectId || currentPlacementObjectId()
				};
				if (gesture.tool.startsWith('rock_')) {
					operation.size = defaultRockSize(gesture.tool);
					operation.shape = rockShapePoints({
						id: operation.objectId,
						type: gesture.tool,
						size: operation.size
					}).map((point) => point.map((value) => value / cellSize));
				}
				placementObjectId = '';
				void commitStructure(operation);
			} else localStatus = 'invalidPlacement';
		}
		if (localStatus === 'invalidPlacement') elements.statusText.textContent = statusLabel();
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
	if (
		target instanceof HTMLElement &&
		(target.matches(
			'textarea, select, input:not([type="color"]), .app-select-trigger, .app-select-option'
		) ||
			target.isContentEditable)
	)
		return;
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
	if (
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		rotatableTools.has(activeTool) &&
		activePanel === 'editing'
	) {
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
	if (!openAppSelect) return;
	if (openAppSelect.root.contains(event.target) || openAppSelect.menu.contains(event.target))
		return;
	closeAppSelect(openAppSelect);
});
document.addEventListener(
	'scroll',
	() => openAppSelect && positionAppSelectMenu(openAppSelect),
	true
);
window.addEventListener('resize', () => openAppSelect && positionAppSelectMenu(openAppSelect));

document.addEventListener('pointerdown', (event) => {
	if (
		paletteMenuOpen &&
		!elements.palettePresetButton.contains(event.target) &&
		!elements.palettePresetMenu.contains(event.target)
	) {
		closeColorPresetMenu();
	}
});
window.addEventListener('resize', () => currentProject?.structure && fitMap());
window.addEventListener('pagehide', () => {
	if (!workingCopyDirty) return;
	cancelScheduledDraftPersist();
	void persistWorkingDraft();
	void checkpointWorkingCopy();
});
window.addEventListener('message', (event) => {
	if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
	if (event.data.type === 'dungeongen:host-state') {
		void loadLocale(String(event.data.locale ?? fallbackLocale));
		applyHostState({ ...event.data.state, theme: event.data.theme });
	}
	if (event.data.type === 'dungeongen:open' && allowNextProjectOpen) {
		allowNextProjectOpen = false;
		void openProject(event.data);
	}
	if (event.data.type === 'dungeongen:theme-saved') handleThemeSaved(event.data);
	if (event.data.type === 'dungeongen:theme-deleted') handleThemeDeleted(event.data);
	if (event.data.type === 'dungeongen:theme-save-failed') handleThemeFailure(event.data, 'save');
	if (event.data.type === 'dungeongen:theme-delete-failed')
		handleThemeFailure(event.data, 'delete');
});

void Promise.all([loadEditorConfig(), loadColorPresets(), loadLocale(fallbackLocale)]).then(() => {
	initializeAppSelects();
	renderColorPresetOptions();
	if (periodicCheckpointTimer) clearInterval(periodicCheckpointTimer);
	periodicCheckpointTimer = setInterval(() => {
		if (workingCopyDirty) void checkpointWorkingCopy();
	}, workingCopyIntervalMs);
	renderSideFire();
	renderAll();
	send('dungeongen:ready');
});
