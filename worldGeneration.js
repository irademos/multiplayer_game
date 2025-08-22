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

// Radius of the spherical world
export const planetRadius = 100;

/**
 * Create a spherical planet that replaces the previous flat terrain.
 * The planet is centered at the origin so player movement can be
 * calculated relative to the planet's surface normal.
 */
export function createPlanet(scene) {
  const geometry = new THREE.SphereGeometry(planetRadius, 64, 64);
  const material = new THREE.MeshStandardMaterial({ color: 0x77cc77 });
  const planet = new THREE.Mesh(geometry, material);
  planet.receiveShadow = true;
  scene.add(planet);
  return planet;
}

/**
 * Given a world position, return information about the planet's surface
 * at that point.
 *
 * @param {THREE.Vector3} position - World position to evaluate
 * @returns {{normal: THREE.Vector3, surfacePosition: THREE.Vector3, height: number}}
 *   normal - the outward surface normal at the closest point on the planet
 *   surfacePosition - the closest point on the planet's surface
 *   height - height above the surface (positive) or penetration depth (negative)
 */
export function getSurfaceInfo(position) {
  const normal = position.clone().normalize();
  const surfacePosition = normal.clone().multiplyScalar(planetRadius);
  const height = position.length() - planetRadius;
  return { normal, surfacePosition, height };
}