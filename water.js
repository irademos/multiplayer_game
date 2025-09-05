import * as THREE from 'three';

// Store all water bodies for later lookup
const waterBodies = [];

const MAX_LAKE_DEPTH = 1.5;
export const SWIM_DEPTH_THRESHOLD = 0.7;

export function getWaterDepth(x, z) {
  for (const body of waterBodies) {
    if (body.type === 'lake') {
      const dx = x - body.position.x;
      const dz = z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < body.radius) {
        return ((body.radius - dist) / body.radius) * MAX_LAKE_DEPTH;
      }
    } else if (body.type === 'river') {
      const halfW = body.size.width / 2;
      const halfL = body.size.length / 2;
      if (
        x >= body.position.x - halfW &&
        x <= body.position.x + halfW &&
        z >= body.position.z - halfL &&
        z <= body.position.z + halfL
      ) {
        return MAX_LAKE_DEPTH;
      }
    } else if (body.type === 'ocean') {
      const dx = x - body.position.x;
      const dz = z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > body.innerRadius && dist < body.outerRadius) {
        const depthRatio = (body.outerRadius - dist) / (body.outerRadius - body.innerRadius);
        return depthRatio * MAX_LAKE_DEPTH;
      }
    }
  }
  return 0;
}

export function generateLake(scene, position, radius) {
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.7 })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(position.x, position.y ?? 0, position.z);
  scene.add(lake);

  waterBodies.push({
    type: 'lake',
    position: { x: position.x, z: position.z },
    radius
  });

  return lake;
}

export function generateRiver(scene, position, size) {
  const { width, length } = size;
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.7 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(position.x, position.y ?? 0, position.z);
  scene.add(river);

  waterBodies.push({
    type: 'river',
    position: { x: position.x, z: position.z },
    size: { width, length }
  });

  return river;
}

export function generateOcean(scene, position, innerRadius, outerRadius) {
  const ocean = new THREE.Mesh(
    new THREE.RingGeometry(innerRadius, outerRadius, 64),
    new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(position.x, position.y ?? 0, position.z);
  scene.add(ocean);

  waterBodies.push({
    type: 'ocean',
    position: { x: position.x, z: position.z },
    innerRadius,
    outerRadius
  });

  return ocean;
}

export function isPointInWater(x, z) {
  return getWaterDepth(x, z) > 0;
}

export { waterBodies, MAX_LAKE_DEPTH };
