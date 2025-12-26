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
const HA_BASE_URL = process.env.HA_BASE_URL || 'http://supervisor/core';

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
  
  const apiKey = req.headers['x-agent-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!AGENT_API_KEY) {
    log('warn', 'No AGENT_API_KEY configured - authentication disabled');
    return next();
  }
  
  if (apiKey !== AGENT_API_KEY) {
    log('warn', 'Invalid API key', { path: req.path });
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
  }
  
  next();
}

app.use(authMiddleware);

async function haRequest(method, path, body = null) {
  const token = SUPERVISOR_TOKEN || HA_TOKEN;
  
  if (!token) {
    throw new Error('No HA token configured');
  }
  
  const url = new URL(path, HA_BASE_URL);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  
  return new Promise((resolve, reject) => {
    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || `HA returned ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          if (res.statusCode >= 400) {
            reject(new Error(`HA returned ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

app.get('/health', (req, res) => {
  log('info', 'Health check');
  res.json({
    status: 'ok',
    agent: 'homecasa-agent',
    version: '1.0.2',
    timestamp: new Date().toISOString(),
    ha_configured: !!(SUPERVISOR_TOKEN || HA_TOKEN),
  });
});

app.get('/ha/states', async (req, res) => {
  try {
    log('info', 'Fetching HA states');
    const states = await haRequest('GET', '/api/states');
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
  log('info', `HA token configured: ${!!(SUPERVISOR_TOKEN || HA_TOKEN)}`);
});
