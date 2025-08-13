import * as THREE from 'three';
import * as CANNON from './miniCannon.js';
const FIXED_TIME_STEP = 1 / 60;


// BreakManager handles swapping intact meshes with fractured versions
// and tracking health of destructible objects. Chunk pieces are simulated
// with a tiny built-in physics world so they can react
// semi-realistically after destruction.
export class BreakManager {
  constructor(scene) {
    this.scene = scene;
    this.registry = new Map(); // id -> { object, health, fractureScene }
    this.activeChunks = [];
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0)
    });

  }

  // Register a destructible object. `data` expects:
  // { id, health, fractureScene }
  register(object, data) {
    const id = data.id;
    this.registry.set(id, {
      object,
      health: data.health ?? 100,
      fractureScene: data.fractureScene
    });
  }

  // Apply damage to an object. Once health <= 0 the object is replaced with its chunks.
  async onHit(id, damage = 10, impulse = new THREE.Vector3()) {
    const entry = this.registry.get(id);
    if (!entry) return;
    entry.health -= damage;
    console.log(`🛢️ ${id} health: ${entry.health}`);
    if (entry.health > 0) return;

    const { object, fractureScene } = entry;
    this.registry.delete(id);
    if (!fractureScene) return;

    // Remove the intact mesh
    if (object.parent) {
      object.parent.remove(object);
    }

    // Clone chunk scene and convert meshes into independent physics bodies
    const chunksGroup = fractureScene.clone(true);
    chunksGroup.position.copy(object.position);
    chunksGroup.rotation.copy(object.rotation);
    chunksGroup.scale.copy(object.scale);
    this.scene.add(chunksGroup);
    chunksGroup.updateMatrixWorld(true);

    const chunkMeshes = [];
    chunksGroup.traverse(child => {
      if (child.isMesh) {
        chunkMeshes.push(child);
      }

    // Clone chunk scene and add to world. A physics engine could be integrated
    // here by iterating over children and creating rigid bodies.
    const chunks = fractureScene.clone(true);
    chunks.position.copy(object.position);
    chunks.rotation.copy(object.rotation);
    chunks.scale.copy(object.scale);
    this.scene.add(chunks);

    chunks.traverse(child => {
      if (!child.isMesh) return;
      child.userData.velocity = impulse.clone();
      this.activeChunks.push(child);
    });

    for (const mesh of chunkMeshes) {
      // Detach mesh to the scene root so physics can control it
      this.scene.attach(mesh);

      // Build a simple box body using the mesh's bounding box
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());
      const half = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
      const shape = new CANNON.Box(half);
      const body = new CANNON.Body({ mass: 1, shape });
      body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      body.quaternion.set(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w
      );
      body.applyImpulse(
        new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
        new CANNON.Vec3(0, 0, 0)
      );
      this.world.addBody(body);
      this.activeChunks.push({ mesh, body });
    }

    // Remove the now-empty container group
    this.scene.remove(chunksGroup);
  }

  update() {
    this.world.step(FIXED_TIME_STEP);

    for (const { mesh, body } of this.activeChunks) {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w
      );
    }
  }

  update() {
    const gravity = -0.0008;
    for (let i = this.activeChunks.length - 1; i >= 0; i--) {
      const chunk = this.activeChunks[i];
      const vel = chunk.userData.velocity || new THREE.Vector3();
      vel.y += gravity;
      chunk.position.add(vel);
      if (chunk.position.y <= 0) {
        chunk.position.y = 0;
        vel.y = 0;
      }
    }
  }
}
