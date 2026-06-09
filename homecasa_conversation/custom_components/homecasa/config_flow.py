"""Config flow for the HomeCasa conversation integration."""

from __future__ import annotations

import json
import os
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    BOOTSTRAP_FILE,
    CONF_API_KEY,
    CONF_URL,
    DEFAULT_URL,
    DOMAIN,
    REQUEST_TIMEOUT,
    VOICE_ENDPOINT,
)


async def _validate(hass, url: str, api_key: str) -> str | None:
    """Return an error key if the credentials are not usable, else None."""
    session = async_get_clientsession(hass)
    endpoint = url.rstrip("/") + VOICE_ENDPOINT
    try:
        async with session.post(
            endpoint,
            json={"text": "ping", "language": "en"},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
        ) as resp:
            if resp.status in (401, 403):
                return "invalid_auth"
            if resp.status != 200:
                # Wrong URL/route (404), server error (5xx), etc.
                return "cannot_connect"
            try:
                data = await resp.json()
            except (aiohttp.ContentTypeError, ValueError):
                return "cannot_connect"
            if not isinstance(data, dict) or "response" not in data:
                return "cannot_connect"
            return None
    except (aiohttp.ClientError, TimeoutError):
        return "cannot_connect"


async def _read_bootstrap(hass) -> dict[str, str]:
    """Read the HomeCasa Agent bootstrap file (url + api_key), if present."""
    path = hass.config.path(BOOTSTRAP_FILE)

    def _read() -> dict[str, str]:
        if not os.path.exists(path):
            return {}
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {
            CONF_URL: str(data.get("url") or "").rstrip("/"),
            CONF_API_KEY: str(data.get("api_key") or "").strip(),
        }

    return await hass.async_add_executor_job(_read)


class HomeCasaConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HomeCasa."""

    VERSION = 1

    async def async_step_import(
        self, user_input: dict[str, Any]
    ) -> ConfigFlowResult:
        """Auto-configure from the Agent bootstrap file (no UI).

        The key comes from the Agent's own configuration, which is
        authoritative, so we don't block setup on a transient connectivity
        check during Home Assistant startup.
        """
        url = user_input[CONF_URL].rstrip("/")
        api_key = user_input[CONF_API_KEY].strip()
        await self.async_set_unique_id(api_key)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title="HomeCasa",
            data={CONF_URL: url, CONF_API_KEY: api_key},
        )

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            url = user_input[CONF_URL].rstrip("/")
            api_key = user_input[CONF_API_KEY].strip()
            error = await _validate(self.hass, url, api_key)
            if error:
                errors["base"] = error
            else:
                await self.async_set_unique_id(api_key)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="HomeCasa",
                    data={CONF_URL: url, CONF_API_KEY: api_key},
                )

        # Prefill from the Agent bootstrap file if the user opens the form
        # manually (e.g. before HA has auto-imported it).
        bootstrap = await _read_bootstrap(self.hass)
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_URL,
                    default=bootstrap.get(CONF_URL) or DEFAULT_URL,
                ): str,
                vol.Required(
                    CONF_API_KEY,
                    default=bootstrap.get(CONF_API_KEY) or "",
                ): str,
            }
        )
        return self.async_show_form(
            step_id="user", data_schema=schema, errors=errors
        )
