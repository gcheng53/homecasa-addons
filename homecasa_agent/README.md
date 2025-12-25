# HomeCasa Agent

Secure bridge between HomeCasa and your Home Assistant.

## Features

- **Local-first security**: Your HA token never leaves your network
- **Cloudflare Tunnel**: Secure remote access without port forwarding
- **API key authentication**: Only authorized requests are accepted
- **Automatic HA integration**: Uses Supervisor token, no manual token needed

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
