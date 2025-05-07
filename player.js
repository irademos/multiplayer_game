import * as THREE from 'three';

export function createPlayerModel(three, username) {
    const playerGroup = new THREE.Group();
    
    // Create a rectangular body instead of capsule
    const bodyGeometry = new THREE.BoxGeometry(0.6 * 0.7, 1.4 * 0.7, 0.3 * 0.7);
    
    // Generate consistent color from username
    const hash = username.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0);
    const color = new THREE.Color(Math.abs(hash) % 0xffffff);
    
    const bodyMaterial = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1.1 * 0.7; 
    body.castShadow = true;
    playerGroup.add(body);
    
    // Add eyes
    const eyeGeometry = new THREE.SphereGeometry(0.08 * 0.7, 8, 8);
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const eyePupilMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
    
    // Left eye
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.15 * 0.7, 1.6 * 0.7, 0.15 * 0.7);  
    playerGroup.add(leftEye);
    
    // Left pupil
    const leftPupil = new THREE.Mesh(new THREE.SphereGeometry(0.04 * 0.7, 8, 8), eyePupilMaterial);
    leftPupil.position.set(0, 0, 0.05 * 0.7);
    leftEye.add(leftPupil);
    
    // Right eye
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.15 * 0.7, 1.6 * 0.7, 0.15 * 0.7);  
    playerGroup.add(rightEye);
    
    // Right pupil
    const rightPupil = new THREE.Mesh(new THREE.SphereGeometry(0.04 * 0.7, 8, 8), eyePupilMaterial);
    rightPupil.position.set(0, 0, 0.05 * 0.7);
    rightEye.add(rightPupil);
    
    // Add legs - half the length and set pivot at top
    const legGeometry = new THREE.BoxGeometry(0.2 * 0.7, 0.5 * 0.7, 0.2 * 0.7);
    const legMaterial = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8) });
    
    // Left leg - moved geometry origin to top with matrix transform
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.2 * 0.7, 0.6 * 0.7, 0);
    // Move geometry so it pivots at the top instead of center
    leftLeg.geometry.translate(0, -0.25 * 0.7, 0);
    leftLeg.name = "leftLeg";
    playerGroup.add(leftLeg);
    
    // Right leg - moved geometry origin to top with matrix transform
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.2 * 0.7, 0.6 * 0.7, 0);
    // Move geometry so it pivots at the top instead of center
    rightLeg.geometry.translate(0, -0.25 * 0.7, 0);
    rightLeg.name = "rightLeg";
    playerGroup.add(rightLeg);
    
    // Add a billboarded text plane for chat messages (not visible by default)
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0, 0, 0, 0)'; // Transparent background
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    const chatMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    
    const chatGeometry = new THREE.PlaneGeometry(1, 0.25);
    const chatMesh = new THREE.Mesh(chatGeometry, chatMaterial);
    chatMesh.position.y = 2.3 * 0.7; 
    chatMesh.rotation.x = Math.PI / 12;
    chatMesh.visible = false;
    chatMesh.name = "chatBillboard";
    playerGroup.add(chatMesh);

    // Create HTML name label
    const label = document.createElement('div');
    label.className = 'name-label';
    label.innerText = username;
    label.style.position = 'absolute';
    label.style.color = 'white';
    label.style.fontSize = '14px';
    label.style.pointerEvents = 'none';
    label.style.textShadow = '0 0 4px black';

    // Return both the model and the label
    return { model: playerGroup, nameLabel: label };
    // return playerGroup;
}