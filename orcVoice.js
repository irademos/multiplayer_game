export function createOrcVoice(phrases = []) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return { speakRandom: () => {}, speak: () => {} };
  }

  const synth = window.speechSynthesis;
  let voices = synth.getVoices();
  if (!voices.length) {
    synth.onvoiceschanged = () => {
      voices = synth.getVoices();
    };
  }

  function speak(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.pitch = 0.001; // deep voice for orc
    utter.rate = 0.2;
    if (voices.length) {
      utter.voice = voices[0];
    }
    synth.speak(utter);
  }

  function speakRandom() {
    if (!phrases.length) return;
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speak(phrase);
  }

  return { speak, speakRandom };
}
