# HomeCasa Conversation Integration (Home Assistant)

Make the **Home Assistant Voice Preview Edition** puck the *ear and mouth* for
HomeCasa, while **HomeCasa Cloud stays the brain**.

- The puck does the **hearing** — wake word, microphone, speech‑to‑text.
- HomeCasa Cloud does the **thinking and doing** — natural‑language
  understanding plus device control over your existing tunnel.
- The puck does the **speaking** — it plays HomeCasa's reply through its own
  local speaker (local text‑to‑speech), so there is no cold‑speaker delay.

This avoids the slow cold‑start of casting replies to a Nest/HomePod and gives
you HomeCasa's behavior (your device names, your scenes, your logic) instead of
Home Assistant's built‑in assistant defaults.

## How it works

```
You speak → Voice puck (wake + STT) → HA "HomeCasa" conversation agent
          → POST {cloud}/api/agent/voice (Bearer agent API key)
          → HomeCasa runs NLU + executes devices over the tunnel
          → returns reply text → puck speaks it locally
```

The conversation agent forwards the recognized sentence to HomeCasa Cloud at
`POST /api/agent/voice` and speaks back whatever HomeCasa returns. After a
successful command — or when HomeCasa asks a clarifying question — the puck keeps
listening, so you can give a follow-up command without saying the wake word
again. The back-and-forth is bounded (turn cap + short timeout), and the puck
mutes its own mic while it speaks so it never hears its own reply.

## Requirements

- A Home Assistant instance already connected to HomeCasa (you have a working
  HomeCasa tunnel / agent for this home).
- The **agent API key** for this home. This is the same key the HomeCasa Agent
  uses to talk to HomeCasa Cloud (`AGENT_API_KEY`). HomeCasa Cloud uses it to
  match this request to your home, so the brain controls the right devices.
- Home Assistant 2024.6 or newer (Voice / Assist pipelines).

## Install

### Recommended — it comes with the HomeCasa Agent

If you run the **HomeCasa Agent** add-on (v1.4.0+), you do **not** need to
install this integration by hand. The Agent bundles these exact files, copies
them into `config/custom_components/homecasa` on start, and auto-configures the
integration with your home's agent API key. Just **restart Home Assistant once**
after installing/updating the Agent, then pick **HomeCasa** as the conversation
agent under **Settings → Voice assistants**.

The manual options below are for installs that don't use the Agent add-on.

> Maintainers: these files are the single editable source. After changing them,
> run `homecasa-addons/sync-conversation-integration.sh` to refresh the copy
> bundled inside the Agent add-on.

### Option A — copy the files (manual)

1. Copy the `custom_components/homecasa` folder from this directory into your
   Home Assistant `config/custom_components/` folder, so you end up with:

   ```
   config/custom_components/homecasa/__init__.py
   config/custom_components/homecasa/manifest.json
   config/custom_components/homecasa/conversation.py
   config/custom_components/homecasa/config_flow.py
   config/custom_components/homecasa/const.py
   config/custom_components/homecasa/strings.json
   config/custom_components/homecasa/translations/en.json
   ```

2. Restart Home Assistant.

### Option B — via the file editor add‑on / Samba

Drop the same `homecasa` folder into `/config/custom_components/` using the
File Editor add‑on or a Samba share, then restart Home Assistant.

## Configure

1. In Home Assistant go to **Settings → Devices & Services → Add Integration**.
2. Search for **HomeCasa** and select it.
3. Fill in:
   - **HomeCasa Cloud URL** — e.g. `https://homecasa.ai`.
   - **Agent API key** — the `AGENT_API_KEY` for this home.
4. Submit. The setup performs a quick test call to HomeCasa Cloud to verify the
   key works before finishing.

## Wire it to your Voice puck

1. Go to **Settings → Voice assistants**.
2. Create a new assistant (or edit an existing one) and set:
   - **Conversation agent** → **HomeCasa**.
   - **Speech‑to‑text** → your preferred STT (the puck's default is fine).
   - **Text‑to‑speech** → a **local** TTS engine so the puck speaks the reply
     itself (this is what removes the cold‑speaker delay). Piper is a good
     local choice.
3. Assign this assistant to your Home Assistant Voice puck under its device
   settings (the puck's "Preferred assistant" / Assist pipeline).

Now say the wake word and give a command. The puck hears you, HomeCasa decides
and acts, and the puck speaks HomeCasa's answer.

## Notes & limits

- **Naming:** HomeCasa always answers using the names you gave your devices.
  There is no need to sync Home Assistant aliases — the brain owns the naming.
- **Follow‑ups:** after a successful command, and when HomeCasa asks a clarifying
  question, the agent reports `continue_conversation = true` so the puck keeps the
  mic open for the next turn — a back-and-forth without re-waking. It is bounded by
  a per-conversation turn cap and a short timeout; a failed turn closes the mic.
  Conversation context (including any clarification) is held briefly per
  conversation on the cloud side.
- **Custom "Hey HomeCasa" wake word** is out of scope here; use the puck's
  built‑in wake word and route the pipeline to the HomeCasa agent.
- **Reaching the cloud:** the puck/HA must be able to reach the HomeCasa Cloud
  URL over the network.

## API contract (for reference)

`POST {cloud}/api/agent/voice`

Headers: `Authorization: Bearer <agent api key>` (or `X-Agent-Api-Key`).

Request body:

```json
{ "text": "turn on the bedroom light", "conversation_id": "01J...", "language": "en" }
```

Response body:

```json
{
  "success": true,
  "response": "OK, turning on the bedroom light.",
  "continue_conversation": false,
  "conversation_id": "01J...",
  "language": "en-US"
}
```
