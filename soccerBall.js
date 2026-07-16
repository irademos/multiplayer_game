import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

const BALL_RADIUS = 0.28;
const _ballLoader = new GLTFLoader();

export class SoccerBall {
  constructor(scene, rapierWorld, rbToMesh) {
    this.scene = scene;
    this.rapierWorld = rapierWorld;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.lastTouchedTeam = null; // 'home' | 'away' | null
    this.lastTouchedName = null;
    this.lastTouchedByTeam = { home: null, away: null }; // last name per team
  }

  create(x = 0, y = 1, z = 0, sizeMultiplier = 1.0) {
    const ballRadius = BALL_RADIUS * sizeMultiplier;

    // Placeholder invisible mesh so physics can attach immediately;
    // replaced by the GLB model once loaded.
    this.mesh = new THREE.Object3D();
    this.mesh.position.set(x, y, z);
    this.scene.add(this.mesh);

    _ballLoader.load('/assets/props/soccer_ball.glb', (gltf) => {
      const model = gltf.scene;
      // Scale first so the bounding box reflects final size
      const box0 = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box0.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = (ballRadius * 2) / maxDim;
      model.scale.setScalar(scale);
      // Re-center: offset the model so its geometric center sits at (0,0,0),
      // which is the physics body origin. This fixes the orbital-rotation bug
      // and prevents the ball from floating above its collider.
      const box1 = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3();
      box1.getCenter(center);
      model.position.sub(center);
      model.traverse(child => { if (child.isMesh) child.castShadow = true; });
      this.mesh.add(model);
    });

    this.ballRadius = ballRadius;

    // Dynamic physics body
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.4)
      .setAngularDamping(0.6)
      .setCcdEnabled(true);
    this.body = this.rapierWorld.createRigidBody(rbDesc);

    const colDesc = RAPIER.ColliderDesc.ball(ballRadius)
      .setRestitution(0.7)
      .setFriction(0.4)
      .setDensity(0.3);
    this.rapierWorld.createCollider(colDesc, this.body);

    if (this.rbToMesh) {
      this.rbToMesh.set(this.body, this.mesh);
    }

    window.soccerBall = this;
  }

  update() {
    if (!this.body || !this.mesh) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  applyImpulse(impulse) {
    if (!this.body) return;
    this.body.applyImpulse(impulse, true);
  }

  // Make sure any player overlapping the ball always pushes/redirects it,
  // even if the physics solver alone lets a fast-moving player rest on top
  // of it or pass through it without imparting velocity.
  // team: 'home' | 'away' | null — records who last touched the ball.
  resolvePlayerContact(playerPos, playerVel, playerRadius, playerHalfHeight = 0, team = null, playerName = null) {
    if (!this.body) return;
    const t = this.body.translation();
    // Players are capsules, not points: find the closest point on the
    // capsule's vertical segment to the ball so a grounded ball is
    // correctly detected as touching the player's body/legs instead of
    // being compared against the (much higher) capsule center.
    const closestY = Math.max(
      playerPos.y - playerHalfHeight,
      Math.min(playerPos.y + playerHalfHeight, t.y)
    );
    const dx = t.x - playerPos.x;
    const dy = t.y - closestY;
    const dz = t.z - playerPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const minDist = (this.ballRadius ?? BALL_RADIUS) + playerRadius;
    const dist = Math.sqrt(distSq);
    if (dist >= minDist || dist < 1e-4) return;

    if (team) {
      this.lastTouchedTeam = team;
      this.lastTouchedName = playerName;
      this.lastTouchedByTeam[team] = playerName;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Push the ball out of overlap and carry the player's velocity into it.
    const overlap = minDist - dist;
    const ballVel = this.body.linvel();
    const push = overlap * 6;
    const carry = 0.6;
    this.body.setLinvel({
      x: ballVel.x + nx * push + playerVel.x * carry,
      y: ballVel.y + Math.max(ny, 0) * push + playerVel.y * carry,
      z: ballVel.z + nz * push + playerVel.z * carry,
    }, true);
  }

  getPosition() {
    if (!this.body) return null;
    return this.body.translation();
  }

  reset() {
    if (!this.body) return;
    this.body.setTranslation({ x: 0, y: 1, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastTouchedTeam = null;
    this.lastTouchedName = null;
    this.lastTouchedByTeam = { home: null, away: null };
  }
}
