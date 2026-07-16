import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getWaterDepth, SWIM_DEPTH_THRESHOLD, getTerrainHeight } from './water.js';
import { MOON_RADIUS } from "./worldGeneration.js";
import { getSpawnPosition } from './spawnUtils.js';

// Movement constants
const SPEED = 5;
const SWIM_SPEED = 2;
const SPRINT_BASE_MULTIPLIER = 1.01;
const SPRINT_MAX_MULTIPLIER = 2.5;
const SPRINT_FREQUENCY_WINDOW_MS = 1300; // window to count presses
const SPRINT_MAX_PRESSES = 13;            // presses in window for max speed
const SPRINT_DURATION_MS = 220;          // how long each press keeps sprint active
const SPRINT_MAX_STAMINA = 80;
const SPRINT_DRAIN_RATE = 20;            // stamina per second while sprinting
const SPRINT_REGEN_RATE = 5;             // stamina per second while not sprinting
const JUMP_FORCE = 5;
const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_HEIGHT = 0.6;
const FLOAT_IDLE_DISPLAY_OFFSET = 0.2;

export class PlayerControls {
  constructor({ scene, camera, playerModel, renderer, multiplayer, spawnProjectile, projectiles, audioManager, spawnPosition, playerName }) {
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;
    this.renderer = renderer;
    this.domElement = this.renderer.domElement;
    this.scene = scene;
    this.playerModel = playerModel;
    this.camera = camera;
    this.multiplayer = multiplayer;
    this.playerName = playerName;
    this.lastPosition = new THREE.Vector3();
    this.wasMoving = false;
    this.isMoving = false;
    this.spawnProjectile = spawnProjectile;
    this.projectiles = projectiles;
    this.audioManager = audioManager;
    this.isKnocked = false;
    this.knockbackRestYaw = 0;
    this.slideMomentum = new THREE.Vector3();
    this.slideMomentumDecay = 0.99;
    this.lastMoveDirection = new THREE.Vector3();
    this.grabbedTarget = null;
    this.isGrabbed = false;
    this.grabberId = null;
    this.externalGrabPos = null;