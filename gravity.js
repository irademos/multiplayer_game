import * as THREE from "three";
import { MOON_RADIUS } from "./worldGeneration.js";

export const MOON_GRAVITY = 9.81;

export function applyGlobalGravity(world, moon) {
  if (!world || !moon) return;
  const moonPos = moon.position;
  world.bodies.forEach((body) => {
    if (!body.isDynamic()) return;
    // Remember each body's default gravity scale so we can restore it.
    if (!body.userData) body.userData = {};
    if (body.userData.defaultGravityScale === undefined) {
      body.userData.defaultGravityScale = body.gravityScale();
    }
    const t = body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const distance = pos.distanceTo(moonPos);
    if (distance < MOON_RADIUS * 2) {
      body.setGravityScale(0, true);
      const dir = new THREE.Vector3().subVectors(moonPos, pos).normalize();
      const forceMag = body.mass() * MOON_GRAVITY;
      body.addForce({ x: dir.x * forceMag, y: dir.y * forceMag, z: dir.z * forceMag }, true);
    } else {
      body.setGravityScale(body.userData.defaultGravityScale, true);
    }
  });
}
