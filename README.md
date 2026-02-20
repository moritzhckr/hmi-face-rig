# HMI Face Rig

> ⚠️ **Projekt wird in Notion verwaltet!** → [Notion Projekt](https://notion.so/30c8f154-9217-8118-831a-ded95d30cbc7)

VRM-based 3D Avatar with:
- Three.js + @pixiv/three-vrm
- Face expression control via keyboard
- TTS integration with lip-sync
- **Mixamo FBX animation support** via vrm-mixamo-retarget

## Tech Stack

- Three.js
- @pixiv/three-vrm v2.1.0
- node-edge-tts (Edge TTS)
- vrm-mixamo-retarget (animation retargeting)

## Usage

### Start Server
```bash
cd hmi-face-rig/public
python3 -m http.server 8080
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

## Animation System

- **Idle**: Mixamo FBX animation, retargeted mit vrm-mixamo-retarget library
- **Other animations**: GLB files mit manueller Retargeting-Logik

## Recent Updates (20.02.2026)

- ✅ Idle FBX Animation funktioniert!
- ✅ vrm-mixamo-retarget Library integriert
- ✅ Touch-Controls für Mobile
- ✅ Animation Buttons wiederhergestellt

---

*Zuletzt aktualisiert: 20.02.2026*
