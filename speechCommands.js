export function initSpeechCommands(commands = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser.');
    return { start: () => {}, stop: () => {} };
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    console.log(event);
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      console.log(result);
      if (result.isFinal) {
        const transcript = result[0].transcript.trim().toLowerCase();
        Object.entries(commands).forEach(([phrase, callback]) => {
          if (transcript.includes(phrase.toLowerCase())) {
            try {
              callback();
            } catch (err) {
              console.error('Error executing command for phrase', phrase, err);
            }
          }
        });
      }
    }
  };

  recognition.onerror = (e) => {
    console.error('Speech recognition error:', e);
  };

  let active = false;

  recognition.onend = () => {
    if (active) {
      // Restart automatically to keep listening
      recognition.start();
    }
  };

  return {
    start: () => {
      active = true;
      try { recognition.start(); } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    },
    stop: () => {
      active = false;
      recognition.stop();
    }
  };
}
