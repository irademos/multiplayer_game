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

  function speak(text, volume = 1) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.pitch = 0.001; // deep voice for orc
    utter.rate = 0.2;
    utter.volume = volume;
    if (voices.length) {
      utter.voice = voices[0];
    }
    synth.speak(utter);
  }

  function speakRandom(volume = 1) {
    if (!phrases.length) return;
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speak(phrase, volume);
  }

  return { speak, speakRandom };
}
