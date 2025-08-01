import * as THREE from "three";
import { updateMonster } from './monster.js';

export function spawnProjectile(scene, projectiles, position, direction) {
  const geometry = new THREE.SphereGeometry(0.1, 16, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.copy(position);
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

    if (proj.position.y <= 0.3) {
      proj.position.y = 0.3;
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
        break;
      }
    }

    const projBox = new THREE.Box3().setFromObject(proj);
    const localBox = new THREE.Box3().setFromObject(playerModel);
    if (projBox.intersectsBox(localBox) && age >= 80) {
      console.log(`💥 You were hit`);
      scene.remove(proj);
      projectiles.splice(i, 1);

      if (typeof window.localHealth === 'number') {
        window.localHealth = Math.max(0, window.localHealth - 10);
        console.log(`❤️ Your Health: ${window.localHealth}`);
      }
    }

    if (monster) {
      const monsterBox = new THREE.Box3().setFromObject(monster);
      if (projBox.intersectsBox(monsterBox) && age >= 80) {
        console.log(`💥 Monster was hit`);
        scene.remove(proj);
        projectiles.splice(i, 1);
        
        if (typeof window.monsterHealth === 'number') {
          window.monsterHealth = Math.max(0, window.monsterHealth - 10);
          console.log(`👹 Monster Health: ${window.monsterHealth}`);
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