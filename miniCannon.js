export class Vec3 {
  constructor(x=0,y=0,z=0){
    this.x=x; this.y=y; this.z=z;
  }
  set(x,y,z){ this.x=x; this.y=y; this.z=z; return this; }
}

// Shared physics timestep so simulations advance consistently across modules
export const FIXED_TIME_STEP = 1 / 60;

export class Box {
  constructor(halfExtents){ this.halfExtents = halfExtents; }
}

export class Quaternion {
  constructor(x=0,y=0,z=0,w=1){
    this.x=x; this.y=y; this.z=z; this.w=w;
  }
  set(x,y,z,w){ this.x=x; this.y=y; this.z=z; this.w=w; return this; }
}

export class Body {
  constructor({mass=0, shape}={}){
    this.mass = mass;
    this.shape = shape;
    this.position = new Vec3();
    this.velocity = new Vec3();
    this.quaternion = new Quaternion();
  }
  applyImpulse(vec){
    this.velocity.x += vec.x / this.mass;
    this.velocity.y += vec.y / this.mass;
    this.velocity.z += vec.z / this.mass;
  }
}

export class World {
  constructor({gravity=new Vec3(0,-9.82,0)}={}){
    this.gravity = gravity;
    this.bodies = [];
  }
  addBody(body){ this.bodies.push(body); }
  step(dt){
    for(const b of this.bodies){
      b.velocity.x += this.gravity.x * dt;
      b.velocity.y += this.gravity.y * dt;
      b.velocity.z += this.gravity.z * dt;
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;
      b.position.z += b.velocity.z * dt;
      if(b.position.y < 0){
        b.position.y = 0;
        if(b.velocity.y < 0) b.velocity.y = 0;
      }
    }
  }
}
