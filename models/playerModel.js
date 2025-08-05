// /models/playerModel.js
export function createPlayerModel(THREE, username) {
  const playerGroup = new THREE.Group();

  const hash = username.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
  const color = new THREE.Color(Math.abs(hash) % 0xffffff);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.98, 0.21),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.77;
  body.castShadow = true;
  playerGroup.add(body);

  const eyeGeo = new THREE.SphereGeometry(0.056, 8, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000 });

  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.105, 1.12, 0.105);
  const leftPupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), pupilMat);
  leftPupil.position.z = 0.035;
  leftEye.add(leftPupil);
  playerGroup.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.105, 1.12, 0.105);
  const rightPupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), pupilMat);
  rightPupil.position.z = 0.035;
  rightEye.add(rightPupil);
  playerGroup.add(rightEye);

  const legGeo = new THREE.BoxGeometry(0.14, 0.35, 0.14);
  const legMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8) });

  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.14, 0.42, 0);
  leftLeg.geometry.translate(0, -0.175, 0);
  leftLeg.name = "leftLeg";
  playerGroup.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.14, 0.42, 0);
  rightLeg.geometry.translate(0, -0.175, 0);
  rightLeg.name = "rightLeg";
  playerGroup.add(rightLeg);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(0, 0, 0, 0)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  const chatMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const chatPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25), chatMaterial);
  chatPlane.position.y = 1.61;
  chatPlane.rotation.x = Math.PI / 12;
  chatPlane.visible = false;
  chatPlane.name = "chatBillboard";
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
