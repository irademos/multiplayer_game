import * as THREE from 'three';

const FIELD_HALF_X = 30;
const FIELD_HALF_Z = 50;

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
  // ballFixedPos: { x, y, z }
  // teamTaking: 'home' | 'away'
  trigger(type, teamTaking, ballFixedPos, zone) {
    this.clear();

    this._buildZoneVisual(zone);
    this._showLabel(type, teamTaking);

    this.active = {
      type,
      teamTaking,
      ballFixedPos: { ...ballFixedPos },
      zone: { ...zone },
      ballLocked: true,
      startTime: performance.now(),
    };
  }

  // Call each frame while a set piece is active.
  // setPieceBody: Rapier body of the player taking the set piece
  // otherBody:    Rapier body of the other player (kept out of zone)
  // soccerBall:   SoccerBall instance
  // Returns true if the set piece just ended.
  update(soccerBall, setPieceBody, otherBody) {
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
        const inField = Math.abs(bp.x) < FIELD_HALF_X && Math.abs(bp.z) < FIELD_HALF_Z;
        const inZone = bp.x >= a.zone.minX && bp.x <= a.zone.maxX &&
                       bp.z >= a.zone.minZ && bp.z <= a.zone.maxZ;

        if (!inZone && !inField) {
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

    // Keep non-set-piece player out of zone
    if (otherBody) {
      this._pushOutOfZone(otherBody, a.zone);
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

  _pushOutOfZone(body, zone) {
    const t = body.translation();
    const pad = 0.5;
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

    // Find nearest face to escape through
    const dLeft  = t.x - expanded.minX;
    const dRight = expanded.maxX - t.x;
    const dFront = t.z - expanded.minZ;
    const dBack  = expanded.maxZ - t.z;
    const minD = Math.min(dLeft, dRight, dFront, dBack);
    const v = body.linvel();

    if (minD === dLeft) {
      body.setTranslation({ x: expanded.minX - 0.1, y: t.y, z: t.z }, true);
      if (v.x > 0) body.setLinvel({ x: 0, y: v.y, z: v.z }, true);
    } else if (minD === dRight) {
      body.setTranslation({ x: expanded.maxX + 0.1, y: t.y, z: t.z }, true);
      if (v.x < 0) body.setLinvel({ x: 0, y: v.y, z: v.z }, true);
    } else if (minD === dFront) {
      body.setTranslation({ x: t.x, y: t.y, z: expanded.minZ - 0.1 }, true);
      if (v.z > 0) body.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
    } else {
      body.setTranslation({ x: t.x, y: t.y, z: expanded.maxZ + 0.1 }, true);
      if (v.z < 0) body.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
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
    return { type: 'throwIn', teamTaking, ballFixedPos, zone };
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
      const ballFixedPos = { x: cornerX, y: fieldY, z: cornerZ };

      // Zone is outside the field; the corner of the zone sits on the field corner
      const extent = 3.5;
      const zone = {
        minX: xSign > 0 ? cornerX : cornerX - extent,
        maxX: xSign > 0 ? cornerX + extent : cornerX,
        minZ: zSign > 0 ? cornerZ : cornerZ - extent,
        maxZ: zSign > 0 ? cornerZ + extent : cornerZ,
      };
      return { type: 'cornerKick', teamTaking, ballFixedPos, zone };
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
      return { type: 'goalKick', teamTaking, ballFixedPos, zone };
    }
  }

  return null; // shouldn't happen
}
