#!/usr/bin/env python3
from faster_whisper import WhisperModel
from flask import Flask, request, jsonify
import tempfile
import os
import subprocess

app = Flask(__name__)

print("Loading Whisper model...")
model = WhisperModel("small", device="cpu", compute_type="int8")
print("Whisper ready!")

@app.route("/stt", methods=["POST"])
def transcribe():
    audio = request.data
    if not audio:
        return jsonify({"error": "No audio data"}), 400
    
    # Save to temp file
    with open("/tmp/stt_input.webm", "wb") as f:
        f.write(audio)
    
    # Convert to wav
    wav_path = "/tmp/stt_input.wav"
    subprocess.run([
        "ffmpeg", "-i", "/tmp/stt_input.webm",
        "-ar", "16000", "-ac", "1", wav_path, "-y", "-loglevel", "error"
    ], check=True)
    
    # Transcribe
    segments, _ = model.transcribe(wav_path, language="de")
    text = "".join([s.text for s in segments])
    
    # Cleanup
    os.unlink("/tmp/stt_input.webm")
    os.unlink(wav_path)
    
    print(f"Transcribed: {text}")
    return jsonify({"success": True, "transcript": text.strip()})

if __name__ == "__main__":
    app.run(port=8765, host="0.0.0.0")
