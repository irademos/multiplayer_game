import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";

export class Spaceship {
  constructor(scene, world, rbToMesh) {
    this.scene = scene;
    this.world = world;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.occupant = null; // PlayerControls instance
    this.mountOffset = new THREE.Vector3(0, 1, 0);
  }

  async load() {
    const loader = new FBXLoader();
    const fbx = await new Promise((resolve, reject) => {
      loader.load('/assets/props/spaceship.fbx', resolve, undefined, reject);
    });
    const ship = fbx.children.find(c => c.name === 'drt');
    const scale = 0.1;
    if (ship) {
      ship.scale.set(scale, scale, scale);
      ship.position.set(0, 3, 5);
      // 1) Add mesh and update transforms
      this.mesh = ship;                  // avoid clone unless you need it
      this.scene.add(this.mesh);
      this.mesh.updateMatrixWorld(true);

      // 2) Compute world-space AABB
      const bbox   = new THREE.Box3().setFromObject(this.mesh);
      const size   = new THREE.Vector3();
      const center = new THREE.Vector3();
      bbox.getSize(size);
      bbox.getCenter(center);

      // 3B) Option B: keep the body at ship.position, but offset the collider to the box center
      
      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(ship.position.x, ship.position.y, ship.position.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5);
      this.body = this.world.createRigidBody(rbDesc);

      const offset = new THREE.Vector3().subVectors(center, ship.position);
      const colDesc = RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
        .setTranslation(offset.x, offset.y, offset.z);
      this.world.createCollider(colDesc, this.body);      
        
      // Optional: mount point on top of the box
      this.mountOffset.set(0, size.y * 0.5, 0);

    }
  }

  update(playerControls) {
    if (this.occupant) {
      const top = this.mesh.position.clone().add(this.mountOffset);
      const player = this.occupant.playerModel;
      player.position.copy(top);
      if (this.occupant.body) {
        this.occupant.body.setTranslation(top, true);
        this.occupant.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else if (playerControls && playerControls.playerModel && this.mesh) {
      const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
      if (dist < 2) {
        this.occupant = playerControls;
        playerControls.vehicle = this;
      }
    }
  }

  applyInput(dir) {
    if (!this.body) return;
    const vel = this.body.linvel();
    this.body.setLinvel({ x: dir.x * 5, y: vel.y, z: dir.z * 5 }, true);
  }

  dismount() {
    if (!this.occupant) return;
    this.occupant.vehicle = null;
    this.occupant = null;
  }
}
