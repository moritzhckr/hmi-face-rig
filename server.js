const http = require('http');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// German voices: de-DE-ConradNeural, de-DE-KlaraNeural
const DEFAULT_VOICE = 'de-DE-ConradNeural';

// Simple in-memory audio queue + playback event log
const audioQueue = [];
const playbackEvents = [];
const MAX_EVENTS = 200;

function pushPlaybackEvent(type, payload = {}) {
  playbackEvents.push({ id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ts: Date.now(), type, ...payload });
  if (playbackEvents.length > MAX_EVENTS) playbackEvents.splice(0, playbackEvents.length - MAX_EVENTS);
}

function enqueueAudio(item) {
  audioQueue.push(item);
  pushPlaybackEvent('queue.enqueued', { queueId: item.queueId, file: item.file, text: item.text });
}

function classifyIntentEmotion(text = '') {
  const t = String(text).toLowerCase();
  const intent = t.includes('?') ? 'question' : /\b(mach|tu|bitte|setze|öffne|starte)\b/.test(t) ? 'request' : 'statement';
  const emotion = /\b(super|cool|nice|danke|geil|top)\b/.test(t)
    ? 'positive'
    : /\b(schade|problem|hilfe|sorry|traurig)\b/.test(t)
      ? 'supportive'
      : 'neutral';
  return { intent, emotion };
}

function generateAssistantReply(prompt, cls) {
  const clean = String(prompt || '').trim();
  if (!clean) return 'Ich habe nichts verstanden. Sag mir kurz, was ich tun soll.';
  if (cls.intent === 'question') return `Gute Frage. Kurz gesagt: ${clean} — ich prüfe das und gebe dir direkt eine klare Antwort.`;
  if (cls.intent === 'request') return `Alles klar, ich setze das für dich um: ${clean}.`;
  return `Verstanden: ${clean}. Ich bin dran.`;
}

async function generateAndQueueTTS(text, voice = DEFAULT_VOICE) {
  const filename = `tts_${Date.now()}.mp3`;
  const audioDir = path.join(PUBLIC_DIR, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, filename);

  const tts = new EdgeTTS({ voice });
  await tts.ttsPromise(text, audioPath);

  fs.writeFileSync(path.join(audioDir, 'latest.json'), JSON.stringify({ file: filename, text }));
  const queueId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  enqueueAudio({ queueId, file: filename, text });

  return { file: filename, text, queueId };
}

const server = http.createServer((req, res) => {
  // CORS for local access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  let filePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;

  // VRM model list API (for model switcher UI)
  if (req.method === 'GET' && requestUrl.pathname === '/vrm/list') {
    try {
      const rootFiles = fs.readdirSync(PUBLIC_DIR)
        .filter((f) => /\.vrm$/i.test(f))
        .map((f) => '/' + f);

      const vrmDir = path.join(PUBLIC_DIR, 'vrm');
      const nestedFiles = fs.existsSync(vrmDir)
        ? fs.readdirSync(vrmDir).filter((f) => /\.vrm$/i.test(f)).map((f) => '/vrm/' + f)
        : [];

      const all = [...rootFiles, ...nestedFiles];

      // Deduplicate by file size first (user requested), keep best canonical path.
      const bySize = new Map();
      const rankPath = (p) => {
        if (p.includes('Alicia') || p.includes('Constraint')) return 0;
        if (p.startsWith('/vrm/')) return 1;
        return 2;
      };

      all.forEach((webPath) => {
        const abs = path.join(PUBLIC_DIR, webPath.replace(/^\//, ''));
        const stat = fs.statSync(abs);
        const sizeKey = String(stat.size);
        const existing = bySize.get(sizeKey);
        if (!existing || rankPath(webPath) < rankPath(existing.path)) {
          bySize.set(sizeKey, { path: webPath, size: stat.size });
        }
      });

      const files = Array.from(bySize.values())
        .map((x) => x.path)
        .sort((a, b) => a.localeCompare(b));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files: [], error: error.message }));
    }
    return;
  }

  // Animation list API (auto-discovery for WebUI)
  if (req.method === 'GET' && req.url === '/animations/list') {
    const animDir = path.join(PUBLIC_DIR, 'animations');
    try {
      const files = fs.readdirSync(animDir)
        .filter((f) => /\.(fbx|glb|gltf)$/i.test(f))
        .sort((a, b) => a.localeCompare(b));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files: [], error: error.message }));
    }
    return;
  }

  // Queue API: fetch next item (or inspect queue)
  if (req.method === 'GET' && req.url.startsWith('/audio/queue')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const consume = url.searchParams.get('consume') === '1';
    const item = consume ? (audioQueue.shift() || null) : (audioQueue[0] || null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ item, queueLength: audioQueue.length }));
    return;
  }

  // Playback event API: client can post playback lifecycle events
  if (req.method === 'POST' && req.url === '/audio/events') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const type = data.type || 'unknown';
        pushPlaybackEvent(type, {
          queueId: data.queueId,
          file: data.file,
          text: data.text,
          detail: data.detail
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
    return;
  }

  // Optional diagnostics endpoint
  if (req.method === 'GET' && req.url === '/audio/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: playbackEvents.slice(-50), queueLength: audioQueue.length }));
    return;
  }
  
  // Handle /chat endpoint - prompt -> assistant reply -> TTS queue
  if (req.method === 'POST' && requestUrl.pathname === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const prompt = data.prompt || data.text || '';
        const voice = data.voice || DEFAULT_VOICE;

        const classification = classifyIntentEmotion(prompt);
        const reply = generateAssistantReply(prompt, classification);
        const ttsOut = await generateAndQueueTTS(reply, voice);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, prompt, reply, classification, ...ttsOut }));
      } catch (error) {
        console.error('❌ Chat Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
    return;
  }

  // Handle /tts endpoint - generate Edge TTS audio
  if (req.method === 'POST' && requestUrl.pathname === '/tts') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const text = data.text || 'Hallo!';
        const voice = data.voice || DEFAULT_VOICE;

        console.log(`🎤 Generating TTS: "${text}" with voice ${voice}`);
        const ttsOut = await generateAndQueueTTS(text, voice);

        console.log(`✅ TTS generated: ${ttsOut.file}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...ttsOut }));

      } catch (error) {
        console.error('❌ TTS Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  
  // Handle VRM upload
  if (req.method === 'POST' && req.url === '/upload-vrm') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      // Simple multipart parsing (just get the file)
      // This is a basic implementation - works with fetch FormData
      const boundary = req.headers['content-type'].split('boundary=')[1];
      const parts = buffer.toString('binary').split('--' + boundary);
      
      let vrmData = null;
      for (const part of parts) {
        if (part.includes('filename=') && part.includes('.vrm')) {
          const start = part.indexOf('\r\n\r\n') + 4;
          const end = part.lastIndexOf('\r\n');
          vrmData = buffer.slice(
            buffer.indexOf('\r\n\r\n') + 4,
            buffer.indexOf('\r\n--' + boundary)
          );
          break;
        }
      }
      
      if (vrmData) {
        const filename = 'vrm_' + Date.now() + '.vrm';
        const vrmPath = path.join(PUBLIC_DIR, 'vrm', filename);
        
        fs.writeFileSync(vrmPath, vrmData);
        console.log(`📤 VRM uploaded: ${filename}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: '/vrm/' + filename }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No VRM file found' }));
      }
    });
    return;
  }
  
  // Handle /audio/latest.json PUT (legacy)
  if (req.method === 'PUT' && req.url === '/audio/latest.json') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const audioDir = path.join(PUBLIC_DIR, 'audio');
      if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
      fs.writeFileSync(path.join(audioDir, 'latest.json'), body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      console.log('📝 Updated latest.json:', body.substring(0, 100));
    });
    return;
  }

  // Serve static files
  const fullPath = path.join(PUBLIC_DIR, filePath);
  const ext = path.extname(fullPath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.vrm': 'application/octet-stream',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving: ${PUBLIC_DIR}`);
  console.log(`🎤 TTS endpoint: POST /tts with {"text": "...", "voice": "de-DE-ConradNeural"}`);
  console.log(`   Available voices: de-DE-ConradNeural (male), de-DE-KlaraNeural (female), en-US-JennyNeural`);
});
