// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export function createPlayerModel(THREE, username, onLoad) {
  const playerGroup = new THREE.Group();
  const loader = new FBXLoader();
  loader.load(
    `/models/old_man_files/${encodeURIComponent('Old Man Idle.fbx')}`,
    (fbx) => {
      const model = fbx;

      // Scale and center the model so it rotates around its midpoint
      const scale = 0.01;
      model.scale.set(scale, scale, scale);

      // Center the FBX so rotations occur around its middle
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      playerGroup.add(model);

      const mixer = new THREE.AnimationMixer(model);
      const actions = {};

      // Idle animation from the base model
      const idleAction = mixer.clipAction(fbx.animations[0]);
      actions.idle = idleAction;
      idleAction.play();
      playerGroup.userData.currentAction = 'idle';

      // Load additional Mixamo animations
      const fbxLoader = new FBXLoader();
      const animationFiles = {
        walk: 'Old Man Walk.fbx',
        run: 'Drunk Run Forward.fbx',
        jump: 'Joyful Jump.fbx',
        hit: 'Old Man Dying.fbx',
      };

      const promises = Object.entries(animationFiles).map(([name, file]) => {
        return new Promise((resolve, reject) => {
          fbxLoader.load(
            `/models/old_man_files/${encodeURIComponent(file)}`,
            (anim) => {
              const clip = anim.animations[0];
              const action = mixer.clipAction(clip);
              if (name === 'jump' || name === 'hit') {
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
