# Changelog

## 1.5.2

- The HomeCasa conversation integration now also installs a **HomeCasa speech-to-text** option. This lets the Voice puck understand **both English and Chinese under a single wake word** — just speak either language, no toggle. After updating, **restart Home Assistant once**, then in **Settings → Voice assistants** open your assistant and set **Speech-to-text** to **HomeCasa**. (This option uses the cloud, so it needs internet; Home Assistant's local faster-whisper stays available as the offline, single-language choice — you can switch between them to compare speed.)

## 1.5.1

- The Agent now **learns which home it belongs to automatically** from its regular check-in with HomeCasa Cloud — no need to fill in a Home ID by hand. This switches on the **offline automation backup** (the Agent keeps a local copy of your automations so they keep running even if the internet drops). This change doesn't affect the voice features.

## 1.5.0

- The HomeCasa conversation integration now also installs a **HomeCasa text-to-speech voice**. This lets the Voice puck reply in HomeCasa's own warm voice instead of Home Assistant's default robotic one. After updating, **restart Home Assistant once**, then in **Settings → Voice assistants** open your assistant and set **Text-to-speech** to **HomeCasa**. Home Assistant plays the reply on the puck itself, so there's no echo and only one voice.

## 1.4.0

- Bundled the **HomeCasa conversation integration** with the Agent. On start the add-on copies the `homecasa` custom component into Home Assistant's `custom_components/` folder and writes a small bootstrap file so the integration **auto-configures** using this home's existing agent API key — no manual file copying and no re-entering the key. Requires the new `homeassistant_config` mapping. After installing/updating, **restart Home Assistant once** so it loads the integration, then pick **HomeCasa** as the conversation agent under Settings → Voice assistants.

## 1.3.0

- Cloud WebSocket relay at `/api/websocket` (and `/websocket`). HomeCasa Cloud can now open a real-time WebSocket through the tunnel instead of falling back to ~1s polling. The relay reuses the agent's single authed Home Assistant connection and fans `state_changed` and `zha_event` events out to cloud clients, so button/cube/tilt presses react instantly with no background polling. Cloud authenticates with the Agent API Key as the WebSocket access token.


## 1.2.4

- Fix: raise per-IP rate limit from 100/min to 5000/min — the cloud tunnel routes all PWA clients through a single IP, so the previous limit was tripped by routine state polling, causing 'Failed to control device: HTTP 429: Rate limit exceeded' errors


## 1.2.3

- Fix: restore CORS middleware (Access-Control-Allow-Origin: *) so the PWA at homecasa.ai can call the agent's tunnel domain directly without preflight failures


## 1.2.2

- Fix: restore `agent: "homecasa-agent"` field in /health response (required by client connection check)
- Fix: restore /ha/config proxy route (required by client auth check)
- Both fixes resolve Home/Remote connection showing red after upgrade from 1.1.0


## 1.2.1

- Capture full ZHA event payload (endpoint_id, cluster_id, device_id, raw data) to support Aqara H2 4-button scene endpoint and other non-standard ZHA events
- Try alternate field names (event/action, ieee) when parsing zha_event so events without a 'command' field are still identified
- Improved debug logging of raw ZHA event data


## 1.2.0

- Local automation engine: agent can now run automations locally without cloud round-trip
- Cloud config sync: pulls automation bundle from HomeCasa Cloud every 30 seconds
- Supports button triggers (ZHA), sensor triggers (state_changed), and time triggers
- Scene actions resolved to concrete device commands for local execution
- New config options: `homecasa_cloud_url`, `home_id`
- Offline resilience: agent keeps running with last synced bundle when internet is down
- Automation mode: controlled from the app (Cloud vs Local toggle on Automations page)
- WebSocket subscription to both `zha_event` and `state_changed` for real-time triggers

## 1.1.0

- ZHA WebSocket event listener for real-time sensor events (tilt, drop, vibration)
- Subscribes to `zha_event` on HA WebSocket and buffers last 100 events
- New endpoint: `GET /ha/zha-events` - fetch buffered ZHA events (filter by IEEE address)
- New endpoint: `GET /ha/zha-events/stream` - SSE stream for live ZHA events
- Auto-reconnect on WebSocket disconnection (10s retry)
- Version bump to 1.1.0

## 1.0.0

- Initial release
- Secure bridge between HomeCasa and Home Assistant
- Cloudflare Tunnel integration for remote access
- API key authentication
- Support for all HA architectures (amd64, aarch64, armhf, armv7, i386)