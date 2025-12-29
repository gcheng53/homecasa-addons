const express = require('express');
const http = require('http');
const https = require('https');

const app = express();

// CORS middleware - allow requests from any origin (browser-based PWA)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Agent-Api-Key');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const PORT = process.env.PORT || 8099;
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const HA_TOKEN = process.env.HA_TOKEN;
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

// Determine which token to use and the correct base URL
// SUPERVISOR_TOKEN works with http://supervisor/core (add-on internal communication)
// HA_TOKEN (Long-Lived Access Token) requires http://homeassistant.local:8123 or similar
const EFFECTIVE_HA_TOKEN = SUPERVISOR_TOKEN || HA_TOKEN;
const TOKEN_SOURCE = SUPERVISOR_TOKEN ? 'SUPERVISOR_TOKEN' : (HA_TOKEN ? 'HA_TOKEN' : 'NONE');

// Use the appropriate base URL based on token source
// When using SUPERVISOR_TOKEN, use the supervisor proxy
// When using HA_TOKEN (long-lived access token), must use homeassistant directly
// Note: Inside HA add-on Docker network, use 'homeassistant:8123' not 'homeassistant.local:8123'
const HA_BASE_URL = SUPERVISOR_TOKEN 
  ? 'http://supervisor/core'
  : (process.env.HA_BASE_URL || 'http://homeassistant:8123');

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = data 
    ? `[${timestamp}] [${level}] ${message} :: ${JSON.stringify(data)}`
    : `[${timestamp}] [${level}] ${message}`;
  console.log(logLine);
}

function authMiddleware(req, res, next) {
  if (req.path === '/health') {
    return next();
  }
  
  // Accept API key from multiple sources for compatibility:
  // 1. X-Agent-Api-Key header (preferred)
  // 2. Authorization: Bearer <key> header
  const apiKey = req.headers['x-agent-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!AGENT_API_KEY) {
    log('warn', 'No AGENT_API_KEY configured - authentication disabled');
    return next();
  }
  
  if (apiKey !== AGENT_API_KEY) {
    log('warn', 'Invalid API key', { path: req.path, providedKey: apiKey ? apiKey.substring(0, 10) + '...' : 'none' });
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
  }
  
  next();
}

app.use(authMiddleware);

async function haRequest(method, path, body = null) {
  if (!EFFECTIVE_HA_TOKEN) {
    throw new Error('No HA token configured');
  }
  
  // Build the full URL properly - concatenate base + path to avoid URL constructor issues
  // URL constructor with absolute path (/api/...) would replace the base path (/core)
  const fullUrl = HA_BASE_URL.replace(/\/$/, '') + path;
  const startTime = Date.now();
  
  log('debug', `HA request using ${TOKEN_SOURCE}`, { 
    method, 
    path,
    fullUrl,
    tokenPreview: EFFECTIVE_HA_TOKEN.substring(0, 10) + '...' 
  });
  
  const url = new URL(fullUrl);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Authorization': `Bearer ${EFFECTIVE_HA_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  
  // Use Promise.race for reliable timeout (covers slow responses, not just socket timeout)
  const REQUEST_TIMEOUT = 15000; // 15 seconds to allow for large responses
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`));
    }, REQUEST_TIMEOUT);
  });
  
  const requestPromise = new Promise((resolve, reject) => {
    const req = httpModule.request(options, (res) => {
      let data = '';
      log('debug', 'HA response started', { statusCode: res.statusCode, path });
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        const duration = Date.now() - startTime;
        log('debug', 'HA response complete', { 
          statusCode: res.statusCode, 
          path, 
          duration: `${duration}ms`,
          dataLength: data.length 
        });
        
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || `HA returned ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          if (res.statusCode >= 400) {
            reject(new Error(`HA returned ${res.statusCode}: ${data.substring(0, 200)}`));
          } else {
            resolve(data);
          }
        }
      });
    });
    
    req.on('error', (err) => {
      log('error', 'HA request error', { path, error: err.message });
      reject(err);
    });
    
    // Socket-level timeout as backup
    req.setTimeout(REQUEST_TIMEOUT + 5000, () => {
      log('error', 'Socket timeout', { path });
      req.destroy();
      reject(new Error('Socket timeout'));
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
  
  return Promise.race([requestPromise, timeoutPromise]);
}

app.get('/health', (req, res) => {
  log('info', 'Health check');
  res.json({
    status: 'ok',
    agent: 'homecasa-agent',
    version: '1.0.7',
    timestamp: new Date().toISOString(),
    ha_configured: !!(SUPERVISOR_TOKEN || HA_TOKEN),
    token_source: TOKEN_SOURCE,
    supervisor_token_present: !!SUPERVISOR_TOKEN,
    ha_token_present: !!HA_TOKEN,
    ha_base_url: HA_BASE_URL,
  });
});

app.get('/ha/states', async (req, res) => {
  try {
    log('info', 'Fetching HA states');
    const states = await haRequest('GET', '/api/states');
    log('info', 'Fetched HA states successfully', { count: Array.isArray(states) ? states.length : 'N/A' });
    res.json(states);
  } catch (err) {
    log('error', 'Failed to fetch states', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch states', message: err.message });
  }
});

app.get('/ha/states/:entityId', async (req, res) => {
  try {
    const { entityId } = req.params;
    log('info', 'Fetching entity state', { entityId });
    const state = await haRequest('GET', `/api/states/${entityId}`);
    res.json(state);
  } catch (err) {
    log('error', 'Failed to fetch entity state', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch entity state', message: err.message });
  }
});

app.post('/ha/call-service', async (req, res) => {
  try {
    const { domain, service, entity_id, service_data } = req.body;
    
    if (!domain || !service) {
      return res.status(400).json({ error: 'Missing domain or service' });
    }
    
    log('info', 'Calling HA service', { domain, service, entity_id });
    
    const payload = { ...service_data };
    if (entity_id) {
      payload.entity_id = entity_id;
    }
    
    const result = await haRequest('POST', `/api/services/${domain}/${service}`, payload);
    res.json({ success: true, result });
  } catch (err) {
    log('error', 'Failed to call service', { error: err.message });
    res.status(500).json({ error: 'Failed to call service', message: err.message });
  }
});

app.post('/ha/toggle', async (req, res) => {
  try {
    const { entity_id } = req.body;
    
    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }
    
    const domain = entity_id.split('.')[0];
    log('info', 'Toggling entity', { entity_id, domain });
    
    const result = await haRequest('POST', `/api/services/${domain}/toggle`, { entity_id });
    res.json({ success: true, result });
  } catch (err) {
    log('error', 'Failed to toggle entity', { error: err.message });
    res.status(500).json({ error: 'Failed to toggle', message: err.message });
  }
});

app.post('/ha/turn-on', async (req, res) => {
  try {
    const { entity_id, brightness, brightness_pct } = req.body;
    
    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }
    
    const domain = entity_id.split('.')[0];
    log('info', 'Turning on entity', { entity_id, domain, brightness_pct });
    
    const payload = { entity_id };
    if (brightness !== undefined) payload.brightness = brightness;
    if (brightness_pct !== undefined) payload.brightness_pct = brightness_pct;
    
    const result = await haRequest('POST', `/api/services/${domain}/turn_on`, payload);
    res.json({ success: true, result });
  } catch (err) {
    log('error', 'Failed to turn on entity', { error: err.message });
    res.status(500).json({ error: 'Failed to turn on', message: err.message });
  }
});

app.post('/ha/turn-off', async (req, res) => {
  try {
    const { entity_id } = req.body;
    
    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }
    
    const domain = entity_id.split('.')[0];
    log('info', 'Turning off entity', { entity_id, domain });
    
    const result = await haRequest('POST', `/api/services/${domain}/turn_off`, { entity_id });
    res.json({ success: true, result });
  } catch (err) {
    log('error', 'Failed to turn off entity', { error: err.message });
    res.status(500).json({ error: 'Failed to turn off', message: err.message });
  }
});

app.get('/ha/config', async (req, res) => {
  try {
    log('info', 'Fetching HA config');
    const config = await haRequest('GET', '/api/config');
    res.json(config);
  } catch (err) {
    log('error', 'Failed to fetch config', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch config', message: err.message });
  }
});

// Also expose standard HA API paths for compatibility
// This allows the Agent to act as a drop-in proxy for HA
app.get('/api/states', async (req, res) => {
  try {
    log('info', 'Proxy: Fetching HA states via /api/states');
    const states = await haRequest('GET', '/api/states');
    res.json(states);
  } catch (err) {
    log('error', 'Proxy: Failed to fetch states', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch states', message: err.message });
  }
});

app.get('/api/states/:entityId', async (req, res) => {
  try {
    const { entityId } = req.params;
    log('info', 'Proxy: Fetching entity state', { entityId });
    const state = await haRequest('GET', `/api/states/${entityId}`);
    res.json(state);
  } catch (err) {
    log('error', 'Proxy: Failed to fetch entity state', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch entity state', message: err.message });
  }
});

app.get('/api/config', async (req, res) => {
  try {
    log('info', 'Proxy: Fetching HA config via /api/config');
    const config = await haRequest('GET', '/api/config');
    res.json(config);
  } catch (err) {
    log('error', 'Proxy: Failed to fetch config', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch config', message: err.message });
  }
});

app.post('/api/services/:domain/:service', async (req, res) => {
  try {
    const { domain, service } = req.params;
    log('info', 'Proxy: Calling HA service', { domain, service });
    const result = await haRequest('POST', `/api/services/${domain}/${service}`, req.body);
    res.json(result);
  } catch (err) {
    log('error', 'Proxy: Failed to call service', { error: err.message });
    res.status(500).json({ error: 'Failed to call service', message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  log('info', `HomeCasa Agent listening on port ${PORT}`);
  log('info', `HA Base URL: ${HA_BASE_URL}`);
  log('info', `Auth configured: ${!!AGENT_API_KEY}`);
  log('info', `HA token source: ${TOKEN_SOURCE}`);
  log('info', `SUPERVISOR_TOKEN present: ${!!SUPERVISOR_TOKEN}`);
  log('info', `HA_TOKEN present: ${!!HA_TOKEN}`);
  if (EFFECTIVE_HA_TOKEN) {
    log('info', `Token preview: ${EFFECTIVE_HA_TOKEN.substring(0, 15)}...`);
  }
});
