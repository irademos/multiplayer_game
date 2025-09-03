import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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

export const terrainChunks = new Map();

export const baseHeightFunction = (x, z) => {
  return Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
};

export function chunkIndex(value, size = 50) {
  return Math.floor((value + size / 2) / size);
}

export function generateTerrainChunk(scene, chunkX, chunkZ, size = 50) {
  const heightFunction = baseHeightFunction;

  const geometry = new THREE.PlaneGeometry(size, size, 32, 32);
  geometry.rotateX(-Math.PI / 2);

  const vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i) + chunkX * size;
    const z = vertices.getZ(i) + chunkZ * size;
    const y = heightFunction(x, z);
    vertices.setY(i, y);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: 0x77cc77 });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.position.set(chunkX * size, 0, chunkZ * size);
  scene.add(terrain);

  const world = window.rapierWorld;
  if (world) {
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(chunkX * size, 0, chunkZ * size)
    );
    const vertices = Float32Array.from(geometry.attributes.position.array);
    const indices = Uint32Array.from(geometry.index.array);
    const colDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    world.createCollider(colDesc, rb);
    terrain.userData.rb = rb;
  }

  terrainChunks.set(`${chunkX},${chunkZ}`, { mesh: terrain, heightFunction });
}

export function getTerrainHeightAt(x, z) {
  const chunkSize = 50;
  const key = `${chunkIndex(x, chunkSize)},${chunkIndex(z, chunkSize)}`;
  const chunk = terrainChunks.get(key);
  const heightFn = chunk ? chunk.heightFunction : baseHeightFunction;
  return heightFn(x, z);
}