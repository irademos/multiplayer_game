import nipplejs from "https://cdn.jsdelivr.net/npm/nipplejs@0.10.1/+esm";

export function createJoystick(playerControls) {
  const joystickZone = document.createElement('div');
  joystickZone.id = 'joystick-zone';
  joystickZone.style.position = 'absolute';
  joystickZone.style.left = 0;
  joystickZone.style.bottom = 0;
  joystickZone.style.width = '50%';
  joystickZone.style.height = '100%';
  joystickZone.style.zIndex = 10;
  document.body.appendChild(joystickZone);

  const joystick = nipplejs.create({
    zone: joystickZone,
    mode: 'static',
    position: { left: '25%', bottom: '25%' },
    color: 'white',
    size: 100,
    restOpacity: 0.5
  });

  joystick.on('move', (evt, data) => {
    const force = Math.min(data.force, 1);
    const angle = data.angle.radian;
    playerControls.moveForward = -Math.sin(angle) * force;
    playerControls.moveRight = Math.cos(angle) * force;
  });

  joystick.on('end', () => {
    playerControls.moveForward = 0;
    playerControls.moveRight = 0;
  });
}
