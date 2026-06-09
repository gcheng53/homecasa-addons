#!/usr/bin/with-contenv bashio

CONFIG_PATH=/data/options.json

TUNNEL_TOKEN=$(bashio::config 'tunnel_token')
AGENT_API_KEY=$(bashio::config 'agent_api_key')
HA_TOKEN=$(bashio::config 'ha_token')
HA_BASE_URL=$(bashio::config 'ha_base_url')
HOMECASA_CLOUD_URL=$(bashio::config 'homecasa_cloud_url')
HOME_ID=$(bashio::config 'home_id')
PORT=$(bashio::config 'port')

export TUNNEL_TOKEN
export AGENT_API_KEY
export HA_TOKEN
export PORT
# If user provided a custom HA_BASE_URL, use it. Otherwise server.js will pick automatically.
if [ -n "$HA_BASE_URL" ]; then
  export HA_BASE_URL
fi
if [ -n "$HOMECASA_CLOUD_URL" ]; then
  export HOMECASA_CLOUD_URL
fi
if [ -n "$HOME_ID" ]; then
  export HOME_ID
fi
# SUPERVISOR_TOKEN is automatically injected by Home Assistant for add-ons with homeassistant_api: true
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"

bashio::log.info "Starting HomeCasa Agent v1.4.0 on port ${PORT}..."

# Deploy the bundled HomeCasa conversation integration into Home Assistant so
# the Voice puck can use HomeCasa as its brain — no manual file copying. The
# integration self-configures from the bootstrap file we write below, using
# this home's existing agent API key.
deploy_conversation_integration() {
    HA_CONFIG=""
    if [ -d /homeassistant ]; then
        HA_CONFIG=/homeassistant
    elif [ -d /config ]; then
        HA_CONFIG=/config
    fi

    if [ -z "$HA_CONFIG" ]; then
        bashio::log.warning "HA config dir not mapped; skipping conversation integration deploy."
        return
    fi
    if [ ! -d /app/ha_integration/homecasa ]; then
        bashio::log.warning "Bundled conversation integration missing; skipping deploy."
        return
    fi

    mkdir -p "$HA_CONFIG/custom_components"
    rm -rf "$HA_CONFIG/custom_components/homecasa"
    cp -r /app/ha_integration/homecasa "$HA_CONFIG/custom_components/"
    bashio::log.info "Deployed HomeCasa conversation integration to $HA_CONFIG/custom_components/homecasa"

    if [ -n "$AGENT_API_KEY" ]; then
        # Write the bootstrap as proper JSON (safe escaping) and rename
        # atomically so the integration never reads a half-written file.
        BOOT_PATH="$HA_CONFIG/homecasa_agent.json" \
        BOOT_URL="${HOMECASA_CLOUD_URL:-https://homecasa.ai}" \
        BOOT_KEY="$AGENT_API_KEY" \
        node -e 'const fs=require("fs");const p=process.env.BOOT_PATH;const o={url:process.env.BOOT_URL,api_key:process.env.BOOT_KEY};fs.writeFileSync(p+".tmp",JSON.stringify(o));fs.renameSync(p+".tmp",p);'
        chmod 600 "$HA_CONFIG/homecasa_agent.json" 2>/dev/null || true
        bashio::log.info "Wrote HomeCasa bootstrap config for auto-setup (restart HA once to load the integration)."
    else
        bashio::log.warning "No agent_api_key set; integration deployed but not auto-configured."
    fi
}

deploy_conversation_integration
bashio::log.info "SUPERVISOR_TOKEN present: $([ -n "$SUPERVISOR_TOKEN" ] && echo 'yes' || echo 'no')"
bashio::log.info "HA_TOKEN present: $([ -n "$HA_TOKEN" ] && echo 'yes' || echo 'no')"
bashio::log.info "HA_BASE_URL: ${HA_BASE_URL:-'(auto)'}"
bashio::log.info "HOMECASA_CLOUD_URL: ${HOMECASA_CLOUD_URL:-'(default)'}"
bashio::log.info "HOME_ID: ${HOME_ID:-'(not set - will discover from sync)'}"

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