import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const BALL_RADIUS = 0.22;

export class SoccerBall {
  constructor(scene, rapierWorld, rbToMesh) {
    this.scene = scene;
    this.rapierWorld = rapierWorld;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.lastTouchedTeam = null; // 'home' | 'away' | null
  }

  create(x = 0, y = 1, z = 0, sizeMultiplier = 1.0) {
    const ballRadius = BALL_RADIUS * sizeMultiplier;
    // Build a simple black-and-white soccer ball using canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#111111';
    // Pentagon-ish patches
    const patches = [
      [128, 128], [128, 60], [60, 100], [196, 100],
      [80, 180], [176, 180]
    ];
    for (const [px, py] of patches) {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const r = 28;
        const cx = px + Math.cos(a) * r;
        const cy = py + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);

    const geo = new THREE.SphereGeometry(ballRadius, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.set(x, y, z);
    this.scene.add(this.mesh);

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
      .setDensity(0.5);
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
  resolvePlayerContact(playerPos, playerVel, playerRadius, playerHalfHeight = 0, team = null) {
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

    if (team) this.lastTouchedTeam = team;

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
  }
}
