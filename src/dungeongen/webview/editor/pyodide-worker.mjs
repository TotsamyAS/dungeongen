let pyodide = null;
let canvasKit = null;
let initPromise = null;
let bridge = null;
let activeConfig = null;
let displayCanvas = null;

const localAsset = (name) => `/dungeon-editor/${name}`;

function elapsed(startedAt) {
	return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

async function fetchBytes(url) {
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) throw new Error(`assetFetch:${response.status}:${url}`);
	return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url) {
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) throw new Error(`assetFetch:${response.status}:${url}`);
	return response.text();
}

function normalizeBaseUrl(value) {
	const base = String(value || '');
	return base.endsWith('/') ? base : `${base}/`;
}

async function initialize(config, canvas = null) {
	if (canvas && !displayCanvas) {
		displayCanvas = canvas;
		globalThis.dungeongenDisplayCanvas = canvas;
	}
	if (bridge) return { timings: [] };
	if (initPromise) return initPromise;
	activeConfig = config;
	initPromise = (async () => {
		const timings = [];
		let startedAt = performance.now();
		const pyodideBaseUrl = normalizeBaseUrl(config.pyodideBaseUrl);
		const pyodideModule = await import(`${pyodideBaseUrl}pyodide.mjs`);
		timings.push({ stage: 'pyodide_module', elapsedMs: elapsed(startedAt) });

		startedAt = performance.now();
		pyodide = await pyodideModule.loadPyodide({ indexURL: pyodideBaseUrl });
		timings.push({ stage: 'pyodide_runtime', elapsedMs: elapsed(startedAt) });

		startedAt = performance.now();
		await pyodide.loadPackage('numpy');
		timings.push({ stage: 'python_dependencies', elapsedMs: elapsed(startedAt) });

		startedAt = performance.now();
		const canvasKitModule = await import(config.canvasKitModuleUrl);
		const initCanvasKit = canvasKitModule.default ?? canvasKitModule.CanvasKitInit;
		if (typeof initCanvasKit !== 'function') throw new Error('canvasKitModule');
		canvasKit = await initCanvasKit({
			locateFile: (file) =>
				file.endsWith('.wasm') ? config.canvasKitWasmUrl : new URL(file, config.canvasKitModuleUrl).href
		});
		globalThis.dungeongenCanvasKit = canvasKit;
		timings.push({ stage: 'canvaskit_runtime', elapsedMs: elapsed(startedAt) });

		startedAt = performance.now();
		const [skiaSource, coreArchive] = await Promise.all([
			fetchText(localAsset('pyodide-skia.py')),
			fetchBytes(localAsset('python-core.zip'))
		]);
		pyodide.FS.writeFile('/skia.py', skiaSource);
		pyodide.unpackArchive(coreArchive, 'zip', { extractDir: '/' });
		timings.push({ stage: 'python_core_assets', elapsedMs: elapsed(startedAt) });

		startedAt = performance.now();
		await pyodide.runPythonAsync(`
import json
import sys

if "/" not in sys.path:
    sys.path.insert(0, "/")

from dungeongen.webview.project import (
    checkpoint_project,
    edit_project,
    edit_project_browser_canvas,
    render_project_browser_canvas,
)


def _dg_result(project, timings, **extra):
    result = {"project": project, "timings": timings}
    result.update(extra)
    return json.dumps(result, separators=(",", ":"), ensure_ascii=False)


def _dg_timing(entries):
    def record(stage, elapsed_ms):
        entries.append({"stage": str(stage), "elapsedMs": round(float(elapsed_ms), 3)})
    return record


def __dg_edit(payload_json):
    payload = json.loads(payload_json)
    timings = []
    payload["deferRender"] = True
    project = edit_project(payload, timing=_dg_timing(timings), validate_size=False)
    return _dg_result(project, timings)


def __dg_checkpoint(payload_json):
    payload = json.loads(payload_json)
    timings = []
    project = checkpoint_project(payload, timing=_dg_timing(timings), validate_size=False)
    return _dg_result(project, timings)


def __dg_render(payload_json, render_flags_json):
    payload = json.loads(payload_json)
    render_flags = json.loads(render_flags_json)
    timings = []
    project, width, height = render_project_browser_canvas(
        payload,
        timing=_dg_timing(timings),
        render_flags=render_flags,
    )
    return _dg_result(project, timings, width=width, height=height)


def __dg_edit_render(payload_json, render_flags_json):
    payload = json.loads(payload_json)
    render_flags = json.loads(render_flags_json)
    timings = []
    project, width, height = edit_project_browser_canvas(
        payload,
        timing=_dg_timing(timings),
        render_flags=render_flags,
    )
    return _dg_result(project, timings, width=width, height=height)


def __dg_skia_path_smoke():
    import skia

    path = skia.Path()
    path.moveTo(0, 0)
    path.lineTo(8, 0)
    path.quadTo(10, 0, 10, 2)
    path.cubicTo(10, 4, 8, 6, 6, 6)
    path.close()
    path.addRect(skia.Rect.MakeXYWH(1, 1, 3, 2))
    path.addRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(2, 2, 3, 2), 0.5, 0.5))
    path.addCircle(4, 4, 1)

    extra = skia.Path()
    extra.addRect(skia.Rect.MakeXYWH(0, 0, 2, 2))
    path.addPath(extra)
    path.offset(1, 1)
    matrix = skia.Matrix()
    matrix.setTranslate(1, 0)
    path.transform(matrix)
    path.setFillType(skia.PathFillType.kEvenOdd)
    path.getBounds()
    path.contains(2, 2)

    combined = skia.Op(path, extra, skia.PathOp.kUnion_PathOp)
    if combined is None:
        raise RuntimeError("CanvasKit Path.Op smoke test failed")


__dg_skia_path_smoke()
`);
		bridge = {
			edit: pyodide.globals.get('__dg_edit'),
			editRender: pyodide.globals.get('__dg_edit_render'),
			checkpoint: pyodide.globals.get('__dg_checkpoint'),
			render: pyodide.globals.get('__dg_render')
		};
		timings.push({ stage: 'python_core_import', elapsedMs: elapsed(startedAt) });
		return { timings };
	})();
	try {
		return await initPromise;
	} catch (error) {
		initPromise = null;
		throw error;
	}
}

function invoke(operation, payload, renderStages) {
	const totalStartedAt = performance.now();
	let startedAt = performance.now();
	const payloadJson = JSON.stringify(payload);
	const flagsJson = JSON.stringify(renderStages ?? {});
	const workerTimings = [
		{ stage: 'worker_payload_serialization', elapsedMs: elapsed(startedAt) }
	];

	startedAt = performance.now();
	let raw;
	if (operation === 'render' || operation === 'editRender') {
		raw = bridge[operation](payloadJson, flagsJson);
	} else {
		raw = bridge[operation](payloadJson);
	}
	workerTimings.push({ stage: 'worker_python_call', elapsedMs: elapsed(startedAt) });

	startedAt = performance.now();
	const result = JSON.parse(raw);
	workerTimings.push({ stage: 'worker_result_parse', elapsedMs: elapsed(startedAt) });
	result.timings ??= [];
	result.timings.push(...workerTimings);
	result.timings.push({ stage: 'worker_total', elapsedMs: elapsed(totalStartedAt) });
	return result;
}

self.onmessage = async (event) => {
	const message = event.data ?? {};
	const { id, type, payload, config, canvas } = message;
	try {
		const initialized = await initialize(config ?? activeConfig, canvas);
		if (type === 'init') {
			self.postMessage({ id, ok: true, result: initialized });
			return;
		}
		if (!['edit', 'editRender', 'checkpoint', 'render'].includes(type))
			throw new Error(`workerOperation:${type}`);
		const result = invoke(type, payload, config?.renderStages ?? activeConfig?.renderStages);
		self.postMessage({ id, ok: true, result });
	} catch (error) {
		self.postMessage({
			id,
			ok: false,
			error: String(error?.message || error || 'workerFailed'),
			stack: String(error?.stack || '')
		});
	}
};
