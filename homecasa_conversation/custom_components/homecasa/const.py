"""Constants for the HomeCasa conversation integration."""

DOMAIN = "homecasa"

CONF_URL = "url"
CONF_API_KEY = "api_key"

DEFAULT_URL = "https://homecasa.ai"

# Endpoint on HomeCasa Cloud that runs the same voice brain as the PWA.
VOICE_ENDPOINT = "/api/agent/voice"

# How long to wait for HomeCasa Cloud to answer before giving up.
REQUEST_TIMEOUT = 20

# File the HomeCasa Agent add-on drops into the HA config dir so this
# integration can configure itself with the home's existing agent key
# (no manual setup). Shape: {"url": "...", "api_key": "..."}.
BOOTSTRAP_FILE = "homecasa_agent.json"
