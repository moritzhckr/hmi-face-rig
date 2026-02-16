const http = require('http');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// German voices: de-DE-ConradNeural, de-DE-KlaraNeural
const DEFAULT_VOICE = 'de-DE-ConradNeural';

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

  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Handle /tts endpoint - generate Edge TTS audio
  if (req.method === 'POST' && req.url.startsWith('/tts')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const text = data.text || 'Hallo!';
        const voice = data.voice || DEFAULT_VOICE;
        
        // Generate unique filename
        const filename = `tts_${Date.now()}.mp3`;
        const audioPath = path.join(PUBLIC_DIR, 'audio', filename);
        
        // Create audio directory if needed
        const audioDir = path.join(PUBLIC_DIR, 'audio');
        if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
        
        // Generate TTS audio
        console.log(`🎤 Generating TTS: "${text}" with voice ${voice}`);
        
        const tts = new EdgeTTS({ voice: voice });
        await tts.ttsPromise(text, audioPath);
        
        // Update latest.json with new file
        const latestJson = { file: filename, text: text };
        fs.writeFileSync(path.join(audioDir, 'latest.json'), JSON.stringify(latestJson));
        
        console.log(`✅ TTS generated: ${filename}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, file: filename, text: text }));
        
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
