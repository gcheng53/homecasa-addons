"use strict";
/**
 * HomeCasa Agent
 *
 * Local agent that runs inside Home Assistant as an add-on.
 * - Stores HA token locally (never leaves the network)
 * - Exposes API for HomeCasa to control devices
 * - Connects outward via Cloudflare Tunnel
 * - Authenticates remote requests with Agent API Key
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "5mb" }));
// Configuration from environment (set by run.sh from add-on config)
const config = {
    haUrl: process.env.HA_URL || process.env.HA_BASE_URL || "http://supervisor/core",
    haToken: process.env.HA_TOKEN || process.env.SUPERVISOR_TOKEN || "",
    agentApiKey: process.env.AGENT_API_KEY || "",
    homecasaCloudUrl: process.env.HOMECASA_CLOUD_URL || "https://homecasa.ai",
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || "30") * 1000,
    port: parseInt(process.env.PORT || "8099"),
    homeId: process.env.HOME_ID || "",
};
// Rate limiting state
const rateLimitMap = new Map();
const RATE_LIMIT = 100; // requests per minute
const RATE_WINDOW = 60000; // 1 minute
// Middleware: Rate limiting
function rateLimit(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + RATE_WINDOW };
        rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT) {
        return res.status(429).json({ error: "Rate limit exceeded" });
    }
    next();
}
// Check if an IP is in a private/local range
function isLocalIP(ip) {
    const cleaned = ip.replace(/^::ffff:/, "");
    if (cleaned === "127.0.0.1" || cleaned === "::1" || cleaned === "localhost") {
        return true;
    }
    if (cleaned.startsWith("192.168.") || cleaned.startsWith("10.")) {
        return true;
    }
    const match172 = cleaned.match(/^172\.(\d+)\./);
    if (match172) {
        const second = parseInt(match172[1], 10);
        return second >= 16 && second <= 31;
    }
    return false;
}
// Middleware: Agent API Key authentication (for remote requests)
function authenticateAgent(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || "";
    if (isLocalIP(ip)) {
        return next();
    }
    // Remote requests require API key (supports both header formats)
    const agentKeyHeader = req.headers["x-agent-api-key"];
    const authHeader = req.headers.authorization;
    let providedKey = "";
    if (agentKeyHeader) {
        providedKey = agentKeyHeader;
    }
    else if (authHeader && authHeader.startsWith("Bearer ")) {
        providedKey = authHeader.substring(7);
    }
    if (!providedKey) {
        return res.status(401).json({ error: "Missing authorization" });
    }
    if (providedKey !== config.agentApiKey) {
        return res.status(401).json({ error: "Invalid API key" });
    }
    next();
}
// Helper: Call Home Assistant API
async function callHA(method, endpoint, body) {
    try {
        const url = `${config.haUrl}/api${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${config.haToken}`,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const text = await response.text();
            return { success: false, error: `HA API error ${response.status}: ${text}` };
        }
        const data = await response.json();
        return { success: true, data };
    }
    catch (error) {
        return { success: false, error: String(error) };
    }
}
// Apply middleware
app.use(rateLimit);
// ==================== Agent API Endpoints ====================
// ==================== TTS Audio Cache ====================
const ttsCache = new Map();
const TTS_CACHE_MAX = 20;
const TTS_CACHE_TTL = 5 * 60 * 1000;
function cleanTtsCache() {
    const now = Date.now();
    for (const [id, entry] of ttsCache.entries()) {
        if (now - entry.createdAt > TTS_CACHE_TTL) {
            ttsCache.delete(id);
        }
    }
    if (ttsCache.size >= TTS_CACHE_MAX) {
        const oldest = [...ttsCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
        if (oldest)
            ttsCache.delete(oldest[0]);
    }
}
let cachedHaInternalUrl = null;
async function getHaInternalUrl() {
    if (cachedHaInternalUrl)
        return cachedHaInternalUrl;
    try {
        const result = await callHA("GET", "/config");
        if (result.success && result.data) {
            const internal = result.data.internal_url || result.data.external_url;
            if (internal) {
                cachedHaInternalUrl = internal.replace(/\/$/, "");
                return cachedHaInternalUrl;
            }
        }
    }
    catch (e) {
        console.error("[Agent] Failed to get HA internal URL:", e);
    }
    return `http://homeassistant.local:8123`;
}
// POST /api/tts-cache - Receive OpenAI TTS audio from Cloud and cache locally
app.post("/api/tts-cache", authenticateAgent, async (req, res) => {
    const { audio, id } = req.body;
    if (!audio || !id) {
        return res.status(400).json({ error: "audio (base64) and id are required" });
    }
    if (typeof audio !== "string" || audio.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: "audio must be base64 string under 2MB" });
    }
    try {
        cleanTtsCache();
        const buffer = Buffer.from(audio, "base64");
        if (buffer.length > 1.5 * 1024 * 1024) {
            return res.status(400).json({ error: "Decoded audio exceeds 1.5MB" });
        }
        ttsCache.set(id, { buffer, createdAt: Date.now() });
        const reqHost = req.headers.host || `localhost:${config.port}`;
        const hostParts = reqHost.split(":");
        let agentHostname = hostParts[0];
        if (agentHostname === "localhost" || agentHostname === "127.0.0.1" || agentHostname.includes("homecasa.ai")) {
            const haUrl = await getHaInternalUrl();
            try {
                const parsed = new URL(haUrl);
                agentHostname = parsed.hostname;
            }
            catch { }
        }
        const localAudioUrl = `http://${agentHostname}:${config.port}/tts-cache/${id}.mp3`;
        console.log(`[Agent] TTS cached: ${id} (${buffer.length} bytes), serving at ${localAudioUrl}`);
        res.json({ success: true, url: localAudioUrl });
    }
    catch (error) {
        console.error("[Agent] TTS cache error:", error);
        res.status(500).json({ error: String(error) });
    }
});
// GET /tts-cache/:id.mp3 - Serve cached TTS audio (no auth - Cast speakers need direct access)
app.get("/tts-cache/:id.mp3", (req, res) => {
    const id = req.params.id;
    const entry = ttsCache.get(id);
    if (!entry) {
        return res.status(404).json({ error: "Audio not found or expired" });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", entry.buffer.length);
    res.setHeader("Cache-Control", "no-cache");
    res.send(entry.buffer);
});
// GET /health - Health check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        mode: "agent",
        version: "1.1.0",
        haConfigured: !!config.haToken,
        ttsCacheSupported: true,
        timestamp: new Date().toISOString(),
    });
});
// GET /ha/states - Get all entity states (proxies to HA /api/states)
app.get("/ha/states", authenticateAgent, async (req, res) => {
    const result = await callHA("GET", "/states");
    if (!result.success) {
        return res.status(500).json({ error: result.error });
    }
    res.json(result.data);
});
// GET /ha/states/:entityId - Get specific entity state
app.get("/ha/states/:entityId", authenticateAgent, async (req, res) => {
    const entityId = decodeURIComponent(req.params.entityId);
    const result = await callHA("GET", `/states/${entityId}`);
    if (!result.success) {
        return res.status(404).json({ error: result.error });
    }
    res.json(result.data);
});
// GET /ha/zha/device-ieee/:entityId - Get ZHA IEEE address for an entity
app.get("/ha/zha/device-ieee/:entityId", authenticateAgent, async (req, res) => {
    const entityId = decodeURIComponent(req.params.entityId);
    const entityReg = await callHA("GET", "/config/entity_registry/list");
    if (!entityReg.success || !entityReg.data) {
        return res.status(500).json({ error: "Failed to get entity registry" });
    }
    const entity = entityReg.data.find((e) => e.entity_id === entityId);
    if (!entity || !entity.device_id) {
        return res.status(404).json({ error: "Entity not found in registry" });
    }
    const deviceReg = await callHA("GET", "/config/device_registry/list");
    if (!deviceReg.success || !deviceReg.data) {
        return res.status(500).json({ error: "Failed to get device registry" });
    }
    const device = deviceReg.data.find((d) => d.id === entity.device_id);
    if (!device) {
        return res.status(404).json({ error: "Device not found in registry" });
    }
    let ieee = null;
    for (const identifier of (device.identifiers || [])) {
        if (Array.isArray(identifier) && identifier[0] === "zha" && identifier[1]) {
            ieee = identifier[1];
            break;
        }
    }
    if (!ieee) {
        return res.status(404).json({ error: "No ZHA IEEE address found for this device" });
    }
    res.json({ success: true, ieee, deviceName: device.name_by_user || device.name || entityId });
});
// POST /ha/call-service - Call a Home Assistant service
app.post("/ha/call-service", authenticateAgent, async (req, res) => {
    const { domain, service, entity_id, data, service_data } = req.body;
    if (!domain || !service) {
        return res.status(400).json({ error: "domain and service are required" });
    }
    const extraData = service_data || data || {};
    const serviceData = { ...extraData };
    if (entity_id) {
        serviceData.entity_id = entity_id;
    }
    const result = await callHA("POST", `/services/${domain}/${service}`, serviceData);
    if (!result.success) {
        return res.status(500).json({ error: result.error });
    }
    res.json({ success: true, result: result.data });
});
// POST /ha/toggle - Toggle an entity
app.post("/ha/toggle", authenticateAgent, async (req, res) => {
    const { entity_id } = req.body;
    if (!entity_id) {
        return res.status(400).json({ error: "entity_id is required" });
    }
    const domain = entity_id.split(".")[0];
    const result = await callHA("POST", `/services/${domain}/toggle`, { entity_id });
    if (!result.success) {
        return res.status(500).json({ error: result.error });
    }
    res.json({ success: true, entity_id });
});
// POST /ha/turn-on - Turn on an entity
app.post("/ha/turn-on", authenticateAgent, async (req, res) => {
    const { entity_id, brightness } = req.body;
    if (!entity_id) {
        return res.status(400).json({ error: "entity_id is required" });
    }
    const domain = entity_id.split(".")[0];
    const data = { entity_id };
    if (brightness !== undefined && domain === "light") {
        data.brightness_pct = brightness;
    }
    const result = await callHA("POST", `/services/${domain}/turn_on`, data);
    if (!result.success) {
        return res.status(500).json({ error: result.error });
    }
    res.json({ success: true, entity_id });
});
// POST /ha/turn-off - Turn off an entity
app.post("/ha/turn-off", authenticateAgent, async (req, res) => {
    const { entity_id } = req.body;
    if (!entity_id) {
        return res.status(400).json({ error: "entity_id is required" });
    }
    const domain = entity_id.split(".")[0];
    const result = await callHA("POST", `/services/${domain}/turn_off`, { entity_id });
    if (!result.success) {
        return res.status(500).json({ error: result.error });
    }
    res.json({ success: true, entity_id });
});
// ==================== PWA Static File Serving ====================
const PWA_DIR = path.resolve(process.cwd(), "pwa");
let pwaVersion = "";
function ensurePwaDir() {
    if (!fs.existsSync(PWA_DIR)) {
        fs.mkdirSync(PWA_DIR, { recursive: true });
    }
}
async function syncPwaFromCloud() {
    if (!config.homecasaCloudUrl) {
        console.log("[Agent/PWA] No cloud URL configured, skipping sync");
        return false;
    }
    try {
        const versionRes = await fetch(`${config.homecasaCloudUrl}/api/pwa/version`);
        if (!versionRes.ok) {
            console.warn("[Agent/PWA] Failed to fetch version:", versionRes.status);
            return false;
        }
        const { version } = await versionRes.json();
        if (version === pwaVersion && fs.existsSync(path.join(PWA_DIR, "index.html"))) {
            console.log("[Agent/PWA] Already up to date:", version);
            return true;
        }
        console.log(`[Agent/PWA] New version available: ${version} (current: ${pwaVersion || "none"})`);
        const manifestRes = await fetch(`${config.homecasaCloudUrl}/api/pwa/manifest`);
        if (!manifestRes.ok) {
            console.warn("[Agent/PWA] Failed to fetch manifest:", manifestRes.status);
            return false;
        }
        const { files } = await manifestRes.json();
        console.log(`[Agent/PWA] Downloading ${files.length} files...`);
        ensurePwaDir();
        let downloaded = 0;
        for (const file of files) {
            try {
                const fileRes = await fetch(`${config.homecasaCloudUrl}/api/pwa/file/${file.path}`);
                if (!fileRes.ok) {
                    console.warn(`[Agent/PWA] Failed to download ${file.path}: ${fileRes.status}`);
                    continue;
                }
                const buffer = Buffer.from(await fileRes.arrayBuffer());
                const filePath = path.join(PWA_DIR, file.path);
                const fileDir = path.dirname(filePath);
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }
                fs.writeFileSync(filePath, buffer);
                downloaded++;
            }
            catch (err) {
                console.warn(`[Agent/PWA] Error downloading ${file.path}:`, err);
            }
        }
        pwaVersion = version;
        console.log(`[Agent/PWA] Sync complete: ${downloaded}/${files.length} files (version: ${version})`);
        return true;
    }
    catch (err) {
        console.error("[Agent/PWA] Sync error:", err);
        return false;
    }
}
app.get("/pwa/version", (_req, res) => {
    res.json({ version: pwaVersion, hasPwa: fs.existsSync(path.join(PWA_DIR, "index.html")) });
});
app.use((req, res, next) => {
    if (req.path.startsWith("/ha/") || req.path.startsWith("/api/") ||
        req.path.startsWith("/health") || req.path.startsWith("/tts-cache/") ||
        req.path.startsWith("/pwa/")) {
        return next();
    }
    const pwaIndexPath = path.join(PWA_DIR, "index.html");
    if (!fs.existsSync(pwaIndexPath)) {
        return next();
    }
    const filePath = path.join(PWA_DIR, req.path === "/" ? "index.html" : req.path);
    const safePath = path.normalize(filePath);
    if (!safePath.startsWith(PWA_DIR)) {
        return res.status(403).send("Forbidden");
    }
    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const mimeTypes = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
            ".webp": "image/webp",
            ".webmanifest": "application/manifest+json",
        };
        if (mimeTypes[ext]) {
            res.setHeader("Content-Type", mimeTypes[ext]);
        }
        return res.sendFile(safePath);
    }
    res.setHeader("Content-Type", "text/html");
    return res.sendFile(pwaIndexPath);
});
const SYNC_DIR = path.join(process.cwd(), "data", "homecasa");
const SYNC_FILE = path.join(SYNC_DIR, "sync-bundle.json");
const CONFIG_SYNC_INTERVAL = 30000;
let currentSyncVersion = 0;
let syncedBundle = null;
let syncHomeId = "";
function loadSyncBundle() {
    try {
        if (fs.existsSync(SYNC_FILE)) {
            const data = JSON.parse(fs.readFileSync(SYNC_FILE, "utf-8"));
            syncedBundle = data;
            currentSyncVersion = data.syncVersion || 0;
            syncHomeId = data.homeId || "";
            console.log(`[Agent/Sync] Loaded bundle v${currentSyncVersion} for home ${syncHomeId} (${data.automations?.length || 0} automations)`);
        }
    }
    catch (err) {
        console.error("[Agent/Sync] Error loading bundle:", err);
    }
}
function saveSyncBundle(bundle) {
    try {
        if (!fs.existsSync(SYNC_DIR)) {
            fs.mkdirSync(SYNC_DIR, { recursive: true });
        }
        fs.writeFileSync(SYNC_FILE, JSON.stringify(bundle, null, 2), "utf-8");
    }
    catch (err) {
        console.error("[Agent/Sync] Error saving bundle:", err);
    }
}
async function syncConfigFromCloud() {
    if (!config.homecasaCloudUrl || !config.agentApiKey) {
        return false;
    }
    try {
        const headers = { "X-Agent-Api-Key": config.agentApiKey };
        if (!syncHomeId) {
            console.log("[Agent/Sync] No homeId known yet, skipping version check");
            return false;
        }
        const versionRes = await fetch(`${config.homecasaCloudUrl}/api/sync/${syncHomeId}/version`, { headers });
        if (!versionRes.ok) {
            console.warn(`[Agent/Sync] Version check failed: ${versionRes.status}`);
            return false;
        }
        const { syncVersion } = await versionRes.json();
        if (syncVersion <= currentSyncVersion && syncedBundle !== null) {
            return true;
        }
        console.log(`[Agent/Sync] New config version: ${syncVersion} (current: ${currentSyncVersion})`);
        const bundleRes = await fetch(`${config.homecasaCloudUrl}/api/sync/${syncHomeId}/bundle`, { headers });
        if (!bundleRes.ok) {
            console.warn(`[Agent/Sync] Bundle fetch failed: ${bundleRes.status}`);
            return false;
        }
        const bundle = await bundleRes.json();
        syncedBundle = bundle;
        currentSyncVersion = bundle.syncVersion;
        saveSyncBundle(bundle);
        console.log(`[Agent/Sync] Synced v${currentSyncVersion}: ${bundle.automations.length} automations`);
        return true;
    }
    catch (err) {
        console.error("[Agent/Sync] Sync error:", err);
        return false;
    }
}
app.get("/api/sync/status", authenticateAgent, (_req, res) => {
    res.json({
        homeId: syncHomeId,
        syncVersion: currentSyncVersion,
        automationCount: syncedBundle?.automations?.length || 0,
        localAutomationsActive: localAutomationsEnabled,
        lastSync: syncedBundle?.timestamp || null,
    });
});
// ==================== LOCAL AUTOMATION ENGINE ====================
let localAutomationsEnabled = true;
const automationCooldowns = new Map();
const entityStates = new Map();
const previousEntityStates = new Map();
const BUTTON_CMD_MAP = {
    button_single: ["single", "toggle", "1", "click", "single_click", "remote_button_short_press", "remote_button_short_release", "button_single", "short_press", "press"],
    button_double: ["double", "2", "double_click", "remote_button_double_press", "button_double", "double_press"],
    button_long: ["long", "hold", "long_press", "long_click", "remote_button_long_press", "remote_button_long_release", "button_long", "long_release"],
    button_triple: ["triple", "3", "triple_click", "remote_button_triple_press", "button_triple", "triple_press"],
};
const processedZhaTimestamps = new Map();
function evaluateLocalTrigger(trigger, zhaEvent) {
    if (trigger.type === "sensor" && trigger.comparator?.startsWith("button_")) {
        if (!zhaEvent)
            return false;
        if (trigger.sensorEntityId !== zhaEvent.device_ieee && trigger.sensorEntityId !== zhaEvent.unique_id)
            return false;
        const targetCmds = BUTTON_CMD_MAP[trigger.comparator] || [];
        const cmd = (zhaEvent.command || "").toLowerCase();
        return targetCmds.includes(cmd);
    }
    if (trigger.type === "sensor") {
        const entityId = trigger.sensorEntityId;
        const currentState = entityStates.get(entityId);
        const prevState = previousEntityStates.get(entityId);
        if (!currentState)
            return false;
        switch (trigger.comparator) {
            case "turns_on": return currentState === "on" && prevState !== "on";
            case "turns_off": return currentState === "off" && prevState !== "off";
            case "opens": return currentState === "on" && prevState !== "on";
            case "closes": return currentState === "off" && prevState !== "off";
            case "motion_detected": return currentState === "on" && prevState !== "on";
            case "no_motion": return currentState === "off" && prevState !== "off";
            case "above": {
                const val = parseFloat(currentState);
                const threshold = parseFloat(trigger.value || "0");
                return !isNaN(val) && val > threshold;
            }
            case "below": {
                const val = parseFloat(currentState);
                const threshold = parseFloat(trigger.value || "0");
                return !isNaN(val) && val < threshold;
            }
            default: return false;
        }
    }
    if (trigger.type === "time") {
        const now = new Date();
        const localHour = now.getHours();
        const localMinute = now.getMinutes();
        const targetH = parseInt(trigger.hour || "0");
        const targetM = parseInt(trigger.minute || "0");
        if (localHour !== targetH || localMinute !== targetM)
            return false;
        if (trigger.days && Array.isArray(trigger.days) && trigger.days.length > 0) {
            const dayOfWeek = now.getDay();
            if (!trigger.days.includes(dayOfWeek))
                return false;
        }
        return true;
    }
    return false;
}
function evaluateLocalTriggerGroups(triggerGroups, zhaEvent) {
    for (const group of triggerGroups) {
        const triggers = group.triggers || [];
        const anyMatch = triggers.some((t) => evaluateLocalTrigger(t, zhaEvent));
        if (!anyMatch)
            return false;
    }
    return true;
}
async function executeLocalAction(action) {
    if (action.type === "device") {
        const entityId = action.entityId;
        if (!entityId)
            return;
        const domain = entityId.split(".")[0];
        let service = "toggle";
        switch (action.action) {
            case "turnOn":
                service = "turn_on";
                break;
            case "turnOff":
                service = "turn_off";
                break;
            case "toggle":
                service = "toggle";
                break;
            case "openCurtain":
                service = "open_cover";
                break;
            case "closeCurtain":
                service = "close_cover";
                break;
            default: service = "toggle";
        }
        const serviceData = { entity_id: entityId };
        if (action.brightness !== undefined)
            serviceData.brightness = Math.round(action.brightness * 2.55);
        if (action.temperature !== undefined)
            serviceData.temperature = action.temperature;
        try {
            const res = await fetch(`${config.haUrl}/api/services/${domain}/${service}`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${config.haToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(serviceData),
            });
            console.log(`[Agent/Auto] Executed ${domain}.${service} on ${entityId}: ${res.status}`);
        }
        catch (err) {
            console.error(`[Agent/Auto] Failed to execute ${domain}.${service} on ${entityId}:`, err);
        }
    }
    else if (action.type === "scene") {
        if (action.resolvedSceneActions && action.resolvedSceneActions.length > 0) {
            console.log(`[Agent/Auto] Executing scene "${action.sceneName}" with ${action.resolvedSceneActions.length} resolved actions`);
            for (const sa of action.resolvedSceneActions) {
                await executeLocalAction({ type: "device", entityId: sa.entityId, action: sa.action, temperature: sa.value });
            }
        }
        else {
            const sceneEntityId = action.sceneEntityId || action.entityId;
            if (!sceneEntityId)
                return;
            try {
                const res = await fetch(`${config.haUrl}/api/services/scene/turn_on`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${config.haToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ entity_id: sceneEntityId }),
                });
                console.log(`[Agent/Auto] Activated scene ${sceneEntityId}: ${res.status}`);
            }
            catch (err) {
                console.error(`[Agent/Auto] Failed to activate scene ${sceneEntityId}:`, err);
            }
        }
    }
}
async function processLocalAutomations(zhaEvent) {
    if (!localAutomationsEnabled || !syncedBundle?.automations)
        return;
    const mode = syncedBundle.homePreferences?.automationMode || "cloud";
    if (mode !== "local")
        return;
    const now = Date.now();
    for (const automation of syncedBundle.automations) {
        if (!automation.enabled)
            continue;
        const cooldownMs = (automation.cooldownMinutes != null && automation.cooldownMinutes > 0 ? automation.cooldownMinutes : 0.05) * 60 * 1000;
        const lastFired = automationCooldowns.get(automation.id) || 0;
        if (now - lastFired < cooldownMs)
            continue;
        const triggered = evaluateLocalTriggerGroups(automation.triggerGroups, zhaEvent);
        if (!triggered)
            continue;
        console.log(`[Agent/Auto] Automation "${automation.name}" triggered locally!`);
        automationCooldowns.set(automation.id, now);
        for (const action of automation.actions) {
            await executeLocalAction(action);
        }
    }
}
const zhaEventBuffer = [];
const ZHA_EVENT_BUFFER_MAX = 100;
let wsConnected = false;
let wsReconnectTimer = null;
let wsMsgId = 1;
function connectHaWebSocket() {
    const wsUrl = config.haUrl.replace(/^http/, "ws") + "/websocket";
    console.log(`[Agent/WS] Connecting to HA WebSocket: ${wsUrl}`);
    let ws;
    try {
        const WebSocket = require("ws");
        ws = new WebSocket(wsUrl);
    }
    catch (e) {
        console.error("[Agent/WS] WebSocket module not available:", e);
        return;
    }
    ws.on("open", () => {
        console.log("[Agent/WS] WebSocket connected");
    });
    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "auth_required") {
                ws.send(JSON.stringify({ type: "auth", access_token: config.haToken }));
            }
            else if (msg.type === "auth_ok") {
                wsConnected = true;
                console.log("[Agent/WS] Authenticated, subscribing to events...");
                ws.send(JSON.stringify({
                    id: wsMsgId++,
                    type: "subscribe_events",
                    event_type: "zha_event",
                }));
                ws.send(JSON.stringify({
                    id: wsMsgId++,
                    type: "subscribe_events",
                    event_type: "state_changed",
                }));
            }
            else if (msg.type === "auth_invalid") {
                console.error("[Agent/WS] Auth failed:", msg.message);
                wsConnected = false;
                ws.close();
            }
            else if (msg.type === "event" && msg.event?.event_type === "zha_event") {
                const data = msg.event.data || {};
                const event = {
                    command: data.command || "unknown",
                    device_ieee: data.device_ieee || "",
                    unique_id: data.unique_id || "",
                    args: data.args,
                    params: data.params,
                    timestamp: new Date().toISOString(),
                };
                console.log(`[Agent/ZHA] Event: ${event.command} from ${event.device_ieee}`);
                zhaEventBuffer.unshift(event);
                if (zhaEventBuffer.length > ZHA_EVENT_BUFFER_MAX) {
                    zhaEventBuffer.length = ZHA_EVENT_BUFFER_MAX;
                }
                for (const client of sseClients) {
                    try {
                        client.write(`data: ${JSON.stringify(event)}\n\n`);
                    }
                    catch { }
                }
                const eventKey = `${event.device_ieee}::${event.command}`;
                const lastTs = processedZhaTimestamps.get(eventKey);
                if (lastTs !== event.timestamp) {
                    processedZhaTimestamps.set(eventKey, event.timestamp);
                    processLocalAutomations(event);
                }
            }
            else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
                const data = msg.event.data || {};
                const entityId = data.entity_id;
                const newState = data.new_state?.state;
                const oldState = data.old_state?.state;
                if (entityId && newState !== undefined) {
                    previousEntityStates.set(entityId, oldState || "");
                    entityStates.set(entityId, newState);
                    if (oldState !== newState) {
                        processLocalAutomations();
                    }
                }
            }
        }
        catch (e) {
            console.error("[Agent/WS] Parse error:", e);
        }
    });
    ws.on("close", () => {
        console.log("[Agent/WS] WebSocket closed, reconnecting in 10s...");
        wsConnected = false;
        if (wsReconnectTimer)
            clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(connectHaWebSocket, 10000);
    });
    ws.on("error", (err) => {
        console.error("[Agent/WS] WebSocket error:", err.message || err);
    });
}
const sseClients = new Set();
app.get("/ha/zha-events", authenticateAgent, (req, res) => {
    const ieee = req.query.ieee;
    const limit = Math.min(parseInt(req.query.limit) || 50, ZHA_EVENT_BUFFER_MAX);
    let events = zhaEventBuffer;
    if (ieee) {
        events = events.filter(e => e.device_ieee === ieee);
    }
    res.json({ success: true, connected: wsConnected, events: events.slice(0, limit) });
});
app.get("/ha/zha-events/stream", authenticateAgent, (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "connected", wsConnected, buffered: zhaEventBuffer.length })}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
        sseClients.delete(res);
    });
});
// ==================== Heartbeat to HomeCasa Cloud ====================
async function sendHeartbeat() {
    if (!config.agentApiKey || !config.homecasaCloudUrl) {
        return;
    }
    try {
        const response = await fetch(`${config.homecasaCloudUrl}/api/agent/heartbeat`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.agentApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                timestamp: Date.now(),
            }),
        });
        if (response.ok) {
            console.log("[Agent] Heartbeat sent successfully");
        }
        else {
            console.warn("[Agent] Heartbeat failed:", response.status);
        }
    }
    catch (error) {
        console.error("[Agent] Heartbeat error:", error);
    }
}
// Start heartbeat interval
if (config.heartbeatInterval > 0) {
    setInterval(sendHeartbeat, config.heartbeatInterval);
    // Send initial heartbeat after startup
    setTimeout(sendHeartbeat, 5000);
}
// ==================== Start Server ====================
const PWA_SYNC_INTERVAL = 30 * 60 * 1000;
loadSyncBundle();
if (config.homeId && !syncHomeId) {
    syncHomeId = config.homeId;
}
app.listen(config.port, "0.0.0.0", () => {
    console.log(`[Agent] HomeCasa Agent running on port ${config.port}`);
    console.log(`[Agent] HA URL: ${config.haUrl}`);
    console.log(`[Agent] HA Token configured: ${config.haToken ? "Yes" : "No"}`);
    console.log(`[Agent] Agent API Key configured: ${config.agentApiKey ? "Yes" : "No"}`);
    console.log(`[Agent] Home ID: ${syncHomeId || "(not set)"}`);
    console.log(`[Agent] Local automations: ${localAutomationsEnabled ? "enabled" : "disabled"}`);
    connectHaWebSocket();
    setTimeout(async () => {
        console.log("[Agent/PWA] Initial sync starting...");
        await syncPwaFromCloud();
    }, 10000);
    setInterval(async () => {
        console.log("[Agent/PWA] Periodic sync check...");
        await syncPwaFromCloud();
    }, PWA_SYNC_INTERVAL);
    setTimeout(async () => {
        console.log("[Agent/Sync] Initial config sync starting...");
        await syncConfigFromCloud();
    }, 5000);
    setInterval(async () => {
        await syncConfigFromCloud();
    }, CONFIG_SYNC_INTERVAL);
    setInterval(() => {
        processLocalAutomations();
    }, 1000);
});
