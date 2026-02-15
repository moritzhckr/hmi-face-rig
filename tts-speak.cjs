#!/usr/bin/env node

const gtts = require('gtts');
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, 'public/audio');
const LATEST_FILE = path.join(AUDIO_DIR, 'latest.json');

// Ensure audio directory exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function speak(text, lang = 'de') {
  return new Promise((resolve, reject) => {
    console.log(`Speaking: "${text}"`);
    
    const timestamp = Date.now();
    const audioFile = `speech_${timestamp}.mp3`;
    const audioPath = path.join(AUDIO_DIR, audioFile);
    
    const gttsInstance = new gtts(text, lang);
    
    gttsInstance.save(audioPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Write latest.json
      const latestData = {
        file: audioFile,
        text: text,
        lang: lang,
        timestamp: timestamp
      };
      fs.writeFileSync(LATEST_FILE, JSON.stringify(latestData, null, 2));
      
      console.log(`✓ Saved: ${audioFile}`);
      resolve(latestData);
    });
  });
}

// CLI
const args = process.argv.slice(2);
if (args.length > 0) {
  const text = args.join(' ');
  speak(text).catch(console.error);
} else {
  console.log('Usage: node tts-speak.cjs "Text to speak" [lang]');
  console.log('Example: node tts-speak.cjs "Hallo Welt" de');
}

module.exports = { speak };
