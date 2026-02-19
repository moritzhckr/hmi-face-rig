# HMI Face Rig

> ⚠️ **Projekt wird in Notion verwaltet!** → [Notion Projekt](https://notion.so/30c8f154-9217-8118-831a-ded95d30cbc7)

VRM-based 3D Avatar with:
- Three.js + @pixiv/three-vrm
- Face expression control via keyboard
- TTS integration with lip-sync
- Real-time audio polling from server

## Tech Stack

- Three.js
- @pixiv/three-vrm v2.1.0
- node-edge-tts (Edge TTS)

## Usage

### Start Server
```bash
cd hmi-face-rig
npx serve -l 8080
```

### Open VRM Viewer
```
http://localhost:8080/vrm-test.html
```

### Generate Speech
```bash
node tts-speak.cjs "Hallo Welt"
```

## Controls

| Key | Expression |
|-----|------------|
| 1-5 | aa, ih, ou, ee, oh |
| q,w,e,r | happy, sad, angry, surprised |
| a,s,d,f,g | blink, look left/right/up/down |

## Idle Animation (erweitert)

- ✅ Atmende Mundbewegung
- ✅ Blinken (zufällig alle 3-5 Sekunden)
- ✅ Brust/Schulter-Atmung
- ✅ Kopfbewegung (natürliches Nicken + Drehen)
- ✅ Hüft-Gewichtsverlagerung
- ✅ **Arme in natürlicher Position** (T-Pose → Steh-Pose)
- ✅ **Arm-Schwung** (subtil im Idle)

## Notion Tasks (aktive Todos)

- [ ] Projekt-Doku in Notion vervollständigen
- [ ] TTS Integration debuggen (Lip-Sync)
- [ ] Neue Face Expressions hinzufügen
- [ ] Mobile Support (Touch-Controls)

---

*Zuletzt aktualisiert: 19.02.2026*
