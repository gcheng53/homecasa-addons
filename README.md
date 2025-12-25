# HomeCasa Add-ons for Home Assistant

This repository contains add-ons for Home Assistant that enable HomeCasa smart home control.

## Add-ons

### HomeCasa Agent

Secure bridge between HomeCasa and your Home Assistant. Enables remote access via Cloudflare Tunnel without exposing ports.

## Installation

1. Open your Home Assistant instance
2. Go to **Settings** → **Add-ons** → **Add-on Store**
3. Click the **⋮** menu (top right) → **Repositories**
4. Add this URL: `https://github.com/gcheng53/homecasa-addons`
5. Click **Add** → **Close**
6. Refresh the page
7. Find **HomeCasa Agent** and click **Install**

## Configuration

After installing, configure the add-on with:

- **tunnel_token**: Your Cloudflare Tunnel token (from HomeCasa setup)
- **agent_api_key**: Your Agent API key (from HomeCasa setup)
- **port**: API port (default: 8099)

Leave `ha_token` empty - the add-on uses Supervisor authentication automatically.

## Support

- Issues: [GitHub Issues](https://github.com/gcheng53/homecasa-addons/issues)
