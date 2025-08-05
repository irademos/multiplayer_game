// /characters/CharacterBase.js
import * as THREE from "three";

export class CharacterBase {
  constructor(model) {
    this.model = model;
    this.health = 100;
    this.velocity = new THREE.Vector3();
    this.actions = {};
    this.currentAction = null;
    this.mixer = null;
  }

  setPosition(x, y, z) {
    this.model.position.set(x, y, z);
  }

  setRotationY(angle) {
    this.model.rotation.y = angle;
  }

  update(delta) {
    if (this.mixer) this.mixer.update(delta);
  }

  playAnimation(name) {
    if (this.currentAction === name || !this.actions[name]) return;
    this.actions[this.currentAction]?.fadeOut(0.3);
    this.actions[name].reset().fadeIn(0.3).play();
    this.currentAction = name;
  }
}
