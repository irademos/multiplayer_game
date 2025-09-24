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

function distortCylinderGeometry(geometry, { radialNoise = 0, heightNoise = 0.2, keepBottomFlat = true } = {}) {
  const { height = 1 } = geometry.parameters ?? {};
  const position = geometry.attributes.position;
  const randomPhaseA = Math.random() * Math.PI * 2;
  const randomPhaseB = Math.random() * Math.PI * 2;
  const radialScale = radialNoise !== 0 ? 1 : 0;
  const tmp = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    tmp.fromBufferAttribute(position, i);

    const originalY = tmp.y;
    const normalizedHeight = (originalY + height / 2) / height;
    const angle = Math.atan2(tmp.z, tmp.x);
    const radius = Math.sqrt(tmp.x * tmp.x + tmp.z * tmp.z);

    if (radius > 0 && radialScale) {
      const undulation =
        Math.sin(angle * 2 + randomPhaseA) * 0.5 +
        Math.cos(angle * 3 + randomPhaseB) * 0.5;
      const jitter = (Math.random() - 0.5) * 0.6;
      const totalOffset = (undulation + jitter) * radialNoise * (0.4 + normalizedHeight * 0.6);
      const newRadius = Math.max(0.001, radius + totalOffset);
      tmp.x = Math.cos(angle) * newRadius;
      tmp.z = Math.sin(angle) * newRadius;
    }

    if (!(keepBottomFlat && normalizedHeight < 0.1)) {
      const verticalOffset = (Math.random() - 0.5) * heightNoise * (0.3 + normalizedHeight * 0.7);
      tmp.y = originalY + verticalOffset;
    } else {
      tmp.y = -height / 2;
    }

    position.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createChunkyIsland({
  baseRadius,
  height,
  sandWidth = 4,
  center,
}) {
  const islandGroup = new THREE.Group();
  islandGroup.position.set(center.x, SEA_FLOOR_Y, center.z);

  const segments = 6 + Math.floor(Math.random() * 6);

  const rockGeometry = new THREE.CylinderGeometry(
    baseRadius * 1.15,
    baseRadius * 0.85,
    height,
    segments,
    1,
    false
  );
  distortCylinderGeometry(rockGeometry, {
    radialNoise: baseRadius * 0.25,
    heightNoise: height * 0.3,
  });
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b4f3f,
    flatShading: true,
    roughness: 0.95,
    metalness: 0.05,
  });
  const rockMesh = new THREE.Mesh(rockGeometry, rockMaterial);
  rockMesh.position.y = height / 2;
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  islandGroup.add(rockMesh);

  const sandHeight = Math.max(0.6, height * 0.25);
  const sandGeometry = new THREE.CylinderGeometry(
    baseRadius + sandWidth,
    baseRadius + sandWidth * 0.5,
    sandHeight,
    segments,
    1,
    false
  );
  distortCylinderGeometry(sandGeometry, {
    radialNoise: sandWidth * 0.6,
    heightNoise: sandHeight * 0.2,
  });
  const sandMaterial = new THREE.MeshStandardMaterial({
    color: 0xdbc174,
    flatShading: true,
    roughness: 0.85,
  });
  const sandMesh = new THREE.Mesh(sandGeometry, sandMaterial);
  sandMesh.position.y = sandHeight / 2;
  sandMesh.receiveShadow = true;
  islandGroup.add(sandMesh);

  const grassHeight = Math.max(1.4, height * 0.35);
  const grassGeometry = new THREE.CylinderGeometry(
    baseRadius * 0.75,
    baseRadius,
    grassHeight,
    segments,
    1,
    false
  );
  distortCylinderGeometry(grassGeometry, {
    radialNoise: baseRadius * 0.2,
    heightNoise: grassHeight * 0.25,
  });
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d8a34,
    flatShading: true,
    roughness: 0.9,
  });
  const grassMesh = new THREE.Mesh(grassGeometry, grassMaterial);
  grassMesh.position.y = height - grassHeight / 2;
  grassMesh.castShadow = true;
  grassMesh.receiveShadow = true;
  islandGroup.add(grassMesh);

  const hillCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < hillCount; i++) {
    const hillRadius = baseRadius * (0.15 + Math.random() * 0.15);
    const hillHeight = grassHeight * (0.5 + Math.random() * 0.6);
    const hillGeometry = new THREE.ConeGeometry(hillRadius, hillHeight, 6 + Math.floor(Math.random() * 4));
    const hillMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a9b3c,
      flatShading: true,
      roughness: 0.85,
    });
    const hillMesh = new THREE.Mesh(hillGeometry, hillMaterial);
    const angle = Math.random() * Math.PI * 2;
    const radialOffset = baseRadius * 0.35 * Math.random();
    hillMesh.position.set(
      Math.cos(angle) * radialOffset,
      height + hillHeight / 2,
      Math.sin(angle) * radialOffset
    );
    hillMesh.castShadow = true;
    hillMesh.receiveShadow = true;
    islandGroup.add(hillMesh);
  }

  return islandGroup;
}

export function generateIsland(scene, { islandRadius = 20, outerRadius = 100 } = {}) {
  const seaFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(outerRadius * 2, outerRadius * 2),
    new THREE.MeshStandardMaterial({ color: 0x00008b })
  );
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = SEA_FLOOR_Y;
  seaFloor.receiveShadow = true;
  scene.add(seaFloor);

  const mainRadius = islandRadius * (0.9 + Math.random() * 0.4);
  const mainHeight = 8 + Math.random() * 4;
  const mainSandWidth = 4 + Math.random() * 3;

  const mainIsland = createChunkyIsland({
    baseRadius: mainRadius,
    height: mainHeight,
    sandWidth: mainSandWidth,
    center: { x: 0, z: 0 },
  });
  scene.add(mainIsland);
  registerIsland({ x: 0, z: 0 }, mainRadius + mainSandWidth, mainHeight);

  generateOcean(scene, { x: 0, z: 0 }, 0, outerRadius);

  const smallIslandCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < smallIslandCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = islandRadius + 18 + Math.random() * (outerRadius - islandRadius - 26);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const baseRadius = 4 + Math.random() * 4;
    const height = 3.5 + Math.random() * 2.5;
    const sandWidth = 1 + Math.random() * 1.5;

    const island = createChunkyIsland({
      baseRadius,
      height,
      sandWidth,
      center: { x, z },
    });
    scene.add(island);
    registerIsland({ x, z }, baseRadius + sandWidth, height);
  }
}

export const baseHeightFunction = (x, z) => {
  return Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
};