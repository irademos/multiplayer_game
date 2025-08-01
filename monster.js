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
  // console.log(actions);
  if (newName === currentAction || !actions[newName]) return;

  actions[currentAction]?.fadeOut(0.3);
  actions[newName].reset().fadeIn(0.3).play();
  monster.userData.currentAction = newName;
}

export function updateMonster(monster, clock, playerModel, otherPlayers) {
  const now = Date.now();
  const data = monster.userData;

  const allPlayers = [
    { id: 'local', model: playerModel },
    ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p.model }))
  ];

  let closestPlayer = null;
  let closestDistance = Infinity;

  for (const player of allPlayers) {
    const dist = monster.position.distanceTo(player.model.position);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestPlayer = player;
    }
  }

  if (!closestPlayer) {
    switchMonsterAnimation(monster, "Idle");
    return;
  }

  const targetPos = closestPlayer.model.position.clone();
  const distance = monster.position.distanceTo(targetPos);
  const isInAttackRange = distance < 2.0;

  if (!isInAttackRange) {
    const direction = targetPos.sub(monster.position).normalize();
    data.direction.copy(direction);
    const movement = data.direction.clone().multiplyScalar(data.speed * 3); // faster chase
    monster.position.add(movement);
    monster.lookAt(closestPlayer.model.position);

    switchMonsterAnimation(monster, "Walk");
  } else {
    switchMonsterAnimation(monster, "Weapon");

    if (!data.lastAttackTime || now - data.lastAttackTime > 2000) {
      data.lastAttackTime = now;
      console.log(`👹 Monster attacked ${closestPlayer.id}`);
      if (window.playerModel?.position) {
        const dist = monster.position.distanceTo(window.playerModel.position);
        if (dist < 3.2) {
          window.localHealth = Math.max(0, window.localHealth - 5);
          console.log(`👹 Monster attacks you! Distance: ${dist.toFixed(2)} | Health: ${window.localHealth.toFixed(1)}`);
        }
      }
    }
  }

  const delta = clock.getDelta();
  if (data.mixer) {
    data.mixer.update(delta);
  }
}