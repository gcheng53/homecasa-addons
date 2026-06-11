"""HomeCasa text-to-speech: speak replies in HomeCasa's own (cloud) voice.

Registering this as a Home Assistant TTS engine is what lets the Voice puck
reply in the friendly HomeCasa/OpenAI voice. The Assist pipeline calls
``async_get_tts_audio`` for the conversation reply, we fetch the spoken audio
from HomeCasa Cloud, and HA plays it on the puck NATIVELY — so HA mutes the
mic during playback (no self-echo) and there's exactly one voice (no
double-speak from HA's default engine).
"""

from __future__ import annotations

import logging

import aiohttp

from homeassistant.components.tts import TextToSpeechEntity, TtsAudioType
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_API_KEY,
    CONF_URL,
    TTS_ENDPOINT,
    TTS_REQUEST_TIMEOUT,
)

_LOGGER = logging.getLogger(__name__)

# Languages the HomeCasa voice brain speaks. Kept broad so the Assist pipeline
# can pick this engine whatever locale the puck reports. HomeCasa detects the
# actual language from the text itself when generating audio.
SUPPORTED_LANGUAGES = [
    "en",
    "en-US",
    "en-GB",
    "en-AU",
    "zh",
    "zh-CN",
    "zh-TW",
    "zh-HK",
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the HomeCasa TTS engine from a config entry."""
    async_add_entities([HomeCasaTTSEntity(entry)])


class HomeCasaTTSEntity(TextToSpeechEntity):
    """Speaks text by fetching audio from HomeCasa Cloud's voice."""

    _attr_has_entity_name = True
    _attr_name = "HomeCasa"

    def __init__(self, entry: ConfigEntry) -> None:
        """Initialize the TTS engine."""
        self._entry = entry
        self._url: str = entry.data[CONF_URL].rstrip("/")
        self._api_key: str = entry.data[CONF_API_KEY]
        self._attr_unique_id = f"{entry.entry_id}-tts"

    @property
    def supported_languages(self) -> list[str]:
        """Languages this engine accepts.

        Must be a real property returning concrete codes — using
        ``_attr_supported_languages`` causes HA to silently fail to load the
        entity (same trap the conversation entity hit).
        """
        return SUPPORTED_LANGUAGES

    @property
    def default_language(self) -> str:
        """Default language when the pipeline doesn't specify one."""
        return "en"

    async def async_get_tts_audio(
        self, message: str, language: str, options: dict | None = None
    ) -> TtsAudioType:
        """Fetch spoken audio for ``message`` from HomeCasa Cloud.

        Returns ``(None, None)`` on any failure so Home Assistant cleanly falls
        back to its default TTS engine instead of going silent.
        """
        session = async_get_clientsession(self.hass)
        try:
            async with session.post(
                self._url + TTS_ENDPOINT,
                json={"text": message, "language": language},
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=aiohttp.ClientTimeout(total=TTS_REQUEST_TIMEOUT),
            ) as resp:
                if resp.status != 200:
                    _LOGGER.warning(
                        "HomeCasa TTS returned HTTP %s", resp.status
                    )
                    return (None, None)
                audio = await resp.read()
                return ("mp3", audio)
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("HomeCasa TTS request failed: %s", err)
            return (None, None)
