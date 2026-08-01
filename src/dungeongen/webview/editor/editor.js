const fallbackLocale = 'ru';
const editorAssetVersion = '20260801-3';
const defaultColorApplyDelayMs = 350;
const defaultEditPreviewDelayMs = 1000;
const cellSize = 64;
const canvasPadding = cellSize * 2;
const maxHistoryEntries = 20;
const editingTools = new Set(['wall', 'corridor', 'roundRoom', 'roomClass']);
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
let previewUpdateTimer = null;
let colorApplyDelayMs = defaultColorApplyDelayMs;
let editPreviewDelayMs = defaultEditPreviewDelayMs;
let editTimeLogging = false;
let fitImageOnLoad = true;

const elements = {
	canvas: document.getElementById('canvas'),
	mapSurface: document.getElementById('mapSurface'),
	mapImage: document.getElementById('mapImage'),
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
		const previewDelay = Number(config?.editPreviewDelayMs);
		if (Number.isFinite(previewDelay)) editPreviewDelayMs = Math.max(0, Math.min(10000, Math.round(previewDelay)));
		editTimeLogging = config?.editTimeLogging === true;
	} catch {
		colorApplyDelayMs = defaultColorApplyDelayMs;
		editPreviewDelayMs = defaultEditPreviewDelayMs;
		editTimeLogging = false;
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
		export: 'toolExport', about: 'toolAbout'
	};
	document.querySelectorAll('[data-tool-button]').forEach((button) => {
		const text = t(toolLabels[button.dataset.toolButton]);
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
	renderEditingTool();
}

function renderEditingTool() {
	const content = {
		wall: ['wallTitle', 'wallHint'],
		corridor: ['corridorTitle', 'corridorHint'],
		roundRoom: ['roundRoomTitle', 'roundRoomHint'],
		roomClass: ['roomClassTitle', 'roomClassHint']
	}[activeTool];
	if (!content) return;
	elements.editToolTitle.textContent = t(content[0]);
	elements.editToolHint.textContent = t(content[1]);
	elements.editAreaShortcut.textContent = t('areaShortcut');
	elements.editAreaShortcut.hidden = !['wall', 'corridor'].includes(activeTool);
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

function projectBase64() {
	return currentProject ? utf8ToBase64(JSON.stringify(currentProject)) : '';
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
			serviceUnavailable: 'errorServiceUnavailable', saveFailed: 'errorSaveFailed',
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
}

function readAppearance() {
	return Object.fromEntries(Object.entries(elements.colors).map(([key, input]) => [key, input.value]));
}

function cloneProject(project = currentProject) {
	return project ? JSON.parse(JSON.stringify(project)) : null;
}

function projectForEdit(project = currentProject) {
	return project ? { ...project, renderSvg: null } : null;
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
	return Boolean(currentProjectId && currentProject?.renderSvg && currentProject?.structure && !generating && !editing);
}

function renderAll() {
	elements.projectTitle.textContent = currentProjectName || t('productTitle');
	elements.statusText.textContent = statusLabel();
	elements.sourceLink.href = hostState.sourceCodeURL || '#';
	elements.sourceLink.hidden = !hostState.sourceCodeURL;
	elements.generateButton.disabled = !currentProjectId || generating || Boolean(hostState.loading);
	elements.exportButton.disabled = !currentProject?.renderSvg || generating || Boolean(hostState.exporting);
	elements.openGeneration.disabled = !currentProjectId;
	for (const input of Object.values(elements.colors)) input.disabled = !currentProject?.renderSvg;
	document.querySelector('[data-tool-button="editing"]').disabled = !canEditMap();
	document.querySelectorAll('[data-edit-tool]').forEach((button) => { button.disabled = !canEditMap(); });
	elements.undoEdit.disabled = !undoStack.length || generating || editing;
	elements.redoEdit.disabled = !redoStack.length || generating || editing;
	elements.canvas.classList.toggle('editing', activePanel === 'editing' && canEditMap());
	renderEditingTool();
	renderThemeToggle();
	renderProjects();
	renderStorage();
	renderStats();
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
		open.addEventListener('click', () => send('dungeongen:project-open', { projectId: project.id }));

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

function setProjectImage(svg, fitOnLoad = true) {
	if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
	currentImageUrl = '';
	if (!svg) {
		elements.mapImage.removeAttribute('src');
		renderEditPreview();
		elements.emptyWorkspace.hidden = false;
		return;
	}
	fitImageOnLoad = fitOnLoad;
	currentImageUrl = URL.createObjectURL(
		new Blob([styledSvg(svg, currentProject?.appearance)], { type: 'image/svg+xml' })
	);
	elements.mapImage.src = currentImageUrl;
	elements.emptyWorkspace.hidden = true;
}

function updateTransform() {
	elements.mapSurface.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
	elements.zoomValue.value = `${Math.round(scale * 100)}%`;
}

function fitMap() {
	const width = elements.mapImage.naturalWidth || 1;
	const height = elements.mapImage.naturalHeight || 1;
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
	const width = elements.mapImage.naturalWidth || 1;
	const height = elements.mapImage.naturalHeight || 1;
	panX += (width * oldScale - width * scale) / 2;
	panY += (height * oldScale - height * scale) / 2;
	updateTransform();
}

function syncEditOverlaySize() {
	const width = elements.mapImage.naturalWidth || 1;
	const height = elements.mapImage.naturalHeight || 1;
	elements.editOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
}

function eventCell(event) {
	const bounds = currentProject?.structure?.bounds;
	const mapBounds = currentProject?.structure?.mapBounds;
	if (!bounds || !mapBounds || !elements.mapImage.naturalWidth) return null;
	const rect = elements.mapImage.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	const pixelX = (event.clientX - rect.left) * elements.mapImage.naturalWidth / rect.width;
	const pixelY = (event.clientY - rect.top) * elements.mapImage.naturalHeight / rect.height;
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

function renderEditPreview(cells = [], tool = activeTool) {
	elements.editOverlay.replaceChildren();
	const mapBounds = currentProject?.structure?.mapBounds;
	if (!mapBounds || !cells.length) return;
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', cells.map((cell) => {
		const x = canvasPadding + (cell[0] - mapBounds[0]) * cellSize;
		const y = canvasPadding + (cell[1] - mapBounds[1]) * cellSize;
		return `M${x} ${y}h${cellSize}v${cellSize}h-${cellSize}z`;
	}).join(''));
	path.setAttribute('class', `edit-preview-cell ${tool}`);
	elements.editOverlay.append(path);
}

async function makePreviewBase64() {
	if (!currentProject?.renderSvg) return '';
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const context = canvas.getContext('2d');
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, 128, 128);
	const ratio = Math.min(128 / elements.mapImage.naturalWidth, 128 / elements.mapImage.naturalHeight);
	const width = elements.mapImage.naturalWidth * ratio;
	const height = elements.mapImage.naturalHeight * ratio;
	context.drawImage(elements.mapImage, (128 - width) / 2, (128 - height) / 2, width, height);
	const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .82));
	if (!blob) return '';
	return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function autosaveCurrent(timing = null, includePreview = true) {
	if (!currentProjectId || !currentProject?.renderSvg) return;
	let startedAt = performance.now();
	const encodedProject = projectBase64();
	timing?.('autosave_project_encode', performance.now() - startedAt);
	let previewBase64 = '';
	if (includePreview) {
		startedAt = performance.now();
		await elements.mapImage.decode().catch(() => undefined);
		timing?.('image_decode', performance.now() - startedAt);
		startedAt = performance.now();
		previewBase64 = await makePreviewBase64();
		timing?.('autosave_preview', performance.now() - startedAt);
	}
	startedAt = performance.now();
	send('dungeongen:autosave', {
		projectId: currentProjectId,
		projectBase64: encodedProject,
		previewBase64
	});
	timing?.('autosave_dispatch', performance.now() - startedAt);
}

function scheduleAutosavePreview(timing = null) {
	if (previewUpdateTimer) clearTimeout(previewUpdateTimer);
	const projectId = currentProjectId;
	previewUpdateTimer = setTimeout(() => {
		previewUpdateTimer = null;
		if (!projectId || currentProjectId !== projectId) return;
		if (editing || generating) {
			scheduleAutosavePreview(timing);
			return;
		}
		const backgroundTiming = timing
			? (stage, elapsedMs) => timing(`background_${stage}`, elapsedMs)
			: null;
		void autosaveCurrent(backgroundTiming, true);
	}, editPreviewDelayMs);
}

async function restoreHistory(nextProject, destination) {
	if (!nextProject || editing || generating) return;
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = null;
	pendingAppearanceSnapshot = null;
	destination.push(cloneProject());
	if (destination.length > maxHistoryEntries) destination.shift();
	currentProject = cloneProject(nextProject);
	writeParameters(currentProject.parameters);
	writeAppearance(currentProject.appearance);
	setProjectImage(currentProject.renderSvg, false);
	localStatus = 'statusSaving';
	renderAll();
	await autosaveCurrent();
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
	let editSucceeded = false;
	const previous = cloneProject();
	editing = true;
	localStatus = 'statusEditing';
	renderAll();
	try {
		let startedAt = performance.now();
		const requestBody = JSON.stringify({ project: projectForEdit(), operation });
		timing('request_serialization', performance.now() - startedAt);
		startedAt = performance.now();
		const response = await fetch('/dungeon-editor/api/edit', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Dungeongen-Capability': capability,
				'X-Dungeongen-Request-Id': requestId
			},
			body: requestBody
		});
		timing('fetch_until_headers', performance.now() - startedAt);
		startedAt = performance.now();
		const payload = await response.json().catch(() => null);
		timing('response_decode', performance.now() - startedAt);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'editFailed');
		startedAt = performance.now();
		currentProject = payload.project;
		pushHistory(previous);
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		setProjectImage(currentProject.renderSvg, false);
		timing('project_apply', performance.now() - startedAt);
		localStatus = 'statusSaving';
		await autosaveCurrent(timing, false);
		editSucceeded = true;
	} catch {
		localStatus = 'errorEditFailed';
	} finally {
		timing('browser_total', performance.now() - totalStartedAt);
		editing = false;
		if (editSucceeded) scheduleAutosavePreview(timing);
		renderEditPreview();
		renderAll();
	}
}

async function initializeProjectStructure() {
	if (!capability || !currentProjectId || !currentProject?.renderSvg || !currentProject?.layout || currentProject?.structure || editing) return;
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
			body: JSON.stringify({ project: projectForEdit(project), operation: { type: 'initialize' } })
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'editFailed');
		if (currentProjectId !== projectId) return;
		currentProject = payload.project;
		setProjectImage(currentProject.renderSvg, false);
		localStatus = 'statusSaving';
		await autosaveCurrent();
	} catch {
		if (currentProjectId === projectId) localStatus = 'errorEditFailed';
	} finally {
		editing = false;
		elements.loadingLabel.textContent = t('generating');
		elements.loading.hidden = true;
		renderAll();
	}
}

async function generate() {
	if (!currentProjectId || generating) return;
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
			body: JSON.stringify({ parameters: readParameters() })
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.success) throw new Error(payload?.error ?? 'generationFailed');
		currentProject = {
			...payload.project,
			appearance: normalizeAppearance(currentProject?.appearance)
		};
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		setProjectImage(currentProject.renderSvg);
		resetHistory();
		await elements.mapImage.decode().catch(() => undefined);
		fitMap();
		localStatus = 'statusSaving';
		renderAll();
		await autosaveCurrent();
	} catch {
		localStatus = 'errorGenerationFailed';
	} finally {
		generating = false;
		elements.loading.hidden = true;
		renderAll();
	}
}

function openProject(message) {
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = null;
	resetHistory();
	renderEditPreview();
	localStatus = 'statusLoading';
	currentProjectId = String(message.projectId ?? '');
	currentProjectName = String(message.name ?? '');
	try {
		currentProject = JSON.parse(base64ToUtf8(String(message.projectBase64 ?? '')));
		currentProject.appearance = normalizeAppearance(currentProject.appearance);
		writeParameters(currentProject.parameters);
		writeAppearance(currentProject.appearance);
		setProjectImage(currentProject.renderSvg);
		localStatus = '';
	} catch {
		currentProject = null;
		setProjectImage(null);
		localStatus = 'errorGeneric';
	}
	renderAll();
	void initializeProjectStructure();
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
	renderAll();
	void initializeProjectStructure();
}

function activateTool(name) {
	if (name === 'editing' && !canEditMap()) return;
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
	button.addEventListener('click', () => {
		if (!canEditMap() || !editingTools.has(button.dataset.editTool)) return;
		activeTool = button.dataset.editTool;
		editGesture = null;
		renderEditPreview();
		renderEditingTool();
	});
});

async function saveAppearance() {
	if (!currentProjectId || !currentProject?.renderSvg) return;
	localStatus = 'statusSaving';
	renderAll();
	await autosaveCurrent();
}

async function updateAppearance() {
	appearanceUpdateTimer = null;
	if (!currentProject?.renderSvg) return;
	const nextAppearance = normalizeAppearance(readAppearance());
	if (JSON.stringify(nextAppearance) === JSON.stringify(currentProject.appearance)) {
		pendingAppearanceSnapshot = null;
		return;
	}
	pushHistory(pendingAppearanceSnapshot ?? cloneProject());
	pendingAppearanceSnapshot = null;
	currentProject.appearance = nextAppearance;
	setProjectImage(currentProject.renderSvg, false);
	await saveAppearance();
}

function scheduleAppearanceUpdate() {
	if (!currentProject?.renderSvg) return;
	if (!pendingAppearanceSnapshot) pendingAppearanceSnapshot = cloneProject();
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = setTimeout(() => void updateAppearance(), colorApplyDelayMs);
}

elements.createProjectForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const name = elements.newProjectName.value.trim() || t('productTitle');
	send('dungeongen:project-create', { name });
	elements.newProjectName.value = '';
});
elements.generateButton.addEventListener('click', generate);
elements.openGeneration.addEventListener('click', () => activateTool('generation'));
for (const input of Object.values(elements.colors)) input.addEventListener('input', scheduleAppearanceUpdate);
elements.exportButton.addEventListener('click', async () => {
	if (!currentProjectId || !currentProject?.renderSvg) return;
	localStatus = 'statusExporting';
	renderAll();
	send('dungeongen:export', {
		projectId: currentProjectId,
		projectBase64: projectBase64(),
		previewBase64: await makePreviewBase64()
	});
});
elements.backButton.addEventListener('click', () => send('dungeongen:back'));
elements.themeToggle.addEventListener('click', toggleTheme);
elements.undoEdit.addEventListener('click', () => void undoEdit());
elements.redoEdit.addEventListener('click', () => void redoEdit());
elements.zoomIn.addEventListener('click', () => zoom(1.2));
elements.zoomOut.addEventListener('click', () => zoom(1 / 1.2));
elements.fitMap.addEventListener('click', fitMap);
elements.mapImage.addEventListener('load', () => {
	syncEditOverlaySize();
	if (fitImageOnLoad) fitMap();
});
elements.canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
elements.canvas.addEventListener('pointerdown', (event) => {
	if (activePanel === 'editing' && canEditMap() && event.button === 0) {
		const cell = eventCell(event);
		if (!cell) return;
		event.preventDefault();
		editGesture = {
			tool: activeTool, start: cell, current: cell, last: cell,
			shift: event.shiftKey, cells: new Set([cellKey(cell)]), pointerId: event.pointerId
		};
		elements.canvas.setPointerCapture(event.pointerId);
		renderEditPreview(gestureCells(editGesture, cell, event.shiftKey), activeTool);
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
		if (editGesture.tool === 'wall' || editGesture.tool === 'corridor') {
			for (const pathCell of lineCells(editGesture.last, cell)) editGesture.cells.add(cellKey(pathCell));
		}
		editGesture.last = cell;
		editGesture.current = cell;
		renderEditPreview(gestureCells(editGesture, cell, event.shiftKey), editGesture.tool);
		return;
	}
	if (activePanel === 'editing' && canEditMap()) {
		const cell = eventCell(event);
		renderEditPreview(cell ? (activeTool === 'roundRoom' ? roundPreview(cell, 1) : [cell]) : [], activeTool);
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
		renderEditPreview(cells, gesture.tool);
		if (gesture.tool === 'wall' || gesture.tool === 'corridor') {
			void commitStructure({ type: 'paint', mode: gesture.tool, cells });
		} else if (gesture.tool === 'roundRoom') {
			const radius = Math.max(1, Math.abs(current[0] - gesture.start[0]), Math.abs(current[1] - gesture.start[1]));
			void commitStructure({ type: 'roundRoom', center: gesture.start, radius });
		} else {
			void commitStructure({ type: 'toggleRoom', cell: current });
		}
		return;
	}
	pointerStart = null;
	elements.canvas.classList.remove('panning');
});
elements.canvas.addEventListener('pointercancel', () => {
	editGesture = null;
	pointerStart = null;
	elements.canvas.classList.remove('panning');
	renderEditPreview();
});
elements.canvas.addEventListener('pointerleave', () => {
	if (!editGesture) renderEditPreview();
});
elements.canvas.addEventListener('contextmenu', (event) => {
	if (activePanel === 'editing') event.preventDefault();
});
document.addEventListener('keydown', async (event) => {
	if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
	const target = event.target;
	if (target instanceof HTMLElement && (target.matches('textarea, select, input:not([type="color"])') || target.isContentEditable)) return;
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
window.addEventListener('resize', () => currentProject?.renderSvg && fitMap());
window.addEventListener('message', (event) => {
	if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
	if (event.data.type === 'dungeongen:host-state') {
		void loadLocale(String(event.data.locale ?? fallbackLocale));
		applyHostState({ ...event.data.state, theme: event.data.theme });
	}
	if (event.data.type === 'dungeongen:open') openProject(event.data);
});

void Promise.all([loadEditorConfig(), loadLocale(fallbackLocale)]).then(() => {
	renderSideFire();
	renderAll();
	send('dungeongen:ready');
});
