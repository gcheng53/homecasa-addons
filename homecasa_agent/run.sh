#!/usr/bin/with-contenv bashio

CONFIG_PATH=/data/options.json

TUNNEL_TOKEN=$(bashio::config 'tunnel_token')
AGENT_API_KEY=$(bashio::config 'agent_api_key')
HA_TOKEN=$(bashio::config 'ha_token')
HA_BASE_URL=$(bashio::config 'ha_base_url')
PORT=$(bashio::config 'port')

export TUNNEL_TOKEN
export AGENT_API_KEY
export HA_TOKEN
export PORT
# If user provided a custom HA_BASE_URL, use it. Otherwise server.js will pick automatically.
if [ -n "$HA_BASE_URL" ]; then
  export HA_BASE_URL
fi
# SUPERVISOR_TOKEN is automatically injected by Home Assistant for add-ons with homeassistant_api: true
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"

bashio::log.info "Starting HomeCasa Agent on port ${PORT}..."
bashio::log.info "SUPERVISOR_TOKEN present: $([ -n "$SUPERVISOR_TOKEN" ] && echo 'yes' || echo 'no')"
bashio::log.info "HA_TOKEN present: $([ -n "$HA_TOKEN" ] && echo 'yes' || echo 'no')"
bashio::log.info "HA_BASE_URL: ${HA_BASE_URL:-'(auto)'}"

# Function to start cloudflared with auto-restart
start_cloudflared() {
    if [ -z "$TUNNEL_TOKEN" ]; then
        return
    fi
    
    # Download cloudflared if not present
    if [ ! -f /tmp/cloudflared ]; then
        bashio::log.info "Downloading Cloudflare Tunnel binary..."
        ARCH=$(uname -m)
        case $ARCH in
            x86_64) CF_ARCH="amd64" ;;
            aarch64) CF_ARCH="arm64" ;;
            armv7l) CF_ARCH="arm" ;;
            *) CF_ARCH="amd64" ;;
        esac
        
        curl -L -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
        chmod +x /tmp/cloudflared
    fi
    
    bashio::log.info "Starting Cloudflare Tunnel..."
    
    # Run cloudflared in a loop that auto-restarts on crash
    while true; do
        /tmp/cloudflared tunnel run --token "$TUNNEL_TOKEN" 2>&1 | while read line; do
            bashio::log.info "[cloudflared] $line"
        done
        
        EXIT_CODE=$?
        bashio::log.warning "Cloudflare Tunnel exited with code $EXIT_CODE. Restarting in 5 seconds..."
        sleep 5
    done
}

# Start cloudflared supervisor in background
start_cloudflared &
CLOUDFLARED_SUPERVISOR_PID=$!
bashio::log.info "Cloudflare Tunnel supervisor started (PID: $CLOUDFLARED_SUPERVISOR_PID)"

# Handle shutdown gracefully
cleanup() {
    bashio::log.info "Shutting down HomeCasa Agent..."
    kill $CLOUDFLARED_SUPERVISOR_PID 2>/dev/null
    pkill -f cloudflared 2>/dev/null
    exit 0
}

trap cleanup SIGTERM SIGINT

# Start the Node.js server (this keeps the container running)
node /app/server.js
