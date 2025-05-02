// Joystick move event with better movement handling
this.joystick.on('move', (evt, data) => {
  const force = Math.min(data.force, 1); // Normalize force between 0 and 1
  const angle = data.angle.radian;
  
  // Calculate movement values using the joystick - fixed direction mapping
  this.moveForward = -Math.sin(angle) * force * SPEED; 
  this.moveRight = Math.cos(angle) * force * SPEED;    
});