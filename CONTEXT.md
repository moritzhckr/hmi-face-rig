# HMI Face Rig - Aktueller Stand (05.03.2026)

## Server-Architektur
- **Node.js Server**: port 8080 (main server)
- **Python Flask STT Server**: port 8765 (Whisper)

## Aktuelles Problem

### Fehler: `/agent/call-turn` returns 404

**Log:**
```
vrm-test.html:1565 POST https://claw.lab.mrtzhckr.de/agent/call-turn 404 (Not Found)
```

**Analyse:**
Der Server läuft, aber der `/agent/call-turn` Endpoint wird nicht gefunden.
 Mögliche Gründe:
1. Routing-Problem in server.js
2. Falscher Pfad (vom Browser aus extern zugegriffen über claw.lab.mrtzhckr.de)

## Setup

### Server starten
```bash
# Terminal 1: STT Server (Whisper)
cd /home/openclaw/.openclaw/workspace/hmi-face-rig
python3 stt_server.py

# Terminal 2: Node Server
cd /home/openclaw/.openclaw/workspace/hmi-face-rig
node server.js
```

### Endpoints
- Web-UI: http://localhost:8080/vrm-test.html
- TTS: POST /tts
- STT: POST /stt (an Whisper auf Port 8765)
- Agent: POST /agent/call-turn

## TODO
- [x] `/agent/call-turn` Endpoint wiederhergestellt (war nicht im Server)
- [ ] Hold-to-Talk testen

## Letzter Fix (21:17)
- Endpoint `/agent/call-turn` hinzugefügt zu server.js
- Server neugestartet
