"""HomeCasa speech-to-text: understand BOTH languages under one wake word.

Home Assistant's local STT pipeline is locked to a single language per pipeline,
so a puck with one wake word can only understand one language at a time. This
engine instead streams the recorded audio to HomeCasa Cloud, which runs OpenAI
Whisper with AUTOMATIC language detection — so the puck understands English or
Chinese with no toggle, exactly like the HomeCasa app.

Trade-off: this is CLOUD STT, so it needs internet (the audio is transcribed in
the cloud). Home Assistant's local faster-whisper engine stays available as the
offline, single-language option — the user can switch the pipeline's
speech-to-text engine between "HomeCasa" and "faster-whisper" to compare.
"""

from __future__ import annotations

import io
import logging
import wave
from collections.abc import AsyncIterable

import aiohttp

from homeassistant.components.stt import (
    AudioBitRates,
    AudioChannels,
    AudioCodecs,
    AudioFormats,
    AudioSampleRates,
    SpeechMetadata,
    SpeechResult,
    SpeechResultState,
    SpeechToTextEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_API_KEY,
    CONF_URL,
    STT_ENDPOINT,
    STT_REQUEST_TIMEOUT,
)

_LOGGER = logging.getLogger(__name__)

# Broad list so the Assist pipeline can pick this engine whatever locale the
# puck reports. Whisper auto-detects the actual language from the audio itself,
# so the requested language here is IGNORED — that's what makes one wake word
# bilingual.
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
    """Set up the HomeCasa STT engine from a config entry."""
    async_add_entities([HomeCasaSTTEntity(entry)])


class HomeCasaSTTEntity(SpeechToTextEntity):
    """Transcribes puck audio via HomeCasa Cloud (OpenAI Whisper, auto-detect)."""

    _attr_has_entity_name = True
    _attr_name = "HomeCasa"

    def __init__(self, entry: ConfigEntry) -> None:
        """Initialize the STT engine."""
        self._entry = entry
        self._url: str = entry.data[CONF_URL].rstrip("/")
        self._api_key: str = entry.data[CONF_API_KEY]
        self._attr_unique_id = f"{entry.entry_id}-stt"

    @property
    def supported_languages(self) -> list[str]:
        """Languages this engine accepts (Whisper auto-detects regardless).

        Must be a real property returning concrete codes — using
        ``_attr_supported_languages`` causes HA to silently fail to load the
        entity (same trap the conversation/TTS entities hit).
        """
        return SUPPORTED_LANGUAGES

    @property
    def supported_formats(self) -> list[AudioFormats]:
        """Audio formats the Assist pipeline may send."""
        return [AudioFormats.WAV]

    @property
    def supported_codecs(self) -> list[AudioCodecs]:
        """Audio codecs the Assist pipeline may send."""
        return [AudioCodecs.PCM]

    @property
    def supported_bit_rates(self) -> list[AudioBitRates]:
        """Bit depths the Assist pipeline may send."""
        return [AudioBitRates.BITRATE_16]

    @property
    def supported_sample_rates(self) -> list[AudioSampleRates]:
        """Sample rates the Assist pipeline may send."""
        return [AudioSampleRates.SAMPLERATE_16000]

    @property
    def supported_channels(self) -> list[AudioChannels]:
        """Channel layouts the Assist pipeline may send."""
        return [AudioChannels.CHANNEL_MONO]

    async def async_process_audio_stream(
        self, metadata: SpeechMetadata, stream: AsyncIterable[bytes]
    ) -> SpeechResult:
        """Collect the PCM stream, wrap it as WAV, and transcribe via HomeCasa.

        Returns an ERROR result on any failure so the Assist pipeline reports a
        clean STT error instead of hanging.
        """
        pcm = bytearray()
        async for chunk in stream:
            pcm.extend(chunk)

        if not pcm:
            return SpeechResult(None, SpeechResultState.ERROR)

        # Wrap the raw PCM in a WAV container (Whisper needs a real container).
        # Done in an executor so the (tiny, blocking) wave write never stalls
        # the event loop.
        wav_bytes = await self.hass.async_add_executor_job(
            _pcm_to_wav,
            bytes(pcm),
            int(metadata.sample_rate),
            int(metadata.channel),
        )

        session = async_get_clientsession(self.hass)
        try:
            async with session.post(
                self._url + STT_ENDPOINT,
                data=wav_bytes,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "audio/wav",
                },
                timeout=aiohttp.ClientTimeout(total=STT_REQUEST_TIMEOUT),
            ) as resp:
                if resp.status != 200:
                    _LOGGER.warning("HomeCasa STT returned HTTP %s", resp.status)
                    return SpeechResult(None, SpeechResultState.ERROR)
                data = await resp.json()
                text = (data.get("text") or "").strip()
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("HomeCasa STT request failed: %s", err)
            return SpeechResult(None, SpeechResultState.ERROR)

        if not text:
            return SpeechResult(None, SpeechResultState.ERROR)
        return SpeechResult(text, SpeechResultState.SUCCESS)


def _pcm_to_wav(pcm: bytes, sample_rate: int, channels: int) -> bytes:
    """Wrap raw 16-bit PCM in a WAV container Whisper can read."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels or 1)
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(sample_rate or 16000)
        wav.writeframes(pcm)
    return buffer.getvalue()
