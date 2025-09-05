import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { generateOcean } from "./water.js";

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
    if (rbToMesh) rbToMesh.set(rb, moon);
  }

  return moon;
}

export function generateIsland(scene, { islandRadius = 20, outerRadius = 100 } = {}) {
  // Sea floor
  const seaFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(outerRadius * 2, outerRadius * 2),
    new THREE.MeshStandardMaterial({ color: 0x8B4513 })
  );
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = -2;
  seaFloor.receiveShadow = true;
  scene.add(seaFloor);

  // Central island
  const hillHeight = 6;
  const hill = new THREE.Mesh(
    new THREE.ConeGeometry(islandRadius, hillHeight, 32),
    new THREE.MeshStandardMaterial({ color: 0x228B22 })
  );
  hill.position.y = -2 + hillHeight / 2;
  scene.add(hill);

  // Sand ring
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(islandRadius + 2, islandRadius + 2, 1, 32),
    new THREE.MeshStandardMaterial({ color: 0xC2B280 })
  );
  sand.position.y = -1.5;
  scene.add(sand);

  // Ocean around island
  generateOcean(scene, { x: 0, z: 0 }, islandRadius + 2, outerRadius);

  // Scatter a few small islands
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = islandRadius + 15 + Math.random() * (outerRadius - islandRadius - 20);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const r = 3 + Math.random() * 3;
    const h = 2 + Math.random() * 2;

    const smallSand = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 1, r + 1, 0.5, 16),
      new THREE.MeshStandardMaterial({ color: 0xC2B280 })
    );
    smallSand.position.set(x, -1.75, z);
    scene.add(smallSand);

    const smallHill = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 16),
      new THREE.MeshStandardMaterial({ color: 0x228B22 })
    );
    smallHill.position.set(x, -2 + h / 2, z);
    scene.add(smallHill);
  }
}

export const baseHeightFunction = (x, z) => {
  return Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
};