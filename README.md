# HMI Face Rig

VRM-based 3D Avatar with:
- Three.js + @pixiv/three-vrm
- Face expression control via keyboard
- TTS integration with lip-sync
- Real-time audio polling from server

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

## Tech Stack

- Three.js
- @pixiv/three-vrm v2.1.0
- gtts (Google TTS)
