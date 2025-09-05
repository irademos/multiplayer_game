import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { generateOcean, registerIsland, SEA_FLOOR_Y } from "./water.js";

export function createClouds(scene) {
  const rng = () => Math.random();

  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    opacity: 0.95,
    transparent: true,
    roughness: 0.9,
    metalness: 0.0,
    emissive: 0xcccccc,
    emissiveIntensity: 0.2,
  });

  for (let i = 0; i < 20; i++) {
    const cloudGroup = new THREE.Group();
    const puffCount = 3 + Math.floor(rng() * 5);
    for (let j = 0; j < puffCount; j++) {
      const puffSize = 2 + rng() * 3;
      const puffGeometry = new THREE.SphereGeometry(puffSize, 7, 7);
      const puff = new THREE.Mesh(puffGeometry, cloudMaterial);
      puff.position.x = (rng() - 0.5) * 5;
      puff.position.y = (rng() - 0.5) * 2;
      puff.position.z = (rng() - 0.5) * 5;
      cloudGroup.add(puff);
    }
    const angle = rng() * Math.PI * 2;
    const distance = 20 + rng() * 60;
    cloudGroup.position.x = Math.cos(angle) * distance;
    cloudGroup.position.z = Math.sin(angle) * distance;
    cloudGroup.position.y = 20 + rng() * 15;
    cloudGroup.rotation.y = rng() * Math.PI * 2;
    scene.add(cloudGroup);
  }
}

export const MOON_RADIUS = 70;

export function createMoon(scene, rapierWorld, rbToMesh) {
  const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 32, 32);
  const moonMaterial = new THREE.MeshStandardMaterial({ color: 0xdddddd });
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.position.set(0, 200, -30);
  moon.rotation.set(0, 0, 0);
  moon.quaternion.set(0, 0, 0, 1);
  moon.matrixAutoUpdate = false;
  moon.updateMatrix();
  scene.add(moon);
  window.moon = moon;

  if (rapierWorld) {
    const rb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        moon.position.x,
        moon.position.y,
        moon.position.z
      )
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.ball(MOON_RADIUS),
      rb
    );
    // Intentionally omit mapping to rbToMesh to keep the moon stationary
  }

  return moon;
}

export function generateIsland(scene, { islandRadius = 20, outerRadius = 100 } = {}) {
  // Sea floor
  const seaFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(outerRadius * 2, outerRadius * 2),
    new THREE.MeshStandardMaterial({ color: 0x00008B })
  );
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = SEA_FLOOR_Y;
  seaFloor.receiveShadow = true;
  scene.add(seaFloor);

  // Central island
  const hillHeight = 6;
  const hill = new THREE.Mesh(
    new THREE.ConeGeometry(islandRadius, hillHeight, 32),
    new THREE.MeshStandardMaterial({ color: 0x228B22 })
  );
  hill.position.y = SEA_FLOOR_Y + hillHeight / 2;
  scene.add(hill);
  registerIsland({ x: 0, z: 0 }, islandRadius, hillHeight);

  // Ocean around island
  generateOcean(scene, { x: 0, z: 0 }, 0, outerRadius);

  // Scatter a few small islands
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = islandRadius + 15 + Math.random() * (outerRadius - islandRadius - 20);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const r = 3 + Math.random() * 3;
    const h = 3 + Math.random() * 2;

    const smallHill = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 16),
      new THREE.MeshStandardMaterial({ color: 0x228B22 })
    );
    smallHill.position.set(x, SEA_FLOOR_Y + h / 2, z);
    scene.add(smallHill);
    registerIsland({ x, z }, r, h);
  }
}

export const baseHeightFunction = (x, z) => {
  return Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
};