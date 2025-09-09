import * as THREE from "three";
import { getWaterDepth, SWIM_DEPTH_THRESHOLD, getWaterHeight } from "../water.js";

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
  const body = data.rb;
  if (!body) return;

  const t = body.translation();
  monster.position.set(t.x, t.y, t.z);
  const waterDepth = getWaterDepth(t.x, t.z);
  const surfaceY = getWaterHeight(t.x, t.z);
  const floatTargetY = surfaceY + 1;
  const isInWater = waterDepth > SWIM_DEPTH_THRESHOLD && t.y < floatTargetY;
  data.speedMod = isInWater ? 0.5 : 1;
  if (isInWater && t.y < floatTargetY) {
    const newY = t.y + (floatTargetY - t.y) * 0.1;
    body.setTranslation({ x: t.x, y: newY, z: t.z }, true);
    monster.position.y = newY;
  }

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

    const vel = body.linvel();
    const movement = data.direction.clone().multiplyScalar(data.speed * data.speedMod);
    body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
    const angle = Math.atan2(data.direction.x, data.direction.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    body.setRotation(rot, true);
    switchMonsterAnimation(monster, "Walk");
    if (data.mixer) data.mixer.update(delta);
    return;
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
    const movement = data.direction.clone().multiplyScalar(data.speed * 3 * data.speedMod);
    const vel = body.linvel();
    body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
    const angle = Math.atan2(data.direction.x, data.direction.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    body.setRotation(rot, true);
    switchMonsterAnimation(monster, "Walk");
  } else {
    const vel = body.linvel();
    body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
    if (!data.lastAttackTime || now - data.lastAttackTime > 2000) {
      switchMonsterAnimation(monster, "Weapon");
      data.lastAttackTime = now;
      data.attackStartTime = now;
      data.attackHasHit = false;
      console.log(`👹 Monster attacked ${closestPlayer.id}`);

      if (window.playerModel?.position) {
        const playerDist = monster.position.distanceTo(window.playerModel.position);
        const maxHearingDistance = 20;
        const volume = Math.max(0, 1 - playerDist / maxHearingDistance);
        monster.userData.voice?.speakRandom(volume);
      }
    }
  }

  const delta = clock.getDelta();
  if (data.mixer) {
    data.mixer.update(delta);
  }

  if (monster.userData.currentAction === "Weapon" && data.attackStartTime) {
    const elapsed = now - data.attackStartTime;
    const hitTime = 500;
    if (!data.attackHasHit && elapsed >= hitTime) {
      for (const player of allPlayers) {
        const dist = monster.position.distanceTo(player.model.position);
        if (dist < 3.2) {
          if (player.id === 'local' && !window.playerControls.isKnocked) {
            window.localHealth = Math.max(0, window.localHealth - 10);
            if (window.playerControls) {
              const impulse = monster.userData.direction.clone().multiplyScalar(0.17);
              window.playerControls.applyKnockback(impulse);
            }
            console.log(`👹 Monster attacks you! Distance: ${dist.toFixed(2)} | Health: ${window.localHealth.toFixed(1)}`);
          } else if (player.id !== 'local') {
            const op = otherPlayers[player.id];
            if (op) {
              op.health = Math.max(0, (op.health || 100) - 10);
              console.log(`👹 Monster attacks ${player.id} | Health: ${op.health}`);
            }
          }
        }
      }
      data.attackHasHit = true;
    }
    if (elapsed > hitTime + 500) {
      data.attackStartTime = null;
      data.attackHasHit = false;
    }
  }
}

// Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes
