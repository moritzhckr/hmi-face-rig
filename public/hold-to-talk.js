    // Hold-to-Talk: Button gedrückt halten → Audio aufnehmen → als Blob an Agent senden
    let holdToTalkActive = false;
    let mediaRecorder = null;
    let audioChunks = [];
    
    async function startHoldToTalk() {
      if (holdToTalkActive) return;
      if (!audioEnabled) await window.initBrowserPermissions();
      
      holdToTalkActive = true;
      const btn = document.getElementById('btn-hold-to-speak');
      btn.classList.add('active');
      btn.textContent = '🎤 🔴 Aufnahme läuft...';
      ttsStatus.textContent = '🎤 Aufnahme gestartet...';
      
      try {
        // Audio aufnehmen mit MediaRecorder
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = async () => {
          // Audio-Blob erstellen
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          
          // Stream beenden
          stream.getTracks().forEach(track => track.stop());
          
          if (audioChunks.length === 0 || audioBlob.size < 1000) {
            ttsStatus.textContent = '⌛ Keine Aufnahme, versuch es nochmal';
            resetHoldToTalk();
            return;
          }
          
          ttsStatus.textContent = '📤 Audio wird gesendet...';
          
          // Audio an Agent senden als FormData
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');
          formData.append('voice', 'de-DE-ConradNeural');
          
          try {
            const response = await fetch('/agent/call-turn', {
              method: 'POST',
              body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
              appendMiniChat('Du', data.transcript || '(Audio)');
              appendMiniChat('Claw', data.reply || '(Antwort)');
              
              if (data.file && shouldUseLocalPlayback()) {
                playAudioFile(data.reply || data.text || '', data.file, data.queueId || null);
                ttsStatus.textContent = '✅ Antwort wird abgespielt';
              } else {
                ttsStatus.textContent = '✅ Antwort bereit';
              }
            } else {
              ttsStatus.textContent = '✗ Agent antwortet nicht';
            }
          } catch (err) {
            console.error('Audio send error:', err);
            ttsStatus.textContent = '✗ Sende-Fehler: ' + err.message;
          }
          
          resetHoldToTalk();
        };
        
        mediaRecorder.start(100); // Alle 100ms Daten sammeln
        
      } catch (e) {
        console.error('Hold-to-talk start error:', e);
        ttsStatus.textContent = '✗ Mic-Fehler: ' + e.message;
        resetHoldToTalk();
      }
    }
    
    function resetHoldToTalk() {
      holdToTalkActive = false;
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch(e) {}
        mediaRecorder = null;
      }
      const btn = document.getElementById('btn-hold-to-speak');
      if (btn) {
        btn.classList.remove('active');
        btn.textContent = '🎤 Halten zum Sprechen';
      }
    }
