# HMI Face Rig

> ⚠️ **Projekt wird in Notion verwaltet!** → [Notion Projekt](https://notion.so/30c8f154-9217-8118-831a-ded95d30cbc7)

VRM-based 3D avatar playground with:
- Three.js + `@pixiv/three-vrm`
- Local OpenClaw agent integration (`/chat` + `/agent/call-turn`)
- Edge TTS generation + queued playback
- Web Audio lip-sync on avatar
- Minimal in-memory WebRTC signaling (Host/Join)

## Start

```bash
cd /home/openclaw/.openclaw/workspace/hmi-face-rig
node server.js
```

Open:
- `http://localhost:8080/vrm-test.html`

## UI Modes

In the speech panel you now have a mode switch:

1. **💬 Text Chat Mode**
   - Type or dictate into textbox
   - Press Enter / Senden
   - Uses `POST /chat`
   - Playback runs from queue polling (`/audio/queue`)

2. **📞 Agent Call Mode**
   - Press mic button, speak, press again to stop
   - Browser SpeechRecognition transcript is auto-sent
   - Uses `POST /agent/call-turn`
   - Response auto-plays with lip-sync
   - If a WebRTC remote audio stream is active, local TTS fallback is suppressed

## API Overview

- `POST /chat` → existing text chat path (unchanged)
- `POST /agent/call-turn` → transcript/prompt → `runLocalAgentPrompt` + `generateAndQueueTTS`
- `GET /audio/queue?consume=1` → next queued TTS item
- `POST /audio/events` → playback diagnostics

### `/agent/call-turn` payload

```json
{
  "transcript": "Hallo, wie geht's?",
  "voice": "de-DE-ConradNeural"
}
```

Response includes:
- `transcript`
- `reply`
- `file`, `queueId`
- `queue.url` for direct audio file path

## WebRTC Signaling

Endpoints:
- `POST /webrtc/session`
- `POST/GET /webrtc/offer`
- `POST/GET /webrtc/answer`
- `POST/GET /webrtc/ice`

Notes:
- Session store is in-memory (TTL 30 min)
- Host/Join remains working with current UI
- TURN credentials are hardcoded for local dev and should be replaced for production

## Limitations (current incremental architecture)

- STT is browser-side only (Web Speech API), no robust server-side STT yet
- Browser STT availability differs by browser/device/language pack
- `SpeechRecognition` is not guaranteed in Firefox/Safari
- WebRTC state is not persisted across server restarts
- Single-process queue in memory only

## Next Steps (for true call reliability)

1. Add **server-side STT** (e.g., Whisper/Faster-Whisper streaming)
2. Stream mic audio chunks to backend instead of relying on browser SR
3. Add VAD + barge-in handling (interrupt TTS when user starts speaking)
4. Add explicit call session state machine (idle/listening/thinking/speaking)
5. Persist WebRTC signaling + queue metadata in Redis/Postgres
6. Add auth/rate limits for API endpoints

## Controls

- `D` → Debug toggle
- `1..5` and `QWER` → facial expressions
- Menu → animation/model/device settings

---

*Zuletzt aktualisiert: 2026-03-01*