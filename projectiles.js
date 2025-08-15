import * as THREE from "three";
import { updateMonster, switchMonsterAnimation } from './characters/MonsterCharacter.js';
import { getTerrainHeightAt } from "./worldGeneration.js";

export function spawnProjectile(scene, projectiles, position, direction) {
  const geometry = new THREE.SphereGeometry(0.1, 16, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.copy(position.clone().add(direction.clone().normalize().multiplyScalar(1.2)));
  const groundY = getTerrainHeightAt(position.x, position.z) + 0.1;
  if (sphere.position.y < groundY) {
    sphere.position.y = groundY;
  }
  sphere.userData.velocity = direction.clone().multiplyScalar(0.1);
  sphere.userData.lifetime = 4000;
  sphere.userData.spawnTime = Date.now();
  scene.add(sphere);
  projectiles.push(sphere);
}

export function updateProjectiles({
  scene,
  projectiles,
  otherPlayers,
  playerModel,
  multiplayer,
  monster,
  clock
}) {
  const gravity = -0.0008;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    const vel = proj.userData.velocity;
    vel.y += gravity;
    proj.position.add(vel);

    const terrainY = getTerrainHeightAt(proj.position.x, proj.position.z) + 0.1;
    if (proj.position.y <= terrainY) {
      proj.position.y = terrainY;
      vel.y = Math.abs(vel.y) > 0.01 ? vel.y * -0.5 : 0;
    }

    const barriers = scene.children.filter(obj => obj.userData?.isBarrier);

    for (const barrier of barriers) {
      const projBox = new THREE.Box3().setFromObject(proj);
      const barrierBox = new THREE.Box3().setFromObject(barrier);
      if (projBox.intersectsBox(barrierBox)) {
        vel.reflect(new THREE.Vector3(0, 1, 0));
        proj.position.add(vel.clone().multiplyScalar(0.5));
        break;
      }
    }

    proj.userData.lifetime -= 16;
    if (proj.userData.lifetime <= 0) {
      scene.remove(proj);
      projectiles.splice(i, 1);
      continue;
    }

    const age = Date.now() - proj.userData.spawnTime;

    let removed = false;

    for (const [id, { model }] of Object.entries(otherPlayers)) {
      if (age < 80) continue;
      const projBox = new THREE.Box3().setFromObject(proj);
      const playerBox = new THREE.Box3().setFromObject(model);
      if (projBox.intersectsBox(playerBox)) {
        const player = otherPlayers[id];
        if (player) {
          player.health = Math.max(0, (player.health || 100) - 10);
          console.log(`💥 Hit player: ${id}, Health: ${player.health}`);
        }
        scene.remove(proj);
        projectiles.splice(i, 1);
        removed = true;
        break;
      }
    }

    if (removed) continue;

    // Check destructible props loaded via LevelLoader
    if (window.breakManager) {
      for (const [id, data] of window.breakManager.registry.entries()) {
        const targetBox = new THREE.Box3().setFromObject(data.object);
        const projBox = new THREE.Box3().setFromObject(proj);
        if (projBox.intersectsBox(targetBox)) {
          window.breakManager.onHit(id, 25, proj.userData.velocity.clone());
          scene.remove(proj);
          projectiles.splice(i, 1);
          removed = true;
          break;
        }
      }
    }

    if (removed) continue;

    const projBox = new THREE.Box3().setFromObject(proj);
    const localBox = new THREE.Box3().setFromObject(playerModel);
    if (projBox.intersectsBox(localBox) && age >= 80) {
      console.log(`💥 You were hit`);
      scene.remove(proj);
      projectiles.splice(i, 1);
      removed = true;

      if (typeof window.localHealth === 'number') {
        window.localHealth = Math.max(0, window.localHealth - 10);
        console.log(`❤️ Your Health: ${window.localHealth}`);
      }

      if (window.playerControls) {
        const impulse = vel.clone().multiplyScalar(5);
        window.playerControls.applyKnockback(impulse);
      }
    }

    if (removed) continue;

    if (monster) {
      const monsterBox = new THREE.Box3().setFromObject(monster);
      if (projBox.intersectsBox(monsterBox) && age >= 80) {
        console.log(`💥 Monster was hit`);
        monster.userData.mode = "enemy";
        scene.remove(proj);
        projectiles.splice(i, 1);
        removed = true;

        if (typeof window.monsterHealth === 'number') {
          window.monsterHealth = Math.max(0, window.monsterHealth - 10);
          console.log(`👹 Monster Health: ${window.monsterHealth}`);

          if (window.monsterHealth > 0 && !monster.userData.hitReacting) {
            console.log("🎯 Triggering HitReact");
            switchMonsterAnimation(monster, "Death");

            monster.userData.hitReacting = true;

            // Set duration to match your HitReact animation lengthd
            setTimeout(() => {
              monster.userData.hitReacting = false;
            }, 100); // Adjust timing based on actual animation duration
          }

        }
      }
    }
  }

  if (multiplayer?.isMonsterOwner && monster) {
    updateMonster(monster, clock, playerModel, otherPlayers); // pass in new args
    multiplayer.send({
      type: "monster",
      x: monster.position.x,
      y: monster.position.y,
      z: monster.position.z
    });
  }

}
