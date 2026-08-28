# Dungeongen Adapted

`dungeongen-adapted` is the dungeon generation and editing microservice used by **Dungeon Overlord**.

It is based on [benjcooley/dungeongen](https://github.com/benjcooley/dungeongen), but the original generator has been extended into a service-owned browser editor with a JSON project format, server-side editing and rendering APIs, host-application integration, and production deployment support.

This repository is the adapted fork:

- Adapted fork: [TotsamyAS/dungeongen](https://github.com/TotsamyAS/dungeongen)
- Original project: [benjcooley/dungeongen](https://github.com/benjcooley/dungeongen)

## Purpose in Dungeon Overlord

Dungeon Overlord embeds the editor from this service at `/dungeon-editor` and uses the service as a rendering backend. The parent SvelteKit application remains responsible for authentication, project ownership, persistent storage, account-backed custom color themes, storage quotas, and adding exported maps to the user's personal image library.

The microservice itself is intentionally focused on dungeon-specific work:

1. generate a procedural dungeon layout;
2. convert it into an editable project model;
3. apply structural and object-level edits;
4. render canonical previews;
5. produce the final JPEG used by Dungeon Overlord.

Projects are passed between the host application and this service as JSON. The service does not maintain its own project database. Named custom color themes are stored in the Dungeon Overlord PostgreSQL database and synchronized with the embedded editor through the host page. After adding this integration to an existing installation, apply the host schema with `bun run db:push`.

## What the adapted service can do

### Procedural generation

- Generate tiny through extra-large dungeons.
- Use asymmetric or bilateral layouts.
- Control room density, room-size bias, extra connections, halls, and round rooms.
- Generate deterministic maps from numeric or text seeds.
- Add doors, stairs, entrances, exits, room numbers, decorations, and procedural water.
- Render the original hand-drawn style with walls, grid lines, shadows, crosshatching, and configurable colors.

### Integrated browser editor

The service ships a standalone editor UI that is embedded by Dungeon Overlord. It supports:

- host-managed project creation, selection, renaming, and deletion;
- storage usage display supplied by the host application;
- automatic saving and browser-side working-copy recovery;
- undo and redo;
- dark and light themes;
- zoom and fit-to-screen controls;
- a fast structure mode that delays the expensive canonical render;
- full preview rendering on demand;
- built-in color palettes, per-layer color customization, and named user palettes persisted by the host application.

### Structural editing

The editor can modify a generated map after generation:

- paint walls and walkable corridors;
- create round rooms;
- mark detected rooms as corridors and restore automatic classification;
- paint and erase water;
- place and remove open, closed, locked, and secret doors;
- place entrances, exits, and stairs;
- place coffins, daises, altars, fountains, round or square columns, and rocks;
- erase dungeon objects from the map.

Edits are stored in a structured grid model and can be rendered without regenerating the original dungeon layout.

### Rendering and export

The adapted web workflow uses two rendering stages:

- **canonical SVG rendering** for the editor preview;
- **JPEG rendering** for export to the Dungeon Overlord personal image library.

The underlying Python package still contains the original map and drawing primitives, including PNG/SVG-oriented rendering APIs, but the supported Dungeon Overlord integration exports JPEG through the service API.

### Production service behavior

- Flask HTTP application.
- Gunicorn production entry point with configurable workers, threads, and request timeout.
- Health endpoint for container orchestration.
- Short-lived capability tokens for editor mutation endpoints.
- Request-size and project-format validation.
- Security and no-cache headers for the embedded editor.
- Docker-friendly, stateless deployment.
- Optional edit and timing logs controlled by `config.json`.

## HTTP interface

The parent application normally calls these routes through its own server-side gateway.

| Method | Route                               | Purpose                                                              |
| ------ | ----------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/health`                           | Container and service health check.                                  |
| `GET`  | `/dungeon-editor`                   | Service-owned embedded editor.                                       |
| `POST` | `/internal/capabilities`            | Mint a short-lived capability token for trusted host-to-service use. |
| `POST` | `/api/dungeongen/projects/default`  | Create an empty normalized project document.                         |
| `POST` | `/api/dungeongen/editor/generate`   | Generate a project from editor parameters.                           |
| `POST` | `/api/dungeongen/editor/edit`       | Apply one structural or object editing operation.                    |
| `POST` | `/api/dungeongen/editor/checkpoint` | Normalize and checkpoint an edited project without a full render.    |
| `POST` | `/api/dungeongen/editor/render`     | Produce the canonical rendered project after edits.                  |
| `POST` | `/api/dungeongen/projects/export`   | Render a project as `image/jpeg`.                                    |

The editor mutation routes require the capability token in the `X-Dungeongen-Capability` header. `/internal/capabilities` is intended for an internal network and should not be exposed directly to untrusted clients.

## Project format

The adapted service introduces a versioned JSON project document. Its main sections are:

- `parameters` — procedural generation settings and seed;
- `appearance` — map colors;
- `layout` — generated rooms, passages, doors, stairs, exits, and seeds;
- `structure` — editable cells, room classification, water, and placed objects;
- `stats` — summarized map counts;
- `renderSvg` — optional canonical preview, omitted from compact persistent copies;
- `clientRevision` and structure revision data — edit and autosave coordination.

The current maximum normalized project size is 8 MiB.

## Configuration

Runtime settings are read from `config.json` in the package root or current working directory.

```json
{
	"port": 5050,
	"workers": 2,
	"threads": 2,
	"requestTimeoutSeconds": 180,
	"colorApplyDelayMs": 200,
	"canonicalRenderDelayMs": 10,
	"workingCopyIdleSaveMs": 15000,
	"workingCopyIntervalMs": 300000,
	"previewSizePixels": 48,
	"themeSaveTimeoutMs": 20000,
	"logging": {
		"EDITING_LOGGING": false,
		"EDIT_TIME_LOGGING": true,
		"THEME_SAVE_LOGGING": false
	}
}
```

The delays, preview size, theme-save timeout, and the theme-save diagnostics switch are published to the editor as non-secret runtime configuration. `THEME_SAVE_LOGGING` is disabled by default. When enabled, correlated `[THEME-SAVE]` browser messages and `[dungeongen-theme]` application logs show the save request stages without logging palette colors.

## Running locally

Python 3.10 or newer is required.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m dungeongen.webview.app
```

The editor shell is served at `http://localhost:5050/dungeon-editor`. The complete workflow requires the Dungeon Overlord host because the host supplies projects, persistence, navigation, and export handling.

For a production-style local run:

```bash
python -m dungeongen.webview.server
```

Inside the Dungeon Overlord repository, the service is normally built and started with Docker Compose:

```bash
docker compose up -d --build dungeongen
```

The complete editor workflow should be opened through Dungeon Overlord because project persistence, user storage, and image-library export are host responsibilities.

## Differences from the original project

The upstream project is primarily a reusable Python procedural generator with a simple interactive preview and direct rendering examples. This fork keeps its generation and drawing foundation, but changes the product boundary substantially:

- converts the preview into an embeddable, service-owned dungeon editor;
- adds a versioned persistent project model instead of treating a render as the only result;
- adds server-side structural editing and object placement;
- supports checkpointing, delayed canonical rendering, autosave coordination, and browser working-copy recovery;
- integrates project lists, account-backed custom color themes, storage quota information, navigation, locale, and theme through `postMessage` with Dungeon Overlord;
- adds short-lived capability authorization for editor operations;
- adds a dedicated JPEG export path for the Dungeon Overlord image library;
- adds Gunicorn and JSON-based production configuration;
- ships the editor assets inside the Python wheel and Docker image;
- targets the Dungeon Overlord deployment rather than the upstream hosted demo.

This fork is therefore not a drop-in replacement for the original web preview API. Consumers that only need the original Python generator should refer to the upstream repository.

## Attribution and license

The generation and rendering foundation was created by Benjamin Cooley and contributors to [benjcooley/dungeongen](https://github.com/benjcooley/dungeongen). The adapted service is maintained in [TotsamyAS/dungeongen](https://github.com/TotsamyAS/dungeongen) for use by Dungeon Overlord.

The project remains available under the MIT License. See `LICENSE` for the full text.
