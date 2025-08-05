// /models/monsterModel.js
import * as THREE from "three";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function loadMonsterModel(scene, callback) {
  const loader = new GLTFLoader();
  loader.load('/models/Orc.glb', gltf => {
    const model = gltf.scene;
    model.scale.set(2, 2, 2);
    scene.add(model);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    gltf.animations.forEach(clip => {
      const name = clip.name.replace("CharacterArmature|", "");
      actions[name] = mixer.clipAction(clip);
    });

    callback({ model, mixer, actions });
  }, undefined, err => {
    console.error("Failed to load monster model:", err);
  });
}