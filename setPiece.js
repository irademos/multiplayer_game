import * as THREE from 'three';

const FIELD_HALF_X = 30;
const FIELD_HALF_Z = 50;
const FIELD_IN_PLAY_BUFFER = 1.0;
const FIELD_OUT_OF_BOUNDS_BUFFER = 1.0;

function isCircleZone(zone) {
  return zone?.shape === 'circle';
}

function isInsideZone(x, z, zone) {
  if (isCircleZone(zone)) {
    const dx = x - zone.x;
    const dz = z - zone.z;
    return dx * dx + dz * dz <= zone.radius * zone.radius;
  }
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
}

function isWellInsideField(x, z) {
  return Math.abs(x) < FIELD_HALF_X - FIELD_IN_PLAY_BUFFER &&
         Math.abs(z) < FIELD_HALF_Z - FIELD_IN_PLAY_BUFFER;
}

function isWellOutOfField(x, z) {
  return Math.abs(x) > FIELD_HALF_X + FIELD_OUT_OF_BOUNDS_BUFFER ||
         Math.abs(z) > FIELD_HALF_Z + FIELD_OUT_OF_BOUNDS_BUFFER;
}

const SET_PIECE_LABELS = {
  throwIn: 'THROW-IN',
  cornerKick: 'CORNER KICK',
  goalKick: 'GOAL KICK',
};

export class SetPieceManager {
  constructor(scene) {
    this.scene = scene;
    this.active = null;
    this._zoneMeshes = [];
    this._labelEl = null;
    this._createLabel();
  }

  isActive() {
    return this.active !== null;
  }

  // zone: { minX, maxX, minZ, maxZ }
  // exclusionZone: { minX, maxX, minZ, maxZ } – opposing team must stay outside this
  // ballFixedPos: { x, y, z }
  // teamTaking: 'home' | 'away'
  // takerNetworkId: network ID of the designated taker (player or AI)
  trigger(type, teamTaking, ballFixedPos, zone, takerNetworkId, exclusionZone) {
    this.clear();

    this._buildZoneVisual(zone);
    if (exclusionZone) this._buildExclusionZoneVisual(exclusionZone);
    this._showLabel(type, teamTaking);

    this.active = {
      type,
      teamTaking,
      ballFixedPos: { ...ballFixedPos },
      zone: { ...zone },
      exclusionZone: exclusionZone ? { ...exclusionZone } : null,
      takerNetworkId: takerNetworkId ?? null,
      ballLocked: true,
      startTime: performance.now(),
    };
  }

  // Call each frame while a set piece is active.
  // setPieceBody:   Rapier body of the designated taker (constrained inside zone)
  // otherBodies:    Array of all other Rapier bodies (pushed out of taker zone)
  // opposingBodies: Array of opposing team Rapier bodies (pushed out of exclusion zone)
  // soccerBall:     SoccerBall instance
  // Returns true if the set piece just ended.
  update(soccerBall, setPieceBody, otherBodies = [], opposingBodies = []) {
    if (!this.active) return false;
    const a = this.active;

    const MIN_HOLD_MS = 1000; // always show the zone for at least 1 second

    if (a.ballLocked) {
      // Hold ball in place
      soccerBall.body.setTranslation(a.ballFixedPos, true);
      soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Only start checking proximity after the minimum hold time
      const elapsed = performance.now() - a.startTime;
      if (elapsed >= MIN_HOLD_MS && setPieceBody) {
        const sp = setPieceBody.translation();
        const dx = sp.x - a.ballFixedPos.x;
        const dz = sp.z - a.ballFixedPos.z;
        // Release lock once set piece player is close enough to the ball
        if (Math.sqrt(dx * dx + dz * dz) < 2.0) {
          a.ballLocked = false;

          // Goal kick zone disappears the moment the player can touch the ball
          if (a.type === 'goalKick') {
            this.clear();
            return true;
          }
        }
      }
    } else {
      // Check end conditions after lock released
      const bp = soccerBall.getPosition();
      if (bp) {
        const inField = isWellInsideField(bp.x, bp.z);
        const inZone = isInsideZone(bp.x, bp.z, a.zone);
        const wellOutOfField = isWellOutOfField(bp.x, bp.z);

        if (!inZone && wellOutOfField) {
          soccerBall.body.setTranslation(a.ballFixedPos, true);
          soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          a.ballLocked = true;
          a.startTime = performance.now();
        } else if (inField) {
          this.clear();
          return true;
        }
      }
    }

    // Push every non-taker body out of taker zone
    for (const body of otherBodies) {
      if (body) this._pushOutOfZone(body, a.zone);
    }

    // Push non-taker bodies (both teams' bots + opposing human) out of the larger exclusion zone
    if (a.exclusionZone) {
      for (const body of opposingBodies) {
        if (body) this._pushOutOfZone(body, a.exclusionZone);
      }
    }

    // Constrain set piece player within zone
    if (setPieceBody) {
      this._constrainToZone(setPieceBody, a.zone);
    }

    return false;
  }

  clear() {
    for (const m of this._zoneMeshes) {
      this.scene.remove(m);
      m.geometry?.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach(mat => mat.dispose());
      } else {
        m.material?.dispose();
      }
    }
    this._zoneMeshes = [];
    this._hideLabel();
    this.active = null;
  }

  // ─── private ──────────────────────────────────────────────────────────────

  _buildZoneVisual(zone) {
    if (isCircleZone(zone)) {
      this._buildCircleZoneVisual(zone, 0xffff00, 0.18, 0.02);
      return;
    }
    const { minX, maxX, minZ, maxZ } = zone;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const y = 0.02; // just above the ground (ground collider top is Y=0)
    const boxH = 2.5;

    // Translucent floor
    const floorGeo = new THREE.PlaneGeometry(w, d);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, y, cz);
    this.scene.add(floor);
    this._zoneMeshes.push(floor);

    // Wireframe walls
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, boxH, d));
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    edges.position.set(cx, y + boxH / 2, cz);
    this.scene.add(edges);
    this._zoneMeshes.push(edges);
  }

  _buildExclusionZoneVisual(zone) {
    if (isCircleZone(zone)) {
      this._buildCircleZoneVisual(zone, 0xff2200, 0.12, 0.015);
      return;
    }
    const { minX, maxX, minZ, maxZ } = zone;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const y = 0.015;
    const boxH = 2.5;

    // Translucent red floor
    const floorGeo = new THREE.PlaneGeometry(w, d);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, y, cz);
    this.scene.add(floor);
    this._zoneMeshes.push(floor);

    // Red wireframe walls
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, boxH, d));
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xff2200 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    edges.position.set(cx, y + boxH / 2, cz);
    this.scene.add(edges);
    this._zoneMeshes.push(edges);
  }


  _buildCircleZoneVisual(zone, color, opacity, y) {
    const floorGeo = new THREE.CircleGeometry(zone.radius, 48);
    const floorMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(zone.x, y, zone.z);
    this.scene.add(floor);
    this._zoneMeshes.push(floor);

    const ringGeo = new THREE.RingGeometry(zone.radius - 0.05, zone.radius + 0.05, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(zone.x, y + 0.01, zone.z);
    this.scene.add(ring);
    this._zoneMeshes.push(ring);

  }

  _createLabel() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'top:80px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.7)',
      'color:#ffe600',
      'font-size:22px',
      'font-weight:bold',
      'padding:8px 24px',
      'border-radius:8px',
      'z-index:300',
      'font-family:sans-serif',
      'pointer-events:none',
      'display:none',
      'letter-spacing:2px',
    ].join(';');
    document.body.appendChild(el);
    this._labelEl = el;
  }

  _showLabel(type, teamTaking) {
    if (!this._labelEl) return;
    const teamStr = teamTaking === 'home' ? 'HOME' : 'AWAY';
    this._labelEl.textContent = `${SET_PIECE_LABELS[type] ?? type} — ${teamStr}`;
    this._labelEl.style.display = 'block';
  }

  _hideLabel() {
    if (this._labelEl) this._labelEl.style.display = 'none';
  }

  _constrainToZone(body, zone) {
    if (isCircleZone(zone)) {
      this._constrainToCircleZone(body, zone);
      return;
    }
    const t = body.translation();
    let nx = t.x;
    let nz = t.z;
    const v = body.linvel();
    let vx = v.x;
    let vz = v.z;
    let changed = false;

    if (t.x < zone.minX) { nx = zone.minX; vx = Math.max(0, vx); changed = true; }
    if (t.x > zone.maxX) { nx = zone.maxX; vx = Math.min(0, vx); changed = true; }
    if (t.z < zone.minZ) { nz = zone.minZ; vz = Math.max(0, vz); changed = true; }
    if (t.z > zone.maxZ) { nz = zone.maxZ; vz = Math.min(0, vz); changed = true; }

    if (changed) {
      body.setTranslation({ x: nx, y: t.y, z: nz }, true);
      body.setLinvel({ x: vx, y: v.y, z: vz }, true);
    }
  }


  _constrainToCircleZone(body, zone) {
    const t = body.translation();
    const dx = t.x - zone.x;
    const dz = t.z - zone.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= zone.radius) return;

    const nx = dist > 0.001 ? dx / dist : 1;
    const nz = dist > 0.001 ? dz / dist : 0;
    const v = body.linvel();
    const outwardVel = v.x * nx + v.z * nz;
    body.setTranslation({
      x: zone.x + nx * zone.radius,
      y: t.y,
      z: zone.z + nz * zone.radius,
    }, true);
    if (outwardVel > 0) {
      body.setLinvel({
        x: v.x - outwardVel * nx,
        y: v.y,
        z: v.z - outwardVel * nz,
      }, true);
    }
  }

  // Immediately eject all bodies from their respective zones (call once on set piece creation).
  ejectBodiesNow(otherBodies = [], opposingBodies = []) {
    if (!this.active) return;
    const a = this.active;
    for (const body of otherBodies) {
      if (body) this._pushOutOfZone(body, a.zone);
    }
    if (a.exclusionZone) {
      for (const body of opposingBodies) {
        if (body) this._pushOutOfZone(body, a.exclusionZone);
      }
    }
  }

  _pushOutOfZone(body, zone) {
    if (isCircleZone(zone)) {
      this._pushOutOfCircleZone(body, zone);
      return;
    }
    const t = body.translation();
    const pad = 0.5;
    const margin = 0.1;
    const expanded = {
      minX: zone.minX - pad,
      maxX: zone.maxX + pad,
      minZ: zone.minZ - pad,
      maxZ: zone.maxZ + pad,
    };

    if (
      t.x < expanded.minX || t.x > expanded.maxX ||
      t.z < expanded.minZ || t.z > expanded.maxZ
    ) return; // already outside

    // Candidate escape positions ordered by distance to nearest face.
    // We prefer faces whose exit position lands inside the field.
    const dLeft  = t.x - expanded.minX;
    const dRight = expanded.maxX - t.x;
    const dFront = t.z - expanded.minZ;
    const dBack  = expanded.maxZ - t.z;

    const candidates = [
      { d: dLeft,  nx: expanded.minX - margin, nz: t.z,               vMask: { x: 0, z: null } },
      { d: dRight, nx: expanded.maxX + margin, nz: t.z,               vMask: { x: 0, z: null } },
      { d: dFront, nx: t.x,                   nz: expanded.minZ - margin, vMask: { x: null, z: 0 } },
      { d: dBack,  nx: t.x,                   nz: expanded.maxZ + margin, vMask: { x: null, z: 0 } },
    ].sort((a, b) => a.d - b.d);

    const inField = (x, z) =>
      Math.abs(x) < FIELD_HALF_X - margin && Math.abs(z) < FIELD_HALF_Z - margin;

    // Pick the nearest face that keeps the player on the field; fall back to
    // nearest face overall (clamped to field bounds) if none is fully in-bounds.
    let chosen = candidates.find(c => inField(c.nx, c.nz)) ?? candidates[0];

    // Clamp to field so the player is never ejected out of bounds.
    const safeX = Math.max(-(FIELD_HALF_X - margin), Math.min(FIELD_HALF_X - margin, chosen.nx));
    const safeZ = Math.max(-(FIELD_HALF_Z - margin), Math.min(FIELD_HALF_Z - margin, chosen.nz));

    body.setTranslation({ x: safeX, y: t.y, z: safeZ }, true);
    const v = body.linvel();
    body.setLinvel({
      x: chosen.vMask.x === 0 ? 0 : v.x,
      y: v.y,
      z: chosen.vMask.z === 0 ? 0 : v.z,
    }, true);
  }

  _pushOutOfCircleZone(body, zone) {
    const t = body.translation();
    const pad = 0.5;
    const margin = 0.1;
    const radius = zone.radius + pad;
    const dx = t.x - zone.x;
    const dz = t.z - zone.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > radius) return;

    let nx = dist > 0.001 ? dx / dist : 1;
    let nz = dist > 0.001 ? dz / dist : 0;
    let safeX = zone.x + nx * (radius + margin);
    let safeZ = zone.z + nz * (radius + margin);

    if (Math.abs(safeX) >= FIELD_HALF_X - margin || Math.abs(safeZ) >= FIELD_HALF_Z - margin) {
      nx = -Math.sign(zone.x || safeX || 1);
      nz = -Math.sign(zone.z || safeZ || 1);
      const len = Math.sqrt(nx * nx + nz * nz) || 1;
      nx /= len;
      nz /= len;
      safeX = zone.x + nx * (radius + margin);
      safeZ = zone.z + nz * (radius + margin);
    }

    safeX = Math.max(-(FIELD_HALF_X - margin), Math.min(FIELD_HALF_X - margin, safeX));
    safeZ = Math.max(-(FIELD_HALF_Z - margin), Math.min(FIELD_HALF_Z - margin, safeZ));
    body.setTranslation({ x: safeX, y: t.y, z: safeZ }, true);

    const v = body.linvel();
    const outwardVel = v.x * nx + v.z * nz;
    if (outwardVel < 0) {
      body.setLinvel({ x: v.x - outwardVel * nx, y: v.y, z: v.z - outwardVel * nz }, true);
    }
  }
}

// ─── helpers used by app.js ────────────────────────────────────────────────

// Build set piece parameters from where the ball went out and who last touched it.
// Returns null if it was a goal (caller handles goals separately).
// Returns { type, teamTaking, ballFixedPos, zone } or null.
export function buildSetPieceParams(ballOutPos, lastTouchedTeam) {
  const outZ = Math.abs(ballOutPos.z) > FIELD_HALF_Z;
  const outX = Math.abs(ballOutPos.x) > FIELD_HALF_X;

  const fieldY = 0.3; // ball radius above ground (ground collider top is Y=0)

  if (outX && !outZ) {
    // ── THROW-IN ──────────────────────────────────────────────────────────
    const teamTaking = lastTouchedTeam === 'home' ? 'away' : 'home';
    const sideX = ballOutPos.x > 0 ? FIELD_HALF_X : -FIELD_HALF_X;
    const clampedZ = Math.max(-FIELD_HALF_Z + 1, Math.min(FIELD_HALF_Z - 1, ballOutPos.z));
    const ballFixedPos = { x: sideX, y: fieldY, z: clampedZ };

    const hw = 3;
    const xSign = Math.sign(sideX);
    const zone = {
      minX: xSign > 0 ? sideX : sideX - 2 * hw,
      maxX: xSign > 0 ? sideX + 2 * hw : sideX,
      minZ: clampedZ - hw,
      maxZ: clampedZ + hw,
    };
    // Opposing team must stay 9 units away from the throw-in spot (field side only)
    const exHW = 9;
    const exclusionZone = {
      minX: xSign > 0 ? sideX - exHW : sideX,
      maxX: xSign > 0 ? sideX : sideX + exHW,
      minZ: clampedZ - exHW,
      maxZ: clampedZ + exHW,
    };
    return { type: 'throwIn', teamTaking, ballFixedPos, zone, exclusionZone };
  }

  if (outZ) {
    const zSign = ballOutPos.z > 0 ? 1 : -1;
    const xSign = ballOutPos.x >= 0 ? 1 : -1;

    // which team defends the goal that the ball went out at
    // zSign > 0 → away goal (+Z) defended by 'away'
    // zSign < 0 → home goal (-Z) defended by 'home'
    const defendingTeam = zSign > 0 ? 'away' : 'home';

    if (lastTouchedTeam === defendingTeam) {
      // ── CORNER KICK ─────────────────────────────────────────────────────
      // Defender kicked it out over their own goal line → corner for attackers
      const teamTaking = defendingTeam === 'home' ? 'away' : 'home';
      const cornerX = xSign * FIELD_HALF_X;
      const cornerZ = zSign * FIELD_HALF_Z;
      const cornerInset = 0.0;
      const ballFixedPos = {
        x: cornerX - xSign * cornerInset,
        y: fieldY,
        z: cornerZ - zSign * cornerInset,
      };

      // Use a circular corner area that is nudged onto the field instead of a box outside it.
      const zone = {
        shape: 'circle',
        x: cornerX + xSign * 1.0,
        z: cornerZ + zSign * 1.0,
        radius: 3.0,
      };
      // Opposing team must stay 9 units from the corner (on the field side)
      const exExtent = 9;
      const exclusionZone = {
        minX: xSign > 0 ? cornerX - exExtent : cornerX,
        maxX: xSign > 0 ? cornerX : cornerX + exExtent,
        minZ: zSign > 0 ? cornerZ - exExtent : cornerZ,
        maxZ: zSign > 0 ? cornerZ : cornerZ + exExtent,
      };
      return { type: 'cornerKick', teamTaking, ballFixedPos, zone, exclusionZone };
    } else {
      // ── GOAL KICK ───────────────────────────────────────────────────────
      // Attacker kicked it out → goal kick for defenders
      const teamTaking = defendingTeam;
      // Ball placed ~6 units from goal line, centred on X axis
      const ballZ = zSign * (FIELD_HALF_Z - 6);
      const ballFixedPos = { x: 0, y: fieldY, z: ballZ };

      // Zone: the 6-yard box (roughly 10 wide × 8 deep from goal line)
      const zoneHalfW = 5;
      const zoneDepth = 8;
      const zone = {
        minX: -zoneHalfW,
        maxX:  zoneHalfW,
        minZ: zSign > 0 ? FIELD_HALF_Z - zoneDepth : -FIELD_HALF_Z,
        maxZ: zSign > 0 ? FIELD_HALF_Z             : -FIELD_HALF_Z + zoneDepth,
      };
      // Opposing team must stay outside the penalty area (16 wide × 18 deep from goal line)
      const exHalfW = 13;
      const exDepth = 18;
      const exclusionZone = {
        minX: -exHalfW,
        maxX:  exHalfW,
        minZ: zSign > 0 ? FIELD_HALF_Z - exDepth : -FIELD_HALF_Z,
        maxZ: zSign > 0 ? FIELD_HALF_Z           : -FIELD_HALF_Z + exDepth,
      };
      return { type: 'goalKick', teamTaking, ballFixedPos, zone, exclusionZone };
    }
  }

  return null; // shouldn't happen
}
