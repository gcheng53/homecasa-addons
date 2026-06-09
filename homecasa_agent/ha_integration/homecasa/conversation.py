"""Conversation agent that forwards speech to HomeCasa Cloud."""

from __future__ import annotations

import logging

import aiohttp

from homeassistant.components import conversation
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import MATCH_ALL
from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import ulid as ulid_util

from .const import (
    CONF_API_KEY,
    CONF_URL,
    DOMAIN,
    REQUEST_TIMEOUT,
    VOICE_ENDPOINT,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the HomeCasa conversation agent from a config entry."""
    async_add_entities([HomeCasaConversationEntity(entry)])


class HomeCasaConversationEntity(conversation.ConversationEntity):
    """HomeCasa is the brain; this entity is the relay between HA and HomeCasa."""

    _attr_has_entity_name = True
    _attr_name = "HomeCasa"

    @property
    def supported_languages(self) -> list[str] | str:
        """HomeCasa handles language detection itself, so accept any language."""
        return MATCH_ALL

    def __init__(self, entry: ConfigEntry) -> None:
        """Initialize the agent."""
        self._entry = entry
        self._url: str = entry.data[CONF_URL].rstrip("/")
        self._api_key: str = entry.data[CONF_API_KEY]
        self._attr_unique_id = entry.entry_id

    async def async_process(
        self, user_input: conversation.ConversationInput
    ) -> conversation.ConversationResult:
        """Forward the recognized text to HomeCasa and speak back its reply."""
        conversation_id = user_input.conversation_id or ulid_util.ulid_now()
        language = user_input.language or "en"

        session = async_get_clientsession(self.hass)
        endpoint = self._url + VOICE_ENDPOINT
        payload = {
            "text": user_input.text,
            "conversation_id": conversation_id,
            "language": language,
        }

        speech = ""
        continue_conversation = False
        try:
            async with session.post(
                endpoint,
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    speech = data.get("response") or ""
                    continue_conversation = bool(
                        data.get("continue_conversation")
                    )
                else:
                    _LOGGER.warning(
                        "HomeCasa returned HTTP %s for conversation", resp.status
                    )
                    speech = self._error_text(language)
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("HomeCasa request failed: %s", err)
            speech = self._error_text(language)

        if not speech:
            speech = self._error_text(language)

        intent_response = intent.IntentResponse(language=language)
        intent_response.async_set_speech(speech)

        try:
            return conversation.ConversationResult(
                response=intent_response,
                conversation_id=conversation_id,
                continue_conversation=continue_conversation,
            )
        except TypeError:
            # Older Home Assistant cores do not accept continue_conversation.
            return conversation.ConversationResult(
                response=intent_response,
                conversation_id=conversation_id,
            )

    @staticmethod
    def _error_text(language: str) -> str:
        """A spoken message for when HomeCasa cannot be reached."""
        if language.lower().startswith("zh"):
            return "抱歉，現在無法連線到 HomeCasa。"
        return "Sorry, I couldn't reach HomeCasa right now."
