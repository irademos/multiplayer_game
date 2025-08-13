import * as THREE from 'three';

// BreakManager handles swapping intact meshes with fractured versions
// and tracking health of destructible objects. Physics integration is left
// to the consumer; this class simply swaps meshes and exposes a hook for
// applying impulses.
export class BreakManager {
  constructor(scene) {
    this.scene = scene;
    this.registry = new Map(); // id -> { object, health, fractureScene }
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
    if (entry.health > 0) return;

    const { object, fractureScene } = entry;
    this.registry.delete(id);
    if (!fractureScene) return;

    // Remove the intact mesh
    if (object.parent) {
      object.parent.remove(object);
    }

    // Clone chunk scene and add to world. A physics engine could be integrated
    // here by iterating over children and creating rigid bodies.
    const chunks = fractureScene.clone(true);
    chunks.position.copy(object.position);
    chunks.rotation.copy(object.rotation);
    chunks.scale.copy(object.scale);
    this.scene.add(chunks);

    // Placeholder for applying impulse to chunks. Real physics should replace this.
    chunks.children.forEach(child => {
      child.userData.velocity = impulse.clone();
    });
  }
}
