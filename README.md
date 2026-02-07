<div align="center">

# EcoTrace — Green Scanner

Find more sustainable grocery alternatives using Eco-Score and Nutri-Score, with a friendly widget UI and MCP tool integration.

</div>

## Overview

Green Scanner is a ChatGPT/MCP app built with Skybridge. Given a product query or photo, it:

- Identifies the product (image-based when available)
- Retrieves Eco-Score and Nutri-Score (Open Food Facts)
- Suggests equal or better alternatives in the same category
- Presents a clean React widget UI with instant updates

Core tool: `find_sustainable_alternative` (MCP), backed by Open Food Facts with Brave Search + OpenAI fallbacks when data is missing.

> Tip: The app serves two users at once — the human and the LLM. The widget is the shared surface the LLM “sees” and the human interacts with.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Data Sources](#data-sources)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Local Endpoints](#local-endpoints)
- [NPM Scripts](#npm-scripts)
- [Server: MCP Tool & Resource](#server-mcp-tool--resource)
- [Web: Widget UI](#web-widget-ui)
- [API: Tool Input/Output](#api-tool-inputoutput)
- [Connect to ChatGPT (Apps SDK)](#connect-to-chatgpt-apps-sdk)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Acknowledgements](#acknowledgements)

## Features

- Image-based identification (optional): detect product name/brand from photos
- Primary data via Open Food Facts (Eco-Score, categories, etc.)
- Alternatives ranked by Eco/Nutri score; up to 6 with “view more”
- Graceful fallbacks: Brave Search + OpenAI estimation for missing fields
- Fast dev workflow: Vite React HMR, Skybridge dev tooling
- Streamable MCP over HTTP with proper error handling

## Architecture

This repo has two main parts:

1. **Server (MCP)** — registers a tool and a widget resource the Apps SDK can render.
	 - Skybridge-compatible MCP server built with `@modelcontextprotocol/sdk`
	 - Express dev server for local testing
	 - Streamable HTTP transport at `/mcp`

2. **Web (Widget UI)** — a React component mounted via `skybridge/web`.
	 - HMR-enabled Vite setup
	 - Clean, responsive layout with eco/nutri badges and alternative cards

Key flows:

- The UI calls the MCP tool (`openai.callTool`) when hosted in an Apps SDK client, or a local REST endpoint (`/api/find`) for dev.
- The server fetches and normalizes product data, estimates missing fields when necessary, and returns a text + structured payload the UI renders.

## Repository Structure

```
AGENTS.md
SKILL.md
SPEC.md
alpic.json
nodemon.json
package.json
tsconfig.json
tsconfig.server.json
server/
	src/
		index.ts          # MCP server (tool + widget resource)
		dev.ts            # Express dev server & Vite middleware
		middleware.ts     # Streamable HTTP MCP transport
web/
	vite.config.ts     # Vite + Skybridge web plugin
	src/
		index.css        # Global styles
		widgets/
			green-scanner.tsx # Widget UI
```

## Data Sources

- **Open Food Facts** (primary)
	- Search (CGI): `https://world.openfoodfacts.org/cgi/search.pl?search_terms=...&json=1`
	- Search (v2): `https://world.openfoodfacts.org/api/v2/search?...`
- **Brave Search API** (fallback enrichment)
- **OpenAI Responses API** (structured JSON estimation; optional image input)

Estimation is used when fields are unknown or incomplete — never `Unknown` in final output; sensible defaults (e.g., scores default to `C`).

## Environment Variables

Create a `.env` file in the project root and set:

```env
# Optional but highly recommended for better results
BRAVE_API_KEY=your_brave_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# Optional
PORT=3000
NODE_ENV=development
```

Notes:

- The app works without keys but falls back to minimal data; keys improve accuracy and completeness.
- Image-based identification requires `OPENAI_API_KEY`.

## Getting Started

### Prerequisites

- Node.js >= 24.13.0 (per `package.json` engines)

### Install

```bash
npm install
```

### Run in Development

```bash
# Kills Vite HMR port if in use, then starts Skybridge dev
npm run dev
```

What starts:

- MCP endpoint: `http://localhost:3000/mcp`
- Dev UI + assets: `http://localhost:3000/`
- Widget HMR: WebSocket on port `24678` (auto-managed)

### Build & Start (Production-like)

```bash
npm run build
npm run start
```

## Local Endpoints

- `GET /` — serves the widget shell for development with HMR
- `POST /api/find` — local-only tool proxy (when not in Apps SDK)
	- Body: `{ product_query?: string, image_base64?: string }`
	- Response: structured `SustainableResult` with `text` and normalized fields
- `GET /api/image-proxy?url=...` — fetches remote images and serves with caching headers
- `POST /mcp` — streamable HTTP MCP transport

## NPM Scripts

- `dev` — kill HMR port (24678) if occupied, run `skybridge dev`
- `build` — `skybridge build` (uses `tsconfig.server.json` to emit server bundle)
- `start` — `skybridge start`
- `deploy` — `alpic deploy` to ship with Alpic

## Server: MCP Tool & Resource

- **Widget Resource** (`ui://widgets/apps-sdk/green-scanner.html`)
	- Registered with CSP and domain metadata for Apps SDK hosting
	- In dev, injects Vite client and mounts `web/src/widgets/green-scanner.tsx`

- **Tool**: `find_sustainable_alternative`
	- Input: `product_query` (string), `image_base64` (optional data URL)
	- Output: `{ content: [{ type: "text", text }], structuredContent: SustainableResult }`
	- Always attempts alternatives via categories (preferred) or query terms
	- Filters alternatives that are equal or better in Eco/Nutri vs scanned product
	- Ranks by Eco-Score (A → E → unknown)

Error handling:

- OFF API errors → return estimated details with a clear message
- No products found → return estimated details + gentle guidance

## Web: Widget UI

- Built with React + `skybridge/web` mount API
- Displays scanned product, eco/nutri badges, details list, estimated vs. real source indicator
- Alternatives grid with lazy “view more” (3 at a time)
- Supports drag-and-drop and file input for images; client-side compression for fast upload

Dev behaviors:

- If Apps SDK isn’t present, falls back to `POST /api/find`
- Uses `/api/image-proxy` to safely render remote product images

## API: Tool Input/Output

### Input (JSON)

```json
{
	"product_query": "Barilla Spaghetti",
	"image_base64": "data:image/jpeg;base64,..." // optional
}
```

### Output (MCP content + structured)

```json
{
	"content": [{ "type": "text", "text": "🔍 Scanned: ..." }],
	"structuredContent": {
		"text": "...",
		"product": {
			"name": "...",
			"brand": "...",
			"categories": "...",
			"packaging": "...",
			"labels": "...",
			"ingredients": "...",
			"ecoscore": "A|B|C|D|E|?",
			"nutriscore": "A|B|C|D|E|Unknown",
			"imageUrl": "http(s)://... | data:image/...",
			"ecoEstimated": true|false,
			"nutriEstimated": true|false,
			"detailsEstimated": true|false
		},
		"alternatives": [{ /* same shape as product */ }]
	}
}
```

## Connect to ChatGPT (Apps SDK)

This app registers a widget resource with metadata for Apps SDK hosting and a tool for ChatGPT to call.

Workflow basics:

1. Run `npm run dev` so the widget & MCP server are live.
2. In a ChatGPT Apps session, connect to the MCP server URL.
3. The app exposes `ui://widgets/apps-sdk/green-scanner.html` and `find_sustainable_alternative` for the LLM to use.

For broader guidance on building Apps and servers, see **SKILL.md** (ChatGPT App Builder guidance). Keep **SPEC.md** updated as the source of truth for UX and API decisions.

## Deployment

Use **Alpic** for managed builds and hosting:

```bash
npm run deploy
```

Steps:

1. Create or log in to your Alpic account
2. Connect the GitHub repository
3. Configure environment variables (BRAVE_API_KEY, OPENAI_API_KEY)
4. Deploy and obtain the public MCP base URL

## Troubleshooting

- Missing `OPENAI_API_KEY` → image-based identification and estimation won’t run
- Missing `BRAVE_API_KEY` → web enrichment may be weak; OFF-only mode
- OFF API rate-limits or outages → fallback estimation kicks in; expect degraded accuracy
- Images not rendering → ensure URLs are valid; try `/api/image-proxy`
- Port conflicts → `npm run dev` auto-kills Vite HMR port 24678; adjust `PORT` if needed
- Node version mismatch → ensure Node 24.13+ (per `package.json` engines)

## Acknowledgements

- Data courtesy of **Open Food Facts**
- Built with **Skybridge**, **Model Context Protocol**, **React**, and **Vite**

---

### Appendix: Project Docs & Guidance

- **AGENTS.md** — Internal instruction: explore project structure first; use ChatGPT App Builder guidance for documentation.
- **SKILL.md** — "chatgpt-app-builder" skill docs covering lifecycle: brainstorming, bootstrapping, tools/widgets, debugging, dev servers, deploying, and connecting apps to ChatGPT/Skybridge.
- **SPEC.md** — App specification (requirements and design). Keep this up to date as behavior or APIs evolve.
