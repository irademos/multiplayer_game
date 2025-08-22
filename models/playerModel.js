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
          const model = fbx;

      try {
        // --- make FBX unlit and remove its internal lights ---
        model.traverse((obj) => {
          // Remove lights embedded in the FBX
          if (obj.isLight) {
            obj.parent && obj.parent.remove(obj);
            return;
          }

          // Replace any lit materials with MeshBasicMaterial
          if (obj.isMesh) {
            // turn off shadows so lighting side-effects don't show up
            obj.castShadow = false;
            obj.receiveShadow = false;

            const toBasic = (mat) => {
              if (!mat) return mat;
              // Preserve the most important props; MeshBasicMaterial ignores lights
              const basicParams = {
                map: mat.map || null,
                color: (mat.color && mat.color.clone()) || new THREE.Color(0xffffff),
                transparent: mat.transparent || false,
                opacity: (typeof mat.opacity === 'number') ? mat.opacity : 1,
                side: mat.side || THREE.FrontSide,
                // keep vertex colors if present
                vertexColors: !!mat.vertexColors,
                // keep alpha maps if any
                alphaMap: mat.alphaMap || null,
                // skinned meshes need this flag even on basic materials
                skinning: obj.isSkinnedMesh === true
              };
              // Note: normal/roughness/metalness maps are ignored by MeshBasicMaterial (by design)
              return new THREE.MeshBasicMaterial(basicParams);
            };

            if (Array.isArray(obj.material)) {
              obj.material = obj.material.map(toBasic);
            } else {
              obj.material = toBasic(obj.material);
            }
          }
        });
      }
      catch  (error) {
        console.log(error);
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

