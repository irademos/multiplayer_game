import * as THREE from "three";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createMonster(scene, onLoadCallback = () => {}) {
  const loader = new GLTFLoader();

  loader.load('/models/Orc.glb', gltf => {
    const monster = gltf.scene;
    monster.scale.set(2, 2, 2);
    monster.position.set(0, 0, 0);
    scene.add(monster);

    const mixer = new THREE.AnimationMixer(monster);
    const actions = {};

    gltf.animations.forEach(clip => {
      const name = clip.name.replace("CharacterArmature|", "");
      actions[name] = mixer.clipAction(clip);
    });

    const defaultAction = "Idle";
    actions[defaultAction]?.play();

    monster.userData = {
      mixer,
      actions,
      currentAction: defaultAction,
      direction: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
      speed: 0.01,
      lastDirectionChange: Date.now()
    };

    onLoadCallback(monster);
  }, undefined, error => {
    console.error("Failed to load monster model:", error);
  });
}

export function switchMonsterAnimation(monster, newName) {
  const { actions, currentAction } = monster.userData;
  if (newName === currentAction || !actions[newName]) return;

  actions[currentAction]?.fadeOut(0.3);
  actions[newName].reset().fadeIn(0.3).play();
  monster.userData.currentAction = newName;
}

export function updateMonster(monster, clock) {
    const now = Date.now();
    const data = monster.userData;

    // Change direction periodically
    if (now - data.lastDirectionChange > 5000) {
      data.direction.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      data.lastDirectionChange = now;
    }

    // Move the monster
    const movement = data.direction.clone().multiplyScalar(data.speed);
    monster.position.add(movement);

    // Bounds check and reverse direction
    if (Math.abs(monster.position.x) > 70 || Math.abs(monster.position.z) > 70) {
      data.direction.negate();
    }

    // Animation switching based on movement magnitude
    const isMoving = movement.length() > 0.001;
    const targetAnim = isMoving ? "Walk" : "Idle";
    switchMonsterAnimation(monster, targetAnim); // <- this is the function from earlier

    // Update animation mixer
    const delta = clock.getDelta();
    if (data.mixer) {
      data.mixer.update(delta);
    }
}