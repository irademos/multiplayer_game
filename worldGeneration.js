import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

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
export const SPHERE_RADIUS = 10;
let terrainSphere = null;

export function createTerrainSphere(scene, radius = SPHERE_RADIUS) {
  const geometry = new THREE.SphereGeometry(radius, 64, 64);
  const material = new THREE.MeshStandardMaterial({ color: 0x77cc77 });
  terrainSphere = new THREE.Mesh(geometry, material);
  terrainSphere.receiveShadow = true;
  scene.add(terrainSphere);

  const world = window.rapierWorld;
  if (world) {
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const colDesc = RAPIER.ColliderDesc.ball(radius);
    world.createCollider(colDesc, rb);
    terrainSphere.userData.rb = rb;
  }
}

export function getTerrainHeightAt(x, z) {
  const r2 = SPHERE_RADIUS * SPHERE_RADIUS;
  const y = Math.sqrt(Math.max(0, r2 - x * x - z * z));
  return y;
}