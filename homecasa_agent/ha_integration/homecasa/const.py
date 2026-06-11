"""Constants for the HomeCasa conversation integration."""

DOMAIN = "homecasa"

CONF_URL = "url"
CONF_API_KEY = "api_key"

DEFAULT_URL = "https://homecasa.ai"

# Endpoint on HomeCasa Cloud that runs the same voice brain as the PWA.
VOICE_ENDPOINT = "/api/agent/voice"

# Endpoint on HomeCasa Cloud that returns spoken audio (HomeCasa's own voice)
# for a piece of text. Used by the HomeCasa TTS engine below so the puck speaks
# replies in the friendly cloud voice instead of Home Assistant's default TTS.
TTS_ENDPOINT = "/api/agent/tts"

# How long to wait for HomeCasa Cloud to answer before giving up.
REQUEST_TIMEOUT = 20

# TTS audio generation can take a little longer than a text reply, so give it a
# more generous window before falling back to HA's default voice.
TTS_REQUEST_TIMEOUT = 30

# File the HomeCasa Agent add-on drops into the HA config dir so this
# integration can configure itself with the home's existing agent key
# (no manual setup). Shape: {"url": "...", "api_key": "..."}.
BOOTSTRAP_FILE = "homecasa_agent.json"
