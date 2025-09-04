// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export function createPlayerModel(
  THREE,
  username,
  onLoad,
  modelPath = '/models/old_man.fbx'
) {
  const playerGroup = new THREE.Group();
  const loader = new FBXLoader();

  const configPath = modelPath.replace(/\.[^/.]+$/, '.json');
  fetch(configPath)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((config) => {
      loader.load(
        modelPath,
        (fbx) => {
          // Guard: make sure we actually got an Object3D
          if (!fbx || typeof fbx.traverse !== 'function') {
            console.warn('FBXLoader returned an unexpected result:', fbx);
            return;
          }

          const model = fbx;

          try {
            const lightsToRemove = [];

            model.traverse((obj) => {
              // Mark embedded lights for removal (don't remove yet!)
              if (obj.isLight) {
                lightsToRemove.push(obj);
                return;
              }

              // Make meshes unlit
              if (obj.isMesh) {
                obj.castShadow = false;
                obj.receiveShadow = false;

                const toBasic = (mat) => {
                  if (!mat) return mat;

                  const basicParams = {
                    map: mat.map || null,
                    color: (mat.color && mat.color.clone()) || new THREE.Color(0xffffff),
                    transparent: !!mat.transparent,
                    opacity: (typeof mat.opacity === 'number') ? mat.opacity : 1,
                    side: mat.side ?? THREE.FrontSide,
                    vertexColors: !!mat.vertexColors,
                    alphaMap: mat.alphaMap || null,
                    skinning: obj.isSkinnedMesh === true, // keep skinning for skinned meshes
                  };

                  // dispose AFTER replacement to avoid disposing a material that might
                  // still be referenced during traversal in some engines
                  const newMat = new THREE.MeshBasicMaterial(basicParams);
                  if (typeof mat.dispose === 'function') {
                    // dispose old material on next tick to be extra safe
                    queueMicrotask(() => mat.dispose());
                  }
                  return newMat;
                };

                if (Array.isArray(obj.material)) {
                  obj.material = obj.material.map(toBasic);
                } else if (obj.material) {
                  obj.material = toBasic(obj.material);
                }
              }
            });

            // Now it's safe to remove the lights
            for (const light of lightsToRemove) {
              if (light.parent) light.parent.remove(light);
            }

            console.log('✅ FBX made unlit and internal lights removed (no in-traverse mutations)');
          } catch (err) {
            console.error('While making FBX unlit:', err);
          }


          // Scale and center the model so it rotates around its midpoint
          const scale = config.scale ?? 1;
          model.scale.set(scale, scale, scale);

          // Center the FBX so rotations pivot around the model itself
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());

          // Offset the model inside a pivot group instead of shifting the mesh directly
          const pivot = new THREE.Group();
          const yOffset = (config.yOffset ?? 0) - box.min.y;
          pivot.position.set(-center.x, yOffset, -center.z - (config.zOffset ?? 0));
          pivot.add(model);
          playerGroup.add(pivot);
          playerGroup.userData.pivot = pivot;

          const mixer = new THREE.AnimationMixer(model);
          const actions = {};

          // Load Mixamo animations
          const fbxLoader = new FBXLoader();
          const animationFiles = {
            idle: 'Breathing Idle.fbx',
            walk: 'Old Man Walk.fbx',
            run: 'Drunk Run Forward.fbx',
            jump: 'Joyful Jump.fbx',
            hit: 'Flying Back Death.fbx',
            mutantPunch: 'Mutant Punch.fbx',
            mmaKick: 'Mma Kick.fbx',
            runningKick: 'Female Laying Pose.fbx',
            hurricaneKick: 'Hurricane Kick.fbx',
            projectile: 'Projectile.fbx',
            die: 'Dying.fbx',
            float: 'Floating.fbx',
            swim: 'Swimming.fbx',
          };

          const promises = Object.entries(animationFiles).map(([name, file]) => {
            return new Promise((resolve, reject) => {
              fbxLoader.load(
                `/models/animations/${encodeURIComponent(file)}`,
                (anim) => {
                  const clip = anim.animations[0];
                  const action = mixer.clipAction(clip);
                  if (
                    ['jump', 'hit', 'mutantPunch', 'mmaKick', 'runningKick', 'hurricaneKick', 'projectile', 'die'].includes(name)
                  ) {
                    action.loop = THREE.LoopOnce;
                    action.clampWhenFinished = true;
                  }
                  actions[name] = action;
                  resolve();
                },
                undefined,
                reject
              );
            });
          });

          Promise.all(promises).then(() => {
            actions.idle.play();
            playerGroup.userData.currentAction = 'idle';
            playerGroup.userData.mixer = mixer;
            playerGroup.userData.actions = actions;
            if (onLoad) onLoad({ mixer, actions });
          });
        },
        undefined,
        (err) => {
          console.error('Failed to load player model:', err);
        }
      );
    });

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(0, 0, 0, 0)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  const chatMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const chatPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25), chatMaterial);
  chatPlane.position.y = 1.61;
  chatPlane.rotation.x = Math.PI / 12;
  chatPlane.visible = false;
  chatPlane.name = 'chatBillboard';
  playerGroup.add(chatPlane);

  const label = document.createElement('div');
  label.className = 'name-label';
  label.innerText = username;
  label.style.position = 'absolute';
  label.style.color = 'white';
  label.style.fontSize = '14px';
  label.style.pointerEvents = 'none';
  label.style.textShadow = '0 0 4px black';

  return { model: playerGroup, nameLabel: label };
}

