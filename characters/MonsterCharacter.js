import * as THREE from "three";
import { getTerrainHeightAt } from '../worldGeneration.js';

export function switchMonsterAnimation(monster, newName) {
  const { actions, currentAction } = monster.userData;
  if (newName === currentAction || !actions[newName]) return;

  const nextAction = actions[newName];
  nextAction.reset();

  // Stop looping for death animation
  if (newName === "Death" || newName === "HitReact") {
    nextAction.setLoop(THREE.LoopOnce);
    nextAction.clampWhenFinished = true;
  } else {
    nextAction.setLoop(THREE.LoopRepeat);
    nextAction.clampWhenFinished = false;
  }

  actions[currentAction]?.fadeOut(0.3);
  nextAction.fadeIn(0.3).play();
  monster.userData.currentAction = newName;
}


export function updateMonster(monster, clock, playerModel, otherPlayers) {
  const now = Date.now();
  const data = monster.userData;

  // 🧠 Handle monster death state
  if (window.monsterHealth <= 0) {
    if (!data.isDead) {
      data.isDead = true;
      switchMonsterAnimation(monster, "Death");
    }

    // Continue updating the mixer so animation plays
    const delta = clock.getDelta();
    if (data.mixer) data.mixer.update(delta);

    return; // ⛔ Stop further behavior logic (walking, attacking, etc.)
  }

  // Early return if reacting to a hit
  if (monster.userData.hitReacting) {
    const delta = clock.getDelta();
    if (monster.userData.mixer) {
      monster.userData.mixer.update(delta);
    }
    return;
  }

  // 🕊️ Friendly mode: wander around without attacking players
  if (data.mode === "friendly") {
    const delta = clock.getDelta();

    // Change direction every few seconds to simulate wandering
    if (now - data.lastDirectionChange > 2000) {
      data.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      data.lastDirectionChange = now;
    }

    const movement = data.direction.clone().multiplyScalar(data.speed);
    monster.position.add(movement);

    // Follow terrain height and face movement direction
    const targetY = getTerrainHeightAt(monster.position.x, monster.position.z);
    monster.position.y += (targetY - monster.position.y) * 0.2;
    monster.lookAt(monster.position.clone().add(data.direction));

    switchMonsterAnimation(monster, "Walk");

    if (data.mixer) data.mixer.update(delta);
    return; // ⛔ Skip enemy logic
  }

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
  const isInAttackRange = distance < 1.0;

  if (!isInAttackRange && (!data.lastAttackTime || now - data.lastAttackTime > 2000)) {
    const direction = targetPos.sub(monster.position).normalize();
    data.direction.copy(direction);
    const movement = data.direction.clone().multiplyScalar(data.speed * 3);
    monster.position.add(movement);
    monster.lookAt(closestPlayer.model.position);
    // Adjust vertical position to follow terrain
    const targetY = getTerrainHeightAt(monster.position.x, monster.position.z);
    monster.position.y += (targetY - monster.position.y) * 0.2;
    switchMonsterAnimation(monster, "Walk");
  } else {
    if (!data.lastAttackTime || now - data.lastAttackTime > 2000) {
      switchMonsterAnimation(monster, "Weapon");
      data.lastAttackTime = now;
      console.log(`👹 Monster attacked ${closestPlayer.id}`);

      if (window.playerModel?.position) {
        const playerDist = monster.position.distanceTo(window.playerModel.position);
        const maxHearingDistance = 20;
        const volume = Math.max(0, 1 - playerDist / maxHearingDistance);
        monster.userData.voice?.speakRandom(volume);

        if (playerDist < 3.2 && !window.playerControls.isKnocked) {
          window.localHealth = Math.max(0, window.localHealth - 10);
          playerModel.userData.currentAction = 'hit';
          const knockbackDir = new THREE.Vector3()
            .subVectors(window.playerModel.position, monster.position)
            .normalize();

          // knockbackDir.z = 0.4; // optional lift arc
          window.playerControls.knockbackVelocity.copy(knockbackDir.multiplyScalar(0.3));

          window.playerControls.isKnocked = true;

          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(monster.quaternion).normalize();
          window.playerControls.knockbackRotation = new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ');
          window.playerControls.knockbackRotationAxis = right;

          console.log(`👹 Monster attacks you! Distance: ${playerDist.toFixed(2)} | Health: ${window.localHealth.toFixed(1)}`);
        }
      }
    }
  }

  const delta = clock.getDelta();
  if (data.mixer) {
    data.mixer.update(delta);
  }
}

// Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes