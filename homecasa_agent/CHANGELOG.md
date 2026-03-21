# Changelog

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
