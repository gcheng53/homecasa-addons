"""The HomeCasa conversation integration.

Bridges the Home Assistant Voice puck to HomeCasa Cloud: the puck does the
hearing (wake word + STT) and the speaking (local TTS), while HomeCasa Cloud is
the brain (NLU + device execution over the existing tunnel). This integration
registers a conversation agent that forwards recognized speech to HomeCasa and
speaks back the reply HomeCasa returns.
"""

from __future__ import annotations

import json
import logging
import os

from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import BOOTSTRAP_FILE, CONF_API_KEY, CONF_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.CONVERSATION, Platform.TTS, Platform.STT]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Self-configure from the HomeCasa Agent's bootstrap file, if present.

    The Agent add-on drops a small JSON file with this home's cloud URL and
    agent API key. If it's there and we're not already set up for that key, we
    create the config entry automatically so the user never has to enter
    anything by hand.
    """
    hass.async_create_task(_async_try_bootstrap(hass))
    return True


async def _async_try_bootstrap(hass: HomeAssistant) -> None:
    path = hass.config.path(BOOTSTRAP_FILE)

    def _read() -> dict | None:
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    data = await hass.async_add_executor_job(_read)
    if not isinstance(data, dict):
        return

    url = str(data.get("url") or "").rstrip("/")
    api_key = str(data.get("api_key") or "").strip()
    if not url or not api_key:
        return

    # Already configured for this key? Make sure the saved URL still matches the
    # add-on's current cloud URL. The user may have switched the add-on between
    # dev and prod (the key is intentionally the same on both), so if the URL
    # changed, update the entry in place and reload it so the voice pipeline
    # (STT / conversation / TTS) follows the new URL without a manual re-add.
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.data.get(CONF_API_KEY) == api_key:
            if entry.data.get(CONF_URL) != url:
                _LOGGER.info(
                    "HomeCasa: cloud URL changed (%s -> %s); updating entry",
                    entry.data.get(CONF_URL),
                    url,
                )
                hass.config_entries.async_update_entry(
                    entry, data={**entry.data, CONF_URL: url}
                )
                await hass.config_entries.async_reload(entry.entry_id)
            return

    _LOGGER.info("HomeCasa: auto-configuring from Agent bootstrap file")
    await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_IMPORT},
        data={CONF_URL: url, CONF_API_KEY: api_key},
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HomeCasa from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = dict(entry.data)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok
