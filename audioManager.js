export class AudioManager {
  constructor() {
    this.background = null;
    this.lastFootstep = 0;
    this.footsteps = [
      'SFX/Footsteps/Dirt/Dirt Walk 1.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 2.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 3.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 4.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 5.ogg'
    ];
    this.attacks = [
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 2.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 3.ogg'
    ];
    this.ballKickSounds = [
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 2.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg'
    ];
    this.punchSounds = [
      'SFX/Torch/Torch Attack Strike 1.ogg',
      'SFX/Torch/Torch Attack Strike 2.ogg'
    ];
    this.slideSounds = [
      'SFX/Footsteps/Water/Water Walk 1.ogg',
      'SFX/Footsteps/Water/Water Walk 2.ogg',
      'SFX/Footsteps/Water/Water Walk 3.ogg'
    ];
    this.rollSounds = [
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Blocked 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Blocked 2.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Blocked 3.ogg'
    ];
  }

  playBGS(name) {
    if (this.background) {
      this.background.pause();
    }
    const path = `assets/audio/BGS Loops/${name}`;
    this.background = new Audio(path);
    this.background.loop = true;
    this.background.volume = 0.5;
    this.background.play().catch(err => console.error('BGS play failed', err));
  }

  playSFX(path, volume = 0.7) {
    const audio = new Audio(`assets/audio/${path}`);
    audio.volume = volume;
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
