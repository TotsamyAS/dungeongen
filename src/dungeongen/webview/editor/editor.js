const fallbackLocale = 'ru';
const editorAssetVersion = '20260731-3';
const defaultColorApplyDelayMs = 350;
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
let appearanceUpdateTimer = null;
let colorApplyDelayMs = defaultColorApplyDelayMs;
let fitImageOnLoad = true;

const elements = {
	canvas: document.getElementById('canvas'),
	mapSurface: document.getElementById('mapSurface'),
	mapImage: document.getElementById('mapImage'),
	emptyWorkspace: document.getElementById('emptyWorkspace'),
	loading: document.getElementById('loading'),
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
	} catch {
		colorApplyDelayMs = defaultColorApplyDelayMs;
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
		projects: 'toolProjects', generation: 'toolGeneration', colors: 'toolColors',
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
	elements.createProjectForm.querySelector('button').setAttribute('aria-label', t('createProject'));
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

function renderAll() {
	elements.projectTitle.textContent = currentProjectName || t('productTitle');
	elements.statusText.textContent = statusLabel();
	elements.sourceLink.href = hostState.sourceCodeURL || '#';
	elements.sourceLink.hidden = !hostState.sourceCodeURL;
	elements.generateButton.disabled = !currentProjectId || generating || Boolean(hostState.loading);
	elements.exportButton.disabled = !currentProject?.renderSvg || generating || Boolean(hostState.exporting);
	elements.openGeneration.disabled = !currentProjectId;
	for (const input of Object.values(elements.colors)) input.disabled = !currentProject?.renderSvg;
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

async function generate() {
	if (!currentProjectId || generating) return;
	if (appearanceUpdateTimer) {
		clearTimeout(appearanceUpdateTimer);
		appearanceUpdateTimer = null;
		if (currentProject?.renderSvg) currentProject.appearance = normalizeAppearance(readAppearance());
	}
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
		await elements.mapImage.decode().catch(() => undefined);
		fitMap();
		localStatus = 'statusSaving';
		renderAll();
		send('dungeongen:autosave', {
			projectId: currentProjectId,
			projectBase64: projectBase64(),
			previewBase64: await makePreviewBase64()
		});
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
}

function activateTool(name) {
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

async function saveAppearance() {
	if (!currentProjectId || !currentProject?.renderSvg) return;
	localStatus = 'statusSaving';
	renderAll();
	await elements.mapImage.decode().catch(() => undefined);
	send('dungeongen:autosave', {
		projectId: currentProjectId,
		projectBase64: projectBase64(),
		previewBase64: await makePreviewBase64()
	});
}

function updateAppearance() {
	appearanceUpdateTimer = null;
	if (!currentProject?.renderSvg) return;
	currentProject.appearance = normalizeAppearance(readAppearance());
	setProjectImage(currentProject.renderSvg, false);
	void saveAppearance();
}

function scheduleAppearanceUpdate() {
	if (!currentProject?.renderSvg) return;
	if (appearanceUpdateTimer) clearTimeout(appearanceUpdateTimer);
	appearanceUpdateTimer = setTimeout(updateAppearance, colorApplyDelayMs);
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
elements.zoomIn.addEventListener('click', () => zoom(1.2));
elements.zoomOut.addEventListener('click', () => zoom(1 / 1.2));
elements.fitMap.addEventListener('click', fitMap);
elements.mapImage.addEventListener('load', () => {
	if (fitImageOnLoad) fitMap();
});
elements.canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
elements.canvas.addEventListener('pointerdown', (event) => {
	pointerStart = { x: event.clientX, y: event.clientY, panX, panY };
	elements.canvas.setPointerCapture(event.pointerId);
	elements.canvas.classList.add('panning');
});
elements.canvas.addEventListener('pointermove', (event) => {
	if (!pointerStart) return;
	panX = pointerStart.panX + event.clientX - pointerStart.x;
	panY = pointerStart.panY + event.clientY - pointerStart.y;
	updateTransform();
});
elements.canvas.addEventListener('pointerup', () => { pointerStart = null; elements.canvas.classList.remove('panning'); });
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
