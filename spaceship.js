import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
    this.locked = false;
    this.halfHeight = 0;
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('/assets/props/mother_spaceship.glb');
    const ship = gltf.scene;
    const scale = 0.7;
    ship.scale.set(scale, scale, scale);
    ship.position.set(1, 5, 20);

    // Add mesh and update transforms
    this.mesh = ship;
    this.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    // Compute world-space AABB
    const bbox = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    // Store size and center offset for camera calculations
    this.boundingSize = size.clone();
    this.boundingCenterOffset = new THREE.Vector3().subVectors(center, ship.position);

    // Create physics body centered on mesh
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(ship.position.x, ship.position.y, ship.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5)
      .setGravityScale(1.0);
    this.body = this.world.createRigidBody(rbDesc);

    // Build a triangle-mesh collider from the spaceship geometry so the
    // collider matches the visible model and leaves the doorway open.
    const vertices = [];
    const indices = [];
    let indexOffset = 0;
    const v = new THREE.Vector3();

    ship.updateMatrixWorld(true);
    ship.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const pos = child.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(child.matrixWorld);
        v.sub(center);
        vertices.push(v.x, v.y, v.z);
      }

      const geomIndex = child.geometry.index;
      if (geomIndex) {
        for (let i = 0; i < geomIndex.count; i++) {
          indices.push(geomIndex.array[i] + indexOffset);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indices.push(i + indexOffset);
        }
      }
      indexOffset += pos.count;
    });

    const offset = new THREE.Vector3().subVectors(center, ship.position);
    const colDesc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    )
      .setTranslation(offset.x, offset.y, offset.z)
      .setRestitution(0)
      .setFriction(1);
    this.world.createCollider(colDesc, this.body);

    // Register with global rigid-body map so physics sync updates the mesh
    this.rbToMesh?.set(this.body, this.mesh);

    // Mount point on top of the box
    this.mountOffset.set(0, size.y * 0.5 - 2, 0);
    this.halfHeight = size.y * 0.5;
  }

  update() {
    if (this.occupant) {
      const top = this.mesh.position.clone().add(this.mountOffset);
      const player = this.occupant.playerModel;
      player.position.copy(top);
      if (this.occupant.body) {
        this.occupant.body.setTranslation(top, true);
        this.occupant.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (this.body) {
      const vel = this.body.linvel();
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      const onGround = this.body.translation().y - this.halfHeight <= 0.05;
      if (onGround && speed < 0.1) {
        if (!this.locked) {
          this.locked = true;
          this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          this.body.sleep();
        }
      } else if (this.locked && speed > 0.1) {
        this.locked = false;
        this.body.wakeUp();
      }
    }
  }

  tryMount(playerControls) {
    if (this.occupant || !playerControls?.playerModel || !this.mesh) return;
    const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (dist < 10) {
      this.occupant = playerControls;
      playerControls.vehicle = this;
    }
  }

  applyInput(input) {
    if (!this.body || !this.mesh) return;
    const rotationSpeed = 0.01;

    // Handle rotation first
    if (input.yaw !== 0 || input.pitch !== 0) {
      const euler = new THREE.Euler(input.pitch * rotationSpeed, 0, -input.yaw * rotationSpeed, 'XYZ');
      const q = new THREE.Quaternion().setFromEuler(euler);
      const currentRot = this.body.rotation();
      const current = new THREE.Quaternion(currentRot.x, currentRot.y, currentRot.z, currentRot.w);
      current.multiply(q);
      this.body.setRotation(current, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Apply forward thrust along the ship's current forward direction.
    // The rigid body representing the ship is extremely heavy because its
    // mass is derived from the large triangle-mesh collider.  Using a small
    // constant impulse therefore has almost no visible effect.  Scale the
    // impulse by the body's mass and timestep so activating thrust produces a
    // noticeable forward acceleration regardless of the ship's weight.
    if (input.thrust) {
      if (this.locked) {
        this.locked = false;
        this.body.wakeUp();
      }

      // Determine the ship's forward direction in world space.
      const forward = new THREE.Vector3(0, 0, 1);
      const rot = this.body.rotation();
      forward.applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));

      // Compute an impulse that results in a reasonable acceleration.  Use the
      // physics timestep if available (defaulting to 60 Hz) so the result is
      // frame-rate independent.
      const dt = this.world?.integrationParameters?.dt ?? 1 / 60;
      const acceleration = 10; // units per second squared
      const impulseMagnitude = 10 * this.body.mass() * acceleration * dt;

      this.body.applyImpulse(
        {
          x: forward.x * impulseMagnitude,
          y: forward.y * impulseMagnitude,
          z: forward.z * impulseMagnitude,
        },
        true
      );
    }
  }

  dismount() {
    if (!this.occupant) return;
    const playerControls = this.occupant;
    // const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    // const dismountPos = this.mesh.position.clone().add(forward.multiplyScalar(-3)).add(this.mountOffset);
    // if (playerControls.playerModel) {
    //   playerControls.playerModel.position.copy(dismountPos);
    // }
    // if (playerControls.body) {
    //   playerControls.body.setTranslation(dismountPos, true);
    //   playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // }
    playerControls.vehicle = null;
    this.occupant = null;
  }
}
