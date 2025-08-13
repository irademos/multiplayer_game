// /models/playerModel.js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createPlayerModel(THREE, username, onLoad) {
  const playerGroup = new THREE.Group();

  const loader = new GLTFLoader();
  loader.load(
    '/models/animated_old_man_character.glb',
    (gltf) => {
      const model = gltf.scene;
      playerGroup.add(model);

      const mixer = new THREE.AnimationMixer(model);
      const actions = {};
      gltf.animations.forEach((clip) => {
        actions[clip.name] = mixer.clipAction(clip);
        console.log('Player animation:', clip.name);
      });

      playerGroup.userData.mixer = mixer;
      playerGroup.userData.actions = actions;
      playerGroup.userData.currentAction = null;

      if (onLoad) onLoad({ mixer, actions });
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
