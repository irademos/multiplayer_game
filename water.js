import * as THREE from 'three';

// Store all water bodies for later lookup
const waterBodies = [];
const islandAreas = [];
const waterWaves = [];
let wavesScene = null;

export const SEA_FLOOR_Y = -2;
const MAX_LAKE_DEPTH = 1.5;
export const SWIM_DEPTH_THRESHOLD = 0.7;

function isPointOnIsland(x, z) {
  for (const island of islandAreas) {
    const dx = x - island.x;
    const dz = z - island.z;
    const dist = Math.hypot(dx, dz);
    if (dist < island.surfaceRadius) return true;
  }
  return false;
}

export function registerIsland(position, baseRadius, height) {
  const waterLevel = 0;
  const surfaceRadius = baseRadius * (1 - (waterLevel - SEA_FLOOR_Y) / height);
  islandAreas.push({ x: position.x, z: position.z, baseRadius, height, surfaceRadius });
}

export function getTerrainHeight(x, z) {
  let height = SEA_FLOOR_Y;
  for (const island of islandAreas) {
    const dx = x - island.x;
    const dz = z - island.z;
    const dist = Math.hypot(dx, dz);
    if (dist < island.baseRadius) {
      const h = SEA_FLOOR_Y + island.height * (1 - dist / island.baseRadius);
      if (h > height) height = h;
    }
  }
  return height;
}

export function getWaterDepth(x, z) {
  if (isPointOnIsland(x, z)) return 0;
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
      if (dist < body.outerRadius) {
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

// --- Wave system ---

export function initWaves(scene) {
  wavesScene = scene;
  // Remove old wave meshes if any
  for (const w of waterWaves) {
    if (w.mesh && wavesScene) wavesScene.remove(w.mesh);
  }
  waterWaves.length = 0;
}

export function spawnOceanWave({
  width = 3,
  speed = 6,
  strength = 3,
  color = 0xffffff,
  opacity = 0.5,
} = {}) {
  // Use the first ocean body (or all, but we’ll start with one)
  const ocean = waterBodies.find(b => b.type === 'ocean');
  if (!ocean || !wavesScene) return null;

  const center = new THREE.Vector3(ocean.position.x, 0, ocean.position.z);
  const radius = ocean.outerRadius - 0.5; // Start near outer edge

  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    emissive: color,
    emissiveIntensity: 0.2,
    side: THREE.DoubleSide,
  });
  const geom = new THREE.RingGeometry(Math.max(0.01, radius - width * 0.5), radius + width * 0.5, 128);
  const ring = new THREE.Mesh(geom, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(center.x, 0.01, center.z);
  ring.renderOrder = 2;
  wavesScene.add(ring);

  const wave = { type: 'ocean', center, radius, width, speed, strength, mesh: ring, innerRadius: ocean.innerRadius };
  waterWaves.push(wave);
  return wave;
}

// Create a directional "line" wave that travels along a vector.  The wave is a
// narrow rectangular bump of water represented by a custom plane geometry.  It
// pushes objects along its travel direction with a configurable strength.
export function pushWater(
  position,
  direction,
  {
    length = 5,
    width = 1,
    speed = 4,
    strength = 4,
    amplitude = 0.3,
    color = 0xffffff,
    opacity = 0.6,
  } = {}
) {
  if (!wavesScene) return null;
  const dir = direction.clone().normalize();
  const right = new THREE.Vector3(-dir.z, 0, dir.x); // perpendicular in XZ

  // Plane in the XZ plane with vertices lifted to form a gaussian hill across
  // its width.  The plane's X axis is the travel direction.
  const geom = new THREE.PlaneGeometry(length, width, 16, 4);
  geom.rotateX(-Math.PI / 2);
  const posAttr = geom.attributes.position;
  const sigma = width * 0.25;
  for (let i = 0; i < posAttr.count; i++) {
    const z = posAttr.getZ(i); // distance from center across the width
    const h = amplitude * Math.exp(-(z * z) / (2 * sigma * sigma));
    posAttr.setY(i, h);
  }
  posAttr.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    emissive: color,
    emissiveIntensity: 0.1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(position.x, 0.02, position.z);
  mesh.rotation.y = Math.atan2(dir.x, dir.z);
  mesh.renderOrder = 2;
  wavesScene.add(mesh);

  const wave = {
    type: 'directional',
    mesh,
    direction: dir,
    right,
    length,
    width,
    speed,
    strength,
  };
  waterWaves.push(wave);
  return wave;
}

export function updateWaves(dt) {
  for (let i = waterWaves.length - 1; i >= 0; i--) {
    const w = waterWaves[i];
    if (w.type === 'ocean') {
      w.radius -= w.speed * dt;
      if (w.mesh) {
        const inner = Math.max(0.01, w.radius - w.width * 0.5);
        const outer = Math.max(inner + 0.01, w.radius + w.width * 0.5);
        const newGeom = new THREE.RingGeometry(inner, outer, 128);
        w.mesh.geometry.dispose();
        w.mesh.geometry = newGeom;
      }
      if (w.radius <= w.innerRadius) {
        if (w.mesh && wavesScene) wavesScene.remove(w.mesh);
        waterWaves.splice(i, 1);
      }
    } else if (w.type === 'directional') {
      w.mesh.position.x += w.direction.x * w.speed * dt;
      w.mesh.position.z += w.direction.z * w.speed * dt;
      w.strength *= 0.98;
      if (w.mesh) {
        w.mesh.material.opacity *= 0.98;
      }
      if (w.strength < 0.1) {
        if (w.mesh && wavesScene) wavesScene.remove(w.mesh);
        waterWaves.splice(i, 1);
      }
    }
  }
}

export function getWaveForceAt(x, z) {
  const force = new THREE.Vector3(0, 0, 0);
  for (const w of waterWaves) {
    if (w.type === 'ocean') {
      const dx = x - w.center.x;
      const dz = z - w.center.z;
      const dist = Math.hypot(dx, dz);
      const half = w.width * 0.5;
      if (dist >= w.radius - half && dist <= w.radius + half) {
        const dirX = -dx / (dist || 1);
        const dirZ = -dz / (dist || 1);
        force.x += dirX * w.strength;
        force.z += dirZ * w.strength;
      }
    } else if (w.type === 'directional') {
      const dx = x - w.mesh.position.x;
      const dz = z - w.mesh.position.z;
      const forwardDist = dx * w.direction.x + dz * w.direction.z;
      const sideDist = dx * w.right.x + dz * w.right.z;
      if (
        forwardDist > -w.length * 0.5 &&
        forwardDist < w.length * 0.5 &&
        Math.abs(sideDist) < w.width * 0.5
      ) {
        const falloff = 1 - Math.abs(sideDist) / (w.width * 0.5);
        force.x += w.direction.x * w.strength * falloff;
        force.z += w.direction.z * w.strength * falloff;
      }
    }
  }
  return force;
}

export { waterBodies, MAX_LAKE_DEPTH };
