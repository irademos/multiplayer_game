import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

export function generateTerrainChunk(scene, chunkX, chunkZ, size = 50) {
  const heightFunction = (x, z) => {
    return Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
  };

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

  terrainChunks.set(`${chunkX},${chunkZ}`, { mesh: terrain, heightFunction });
}

export function getTerrainHeightAt(x, z) {
  const chunkSize = 50;
  const cx = Math.floor(x / chunkSize);
  const cz = Math.floor(z / chunkSize);
  const key = `${cx},${cz}`;
  const chunk = terrainChunks.get(key);
  if (!chunk) return 0;
  return chunk.heightFunction(x, z);
}