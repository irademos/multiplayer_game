import * as THREE from 'three';

// Store all water bodies for later lookup
const waterBodies = [];

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

export function isPointInWater(x, z) {
  for (const body of waterBodies) {
    if (body.type === 'lake') {
      const dx = x - body.position.x;
      const dz = z - body.position.z;
      if (Math.hypot(dx, dz) < body.radius) {
        return true;
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
        return true;
      }
    }
  }
  return false;
}

export { waterBodies };
