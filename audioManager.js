const MUSIC_TRACKS = [
  'BGS Loops/song1.ogg',
  'BGS Loops/song2.ogg',
  'BGS Loops/song3.ogg',
];

export class AudioManager {
  constructor() {
    this.background = null;
    this.musicVolume = parseFloat(localStorage.getItem('musicVolume') ?? '0.5');
    this.sfxVolume = parseFloat(localStorage.getItem('sfxVolume') ?? '0.7');
    this._shuffledTracks = [];
    this._trackIndex = 0;
    this._musicStarted = false;

    this.lastFootstep = 0;
    this.footsteps = [
      'SFX/Footsteps/Dirt/Dirt Walk 1.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 2.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 3.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 4.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 5.ogg'
    ];
    this.attacks = [
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 1.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 2.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 3.ogg'
    ];
    this.ballKickSounds = [
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 1.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 2.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 3.ogg'
    ];
    this.punchSounds = [
      'SFX/Footsteps/Dirt/Dirt Run 1.ogg'
    ];
    this.slideSounds = [
      'SFX/Spells/Firebuff 1.ogg',
      'SFX/Torch/Light Torch 1.ogg'
    ];
    this.rollSounds = [
      'SFX/Footsteps/Wood/Wood Run 2.ogg'
    ];
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  startMusic() {
    if (this._musicStarted) return;
    this._musicStarted = true;
    this._shuffledTracks = this._shuffle(MUSIC_TRACKS);
    this._trackIndex = 0;
    this._playNextTrack();
  }

  _playNextTrack() {
    if (this.background) {
      this.background.pause();
      this.background.onended = null;
    }
    const track = this._shuffledTracks[this._trackIndex];
    this._trackIndex++;
    if (this._trackIndex >= this._shuffledTracks.length) {
      this._shuffledTracks = this._shuffle(MUSIC_TRACKS);
      this._trackIndex = 0;
    }
    const audio = new Audio(`assets/audio/${track}`);
    audio.volume = this.musicVolume;
    audio.onended = () => this._playNextTrack();
    audio.play().catch(err => console.warn('Music play failed', err));
    this.background = audio;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    localStorage.setItem('musicVolume', String(v));
    if (this.background) this.background.volume = v;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    localStorage.setItem('sfxVolume', String(v));
  }

  // Legacy: kept for compatibility but now delegates to random music
  playBGS(name) {
    this.startMusic();
  }

  playSFX(path, baseVolume = 0.7) {
    const audio = new Audio(`assets/audio/${path}`);
    audio.volume = baseVolume * this.sfxVolume;
    audio.play();
    return audio;
  }

  _random(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  playAttack() {
    this.playSFX(this._random(this.attacks), 0.6);
  }

  playBallKick() {
    this.playSFX(this._random(this.ballKickSounds), 0.75);
  }

  playPunch() {
    this.playSFX(this._random(this.punchSounds), 0.65);
  }

  playSlide() {
    this.playSFX(this._random(this.slideSounds), 0.55);
  }

  playRoll() {
    this.playSFX(this._random(this.rollSounds), 0.55);
  }

  playFootstep() {
    const now = performance.now();
    if (now - this.lastFootstep < 400) return;
    this.lastFootstep = now;
    this.playSFX(this._random(this.footsteps), 0.4);
  }
}
