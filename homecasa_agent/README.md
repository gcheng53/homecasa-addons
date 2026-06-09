# HomeCasa Agent

Secure bridge between HomeCasa and your Home Assistant.

## Features

- **Local-first security**: Your HA token never leaves your network
- **Cloudflare Tunnel**: Secure remote access without port forwarding
- **API key authentication**: Only authorized requests are accepted
- **Automatic HA integration**: Uses Supervisor token, no manual token needed
- **Bundled voice brain**: Automatically installs and configures the HomeCasa
  conversation integration so the HA Voice puck uses HomeCasa as its brain

## Voice puck (HomeCasa conversation integration)

This add-on bundles the HomeCasa conversation integration. On start it copies it
into Home Assistant and self-configures it with your agent API key — you don't
copy any files or re-enter the key. To finish setup:

1. Install or update the HomeCasa Agent and start it.
2. **Restart Home Assistant once** (so it loads the newly installed integration).
3. Go to **Settings → Voice assistants**, edit your assistant, and set the
   **Conversation agent** to **HomeCasa**. Use a **local** text-to-speech engine
   (e.g. Piper) so the puck speaks replies itself without a cold-speaker delay.
4. Assign that assistant to your Voice puck.

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| tunnel_token | Yes | Cloudflare Tunnel token from HomeCasa |
| agent_api_key | Yes | API key for authenticating requests |
| ha_token | No | Leave empty (uses Supervisor) |
| port | No | API port (default: 8099) |

## Getting Your Credentials

1. Open HomeCasa app
2. Go to Settings → Remote Access
3. Complete the setup wizard
4. Copy your tunnel_token and agent_api_key

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| /health | GET | No | Health check |
| /ha/states | GET | Yes | Get all entity states |
| /ha/toggle | POST | Yes | Toggle an entity |
| /ha/turn-on | POST | Yes | Turn on an entity |
| /ha/turn-off | POST | Yes | Turn off an entity |

## Troubleshooting

**Add-on won't start:**
- Check the tunnel_token is correct
- Verify agent_api_key is set

**Can't connect remotely:**
- Ensure Cloudflare Tunnel is running (check logs)
- Verify DNS is configured for your subdomain

**Commands fail:**
- The add-on uses Supervisor API automatically
- Check the add-on logs for errors
