const http = require('http');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');
const { execFile } = require('child_process');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// German voices: de-DE-ConradNeural, de-DE-KlaraNeural
const DEFAULT_VOICE = 'de-DE-ConradNeural';

// Simple in-memory audio queue + playback event log
const audioQueue = [];
const playbackEvents = [];
const MAX_EVENTS = 200;

// ==================== Faster Whisper STT ====================
let whisperModel = null;

async function getWhisperModel() {
  if (!whisperModel) {
    console.log('Loading faster-whisper model...');
    const { WhisperModel } = await import('faster-whisper');
    whisperModel = new WhisperModel('small', { device: 'cpu' });
    console.log('✅ Whisper model loaded (small, CPU)');
  }
  return whisperModel;
}

// Call external STT server (Whisper on port 8765)
function transcribeAudio(audioBuffer) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8765,
      path: '/stt',
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'Content-Length': audioBuffer.length
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success && result.transcript) {
            console.log('📝 Whisper transcription:', result.transcript);
            resolve(result.transcript.trim());
          } else {
            reject(new Error(result.error || 'STT failed'));
          }
        } catch(e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(audioBuffer);
    req.end();
  });
}


function pushPlaybackEvent(type, payload = {}) {
  playbackEvents.push({ id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ts: Date.now(), type, ...payload });
  if (playbackEvents.length > MAX_EVENTS) playbackEvents.splice(0, playbackEvents.length - MAX_EVENTS);
}

function enqueueAudio(item) {
  audioQueue.push(item);
  pushPlaybackEvent('queue.enqueued', { queueId: item.queueId, file: item.file, text: item.text });
}

function runLocalAgentPrompt(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--local',
      '--session-id',
      'webui-face-rig',
      '--thinking',
      'off',
      '--timeout',
      '45',
      '--message',
      String(prompt || ''),
      '--json'
    ];

    execFile('openclaw', args, { timeout: 50000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        const reply = parsed?.payloads?.[0]?.text || '';
        if (!reply) return reject(new Error('No assistant reply payload'));
        resolve(reply);
      } catch (e) {
        reject(new Error(`Agent parse error: ${e.message}`));
      }
    });
  });
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
  
  // Handle /agent/call-turn endpoint - transcript -> local OpenClaw agent reply -> TTS queue
  if (req.method === 'POST' && requestUrl.pathname === '/agent/call-turn') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const contentType = req.headers['content-type'] || '';
        let transcript = '';
        let voice = DEFAULT_VOICE;
        
        if (contentType.includes('application/json')) {
          const data = JSON.parse(body || '{}');
          transcript = data.transcript || data.prompt || data.text || '';
          voice = data.voice || DEFAULT_VOICE;
        } else {
          // Raw text
          transcript = body.trim();
        }
        
        if (!transcript) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'transcript required' }));
          return;
        }

        const reply = await runLocalAgentPrompt(transcript);
        const ttsOut = await generateAndQueueTTS(reply, voice);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          mode: 'agent-call',
          transcript,
          reply,
          queue: {
            queueId: ttsOut.queueId,
            file: ttsOut.file,
            text: ttsOut.text,
            url: '/audio/' + ttsOut.file
          },
          ...ttsOut
        }));
      } catch (error) {
        console.error('❌ Agent Call Turn Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
    return;
  }

  // Handle /chat endpoint - prompt -> local OpenClaw agent reply -> TTS queue
  if (req.method === 'POST' && requestUrl.pathname === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const prompt = data.prompt || data.text || '';
        const voice = data.voice || DEFAULT_VOICE;

        const reply = await runLocalAgentPrompt(prompt);
        const ttsOut = await generateAndQueueTTS(reply, voice);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, prompt, reply, ...ttsOut }));
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

  // ==================== /stt endpoint - Local Whisper STT ====================
  if (req.method === 'POST' && requestUrl.pathname === '/stt') {
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'multipart/form-data required' }));
      return;
    }
    
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (!boundaryMatch) throw new Error('No boundary found');
        const boundary = boundaryMatch[1];
        
        // Simple multipart parser - extract audio data
        const parts = buffer.toString('binary').split('--' + boundary);
        let audioData = null;
        
        for (const part of parts) {
          if (part.includes('audio') || part.includes('webm') || part.includes('blob')) {
            const audioStart = part.indexOf('\r\n\r\n');
            if (audioStart > 0) {
              const partData = part.slice(audioStart + 4).replace(/\r\n--$/, '');
              audioData = Buffer.from(partData, 'binary');
              break;
            }
          }
        }
        
        if (!audioData || audioData.length < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No audio data found' }));
          return;
        }
        
        console.log(`🎙️ Transcribing ${audioData.length} bytes...`);
        const transcript = await transcribeAudio(audioData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, transcript }));
        
      } catch (error) {
        console.error('❌ STT Error:', error);
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
