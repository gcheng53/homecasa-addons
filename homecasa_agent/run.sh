#!/usr/bin/with-contenv bashio

CONFIG_PATH=/data/options.json

TUNNEL_TOKEN=$(bashio::config 'tunnel_token')
AGENT_API_KEY=$(bashio::config 'agent_api_key')
HA_TOKEN=$(bashio::config 'ha_token')
PORT=$(bashio::config 'port')

export TUNNEL_TOKEN
export AGENT_API_KEY
export HA_TOKEN
export PORT
export HA_BASE_URL="http://supervisor/core"
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"

bashio::log.info "Starting HomeCasa Agent on port ${PORT}..."

if [ -n "$TUNNEL_TOKEN" ]; then
    bashio::log.info "Starting Cloudflare Tunnel..."
    
    ARCH=$(uname -m)
    case $ARCH in
        x86_64) CF_ARCH="amd64" ;;
        aarch64) CF_ARCH="arm64" ;;
        armv7l) CF_ARCH="arm" ;;
        *) CF_ARCH="amd64" ;;
    esac
    
    curl -L -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
    chmod +x /tmp/cloudflared
    
    /tmp/cloudflared tunnel run --token "$TUNNEL_TOKEN" &
    CLOUDFLARED_PID=$!
    bashio::log.info "Cloudflare Tunnel started (PID: $CLOUDFLARED_PID)"
fi

node /app/server.js
