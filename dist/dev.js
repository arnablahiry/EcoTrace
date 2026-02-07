import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import server, { buildSustainableAlternativeResult } from "./index.js";
import { mcp } from "./middleware.js";
const PORT = Number(process.env.PORT) || 3000;
const widgetName = "green-scanner";
async function start() {
    const app = express();
    app.use(express.json());
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const webRoot = path.resolve(__dirname, "../../web");
    const vite = await createViteServer({
        root: webRoot,
        server: { middlewareMode: true },
        appType: "custom",
    });
    app.get("/", (_req, res) => {
        const serverUrl = `http://localhost:${PORT}`;
        const widgetHtml = `<script type="module">window.skybridge = { hostType: "apps-sdk", serverUrl: "${serverUrl}" };</script>
<script type="module">
  import { injectIntoGlobalHook } from "${serverUrl}/assets/@react-refresh";
  injectIntoGlobalHook(window); window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module" src="${serverUrl}/@vite/client"></script>
<div id="root"></div>
<script type="module" id="dev-widget-entry">
  import("${serverUrl}/src/widgets/${widgetName}");
</script>`;
        res.status(200).type("text/html").send(widgetHtml);
    });
    app.post("/api/find", async (req, res) => {
        try {
            const { product_query, image_base64 } = req.body ?? {};
            const hasQuery = typeof product_query === "string" && product_query.trim().length > 0;
            const hasImage = typeof image_base64 === "string" && image_base64.length > 0;
            if (!hasQuery && !hasImage) {
                res.status(400).json({ error: "product_query or image_base64 is required." });
                return;
            }
            const safeQuery = hasQuery ? product_query : "";
            const result = await buildSustainableAlternativeResult(safeQuery, hasImage ? image_base64 : undefined);
            res.status(200).json(result);
        }
        catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    app.get("/api/image-proxy", async (req, res) => {
        try {
            const url = typeof req.query.url === "string" ? req.query.url : "";
            if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
                res.status(400).send("Invalid url");
                return;
            }
            const imageRes = await fetch(url);
            if (!imageRes.ok) {
                res.status(502).send("Failed to fetch image");
                return;
            }
            const contentType = imageRes.headers.get("content-type") || "image/jpeg";
            const buffer = Buffer.from(await imageRes.arrayBuffer());
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "no-store");
            res.status(200).send(buffer);
        }
        catch (error) {
            res.status(500).send("Image proxy error");
        }
    });
    app.use(vite.middlewares);
    app.use(mcp(server));
    app.listen(PORT, () => {
        console.log(`Server: http://localhost:${PORT}/`);
        console.log(`MCP:    http://localhost:${PORT}/mcp`);
    });
}
start().catch((error) => {
    console.error("Failed to start dev server:", error);
    process.exit(1);
});
//# sourceMappingURL=dev.js.map