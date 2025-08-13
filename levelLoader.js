import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BreakManager } from './breakManager.js';

// LevelLoader loads a manifest describing assets and instances. It also
// registers destructible objects with BreakManager so they can be swapped at
// runtime when destroyed.
export class LevelLoader {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.assets = new Map();
    this.breakManager = options.breakManager || new BreakManager(scene);
  }

  async loadManifest(url) {
    const res = await fetch(url);
    const manifest = await res.json();
    await this._loadAssets(manifest.assets);
    this._createInstances(manifest.instances);
    return manifest;
  }

  async _loadAssets(assetMap) {
    const entries = Object.entries(assetMap || {});
    const promises = entries.map(async ([id, path]) => {
      const gltf = await this.loader.loadAsync(path);
      this.assets.set(id, gltf.scene);
    });
    await Promise.all(promises);
  }

  _createInstances(instances = []) {
    instances.forEach(inst => {
      const src = this.assets.get(inst.asset);
      if (!src) return;
      const obj = src.clone(true);

      obj.position.fromArray(inst.position || [0, 0, 0]);
      const r = inst.rotationEuler || [0, 0, 0];
      obj.rotation.set(r[0], r[1], r[2]);
      if (Array.isArray(inst.scale)) {
        obj.scale.fromArray(inst.scale);
      } else if (typeof inst.scale === 'number') {
        obj.scale.setScalar(inst.scale);
      }

      obj.userData.id = inst.id;
      obj.userData.tags = inst.tags || [];
      obj.userData.meta = inst.meta || {};

      this.scene.add(obj);

      if (inst.meta && inst.meta.fractureId) {
        const fractureScene = this.assets.get(inst.meta.fractureId);
        this.breakManager.register(obj, {
          id: inst.id,
          health: inst.meta.health,
          fractureScene
        });
      }
    });
  }

  // Convenience hook to forward hit events to the break manager
  onHit(id, damage, impulse) {
    this.breakManager.onHit(id, damage, impulse);
  }
}
