import * as THREE from 'three';
import { InputController, type GrappleSide, type InputSnapshot } from './InputController';
import { createLevel, type LevelData } from './Level';

interface GrappleState {
  active: boolean;
  target: THREE.Vector3;
  ropeLength: number;
  line: THREE.Line;
  previousHeld: boolean;
  side: GrappleSide;
}

interface WallContact {
  normal: THREE.Vector3;
  distance: number;
}

interface HudRefs {
  speed: HTMLElement;
  score: HTMLElement;
  energy: HTMLElement;
  level: HTMLElement;
  message: HTMLElement;
  reticle: HTMLElement;
  startOverlay: HTMLElement;
  startButton: HTMLButtonElement;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(82, innerWidth / innerHeight, 0.1, 500);
  private readonly clock = new THREE.Clock();
  private readonly playerPosition = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly input: InputController;
  private readonly hud: HudRefs;
  private readonly playerRadius = 0.72;
  private readonly eyeHeight = 1.78;
  private readonly yawPitch = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly wallRunNormal = new THREE.Vector3();
  private level!: LevelData;
  private levelNumber = 1;
  private score = 0;
  private energy = 100;
  private playing = false;
  private grounded = false;
  private wallRunning = false;
  private levelStartedAt = performance.now();
  private collisionCooldown = 0;
  private leftGrapple!: GrappleState;
  private rightGrapple!: GrappleState;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: devicePixelRatio <= 1.5,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.hud = this.getHudRefs();
    this.input = new InputController(canvas, {
      onLook: (dx, dy) => this.look(dx, dy),
      onReset: () => this.resetLevel('Course reset'),
    });

    this.setupScene();
    this.leftGrapple = this.createGrapple('left', 0x68c7ff);
    this.rightGrapple = this.createGrapple('right', 0xff7f73);
    this.loadLevel(1);
    this.bindUi();
    this.animate();
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0x9ec4d5);
    this.scene.fog = new THREE.Fog(0x9ec4d5, 42, 185);

    const hemi = new THREE.HemisphereLight(0xe9f7ff, 0x263746, 2.2);
    const sun = new THREE.DirectionalLight(0xfff2d4, 2.8);
    sun.position.set(35, 60, 20);
    this.scene.add(hemi, sun);

    const distant = new THREE.Mesh(
      new THREE.ConeGeometry(80, 80, 6),
      new THREE.MeshStandardMaterial({ color: 0x718899, flatShading: true, roughness: 1 }),
    );
    distant.position.set(-80, 25, -230);
    this.scene.add(distant);
  }

  private bindUi(): void {
    this.hud.startButton.addEventListener('click', () => {
      this.playing = true;
      this.hud.startOverlay.classList.add('hidden');
      if (!matchMedia('(pointer: coarse)').matches) void this.canvas.requestPointerLock();
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clock.stop();
      else this.clock.start();
    });
  }

  private getHudRefs(): HudRefs {
    const required = <T extends Element>(selector: string): T => {
      const element = document.querySelector<T>(selector);
      if (!element) throw new Error(`Missing UI element: ${selector}`);
      return element;
    };

    return {
      speed: required('[data-hud="speed"]'),
      score: required('[data-hud="score"]'),
      energy: required('[data-hud="energy"]'),
      level: required('[data-hud="level"]'),
      message: required('[data-hud="message"]'),
      reticle: required('[data-hud="reticle"]'),
      startOverlay: required('[data-ui="start-overlay"]'),
      startButton: required<HTMLButtonElement>('[data-ui="start"]'),
    };
  }

  private createGrapple(side: GrappleSide, color: number): GrappleState {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    line.visible = false;
    this.scene.add(line);

    return {
      active: false,
      target: new THREE.Vector3(),
      ropeLength: 0,
      line,
      previousHeld: false,
      side,
    };
  }

  private loadLevel(levelNumber: number): void {
    if (this.level) this.scene.remove(this.level.root);
    this.levelNumber = levelNumber;
    this.level = createLevel(levelNumber);
    this.scene.add(this.level.root);
    this.resetLevel(`Level ${levelNumber}`);
  }

  private resetLevel(message: string): void {
    this.playerPosition.copy(this.level.spawn);
    this.velocity.set(0, 0, 0);
    this.energy = 100;
    this.grounded = false;
    this.wallRunning = false;
    this.wallRunNormal.set(0, 0, 0);
    this.levelStartedAt = performance.now();
    this.yawPitch.set(-0.04, 0, 0);
    this.camera.quaternion.setFromEuler(this.yawPitch);
    this.updateCameraPosition();
    this.releaseGrapple(this.leftGrapple, false);
    this.releaseGrapple(this.rightGrapple, false);
    this.showMessage(message);
  }

  private look(deltaX: number, deltaY: number): void {
    const sensitivity = 0.00335;
    this.yawPitch.y -= deltaX * sensitivity;
    this.yawPitch.x -= deltaY * sensitivity;
    this.yawPitch.x = THREE.MathUtils.clamp(this.yawPitch.x, -1.45, 1.45);
    this.camera.quaternion.setFromEuler(this.yawPitch);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta() || 1 / 60, 1 / 30);
    const elapsed = performance.now() * 0.001;

    this.animateLevel(elapsed, delta);
    if (this.playing) this.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private update(delta: number): void {
    const input = this.input.snapshot();
    this.handleGrappleInput(this.leftGrapple, input.grappleLeft, -0.04);
    this.handleGrappleInput(this.rightGrapple, input.grappleRight, 0.04);

    const previousWallRunning = this.wallRunning;
    const wallContact = this.findWallContact();
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.wallRunning = Boolean(wallContact && input.moveY > 0.12 && horizontalSpeed > 2.5);

    if (this.wallRunning && wallContact) {
      this.wallRunNormal.copy(wallContact.normal);
      this.applyWallRun(wallContact, input, delta);
      if (!previousWallRunning) this.showMessage('Wall run');
    }

    this.updateCameraTilt(delta);

    const wasGrounded = this.grounded && !this.wallRunning;
    const moveStrength = Math.min(1, Math.hypot(input.moveX, input.moveY));
    const forward = this.getFlatCameraForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    right.normalize();

    const moveDirection = forward.multiplyScalar(input.moveY).add(right.multiplyScalar(input.moveX));
    if (moveDirection.lengthSq() > 0.001 && !this.wallRunning) {
      moveDirection.normalize();
      const movementAcceleration = wasGrounded ? 46 : 26;
      this.velocity.addScaledVector(moveDirection, movementAcceleration * moveStrength * delta);

      if (wasGrounded) {
        const horizontalVelocity = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
        const movementSpeed = horizontalVelocity.dot(moveDirection);
        if (movementSpeed < 11) {
          this.velocity.addScaledVector(
            moveDirection,
            (11 - movementSpeed) * Math.min(1, delta * 10),
          );
        }
      }
    } else if (wasGrounded) {
      const groundDamping = Math.pow(0.82, delta * 60);
      this.velocity.x *= groundDamping;
      this.velocity.z *= groundDamping;
    }

    this.velocity.y -= (this.wallRunning ? 2.2 : 15) * delta;
    const hasGrapple = this.leftGrapple.active || this.rightGrapple.active;
    this.velocity.multiplyScalar(Math.pow(hasGrapple ? 0.9995 : 0.998, delta * 60));

    this.applyGrappleForce(this.leftGrapple, input, delta);
    this.applyGrappleForce(this.rightGrapple, input, delta);

    if (input.boost && this.energy > 0) {
      const boostDirection = this.getBoostDirection();
      const boostForce = this.wallRunning ? 42 : hasGrapple ? 38 : 34;
      this.velocity.addScaledVector(boostDirection, boostForce * delta);
      if (this.wallRunning) this.velocity.y += 5.5 * delta;
      this.energy = Math.max(0, this.energy - 22 * delta);
    } else {
      this.energy = Math.min(100, this.energy + 11 * delta);
    }

    if (input.brake) this.velocity.multiplyScalar(Math.pow(0.91, delta * 60));

    const maxSpeed = input.boost ? 72 : hasGrapple ? 60 : 46;
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);

    this.grounded = false;
    this.playerPosition.addScaledVector(this.velocity, delta);
    this.resolveCollisions(delta);
    this.collectItems();
    this.checkFinish();

    if (this.playerPosition.y < -18) this.resetLevel('You fell — try another line');

    this.updateCameraPosition();
    this.updateGrappleLine(this.leftGrapple);
    this.updateGrappleLine(this.rightGrapple);
    this.updateHud();
    this.updateReticle();
  }

  private getFlatCameraForward(): THREE.Vector3 {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    return forward.normalize();
  }

  private getBoostDirection(): THREE.Vector3 {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    for (const grapple of [this.leftGrapple, this.rightGrapple]) {
      if (!grapple.active) continue;
      const radial = grapple.target.clone().sub(this.playerPosition).normalize();
      direction.projectOnPlane(radial);
    }

    if (this.wallRunning) {
      direction.projectOnPlane(this.wallRunNormal);
      direction.y = Math.max(direction.y, 0.12);
    }

    if (direction.lengthSq() < 0.001) return this.getFlatCameraForward();
    return direction.normalize();
  }

  private updateCameraPosition(): void {
    this.camera.position.copy(this.playerPosition);
    this.camera.position.y += this.eyeHeight;
  }

  private updateCameraTilt(delta: number): void {
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const targetRoll = this.wallRunning
      ? THREE.MathUtils.clamp(this.wallRunNormal.dot(cameraRight) * 0.14, -0.14, 0.14)
      : 0;
    this.yawPitch.z = THREE.MathUtils.lerp(this.yawPitch.z, targetRoll, Math.min(1, delta * 7));
    this.camera.quaternion.setFromEuler(this.yawPitch);
  }

  private handleGrappleInput(grapple: GrappleState, held: boolean, ndcX: number): void {
    if (held && !grapple.previousHeld) this.fireGrapple(grapple, ndcX);
    if (!held && grapple.previousHeld) this.releaseGrapple(grapple, true);
    grapple.previousHeld = held;
  }

  private fireGrapple(grapple: GrappleState, ndcX: number): void {
    const hit = this.findGrappleHit(ndcX, true);
    if (!hit) return;

    grapple.active = true;
    grapple.target.copy(hit.point);
    const distance = this.playerPosition.distanceTo(grapple.target);
    grapple.ropeLength = THREE.MathUtils.clamp(distance * 0.8, 7, 68);
    grapple.line.visible = true;

    const initialPull = grapple.target.clone().sub(this.playerPosition).normalize();
    this.velocity.addScaledVector(initialPull, Math.min(4.5, distance * 0.06));
    this.score += 5;
  }

  private findGrappleHit(ndcX: number, fullAssist: boolean): THREE.Intersection | undefined {
    const samples = fullAssist
      ? [
          new THREE.Vector2(ndcX, 0),
          new THREE.Vector2(0, 0),
          new THREE.Vector2(ndcX, 0.1),
          new THREE.Vector2(ndcX, 0.2),
          new THREE.Vector2(ndcX - 0.09, 0.08),
          new THREE.Vector2(ndcX + 0.09, 0.08),
          new THREE.Vector2(ndcX - 0.15, 0.16),
          new THREE.Vector2(ndcX + 0.15, 0.16),
          new THREE.Vector2(ndcX, -0.07),
        ]
      : [
          new THREE.Vector2(ndcX, 0),
          new THREE.Vector2(ndcX, 0.1),
          new THREE.Vector2(ndcX - 0.08, 0.06),
          new THREE.Vector2(ndcX + 0.08, 0.06),
        ];

    let bestHit: THREE.Intersection | undefined;
    let bestScore = -Infinity;

    for (const sample of samples) {
      this.raycaster.setFromCamera(sample, this.camera);
      this.raycaster.far = 115;
      const hit = this.raycaster.intersectObjects(this.level.grappleMeshes, false)[0];
      if (!hit) continue;

      const heightDifference = hit.point.y - this.camera.position.y;
      const aimOffset = Math.abs(sample.x - ndcX) + Math.abs(sample.y) * 0.7;
      const score =
        THREE.MathUtils.clamp(heightDifference, -8, 32) * 0.75 +
        Math.min(hit.distance, 80) * 0.09 -
        aimOffset * 11;

      if (score > bestScore) {
        bestScore = score;
        bestHit = hit;
      }
    }

    return bestHit;
  }

  private releaseGrapple(grapple: GrappleState, preserveMomentum: boolean): void {
    if (grapple.active && preserveMomentum && this.velocity.length() > 9) {
      const travelDirection = this.velocity.clone().normalize();
      const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      const alignment = Math.max(0, travelDirection.dot(cameraForward));
      this.velocity.addScaledVector(cameraForward, 0.8 + alignment * 1.4);
    }

    grapple.active = false;
    grapple.ropeLength = 0;
    grapple.line.visible = false;
  }

  private applyGrappleForce(grapple: GrappleState, input: InputSnapshot, delta: number): void {
    if (!grapple.active) return;

    const toAnchor = grapple.target.clone().sub(this.playerPosition);
    const distance = toAnchor.length();
    if (distance < 1.5) return;

    const directionToAnchor = toAnchor.divideScalar(distance);
    const anchorHeight = grapple.target.y - this.playerPosition.y;
    const reelRate = anchorHeight > 2 ? 4.2 : 1.8;
    grapple.ropeLength = Math.max(6.5, grapple.ropeLength - reelRate * delta);

    const stretch = Math.max(0, distance - grapple.ropeLength);
    if (stretch > 0) {
      const springForce = THREE.MathUtils.clamp(24 + stretch * 42, 24, 125);
      this.velocity.addScaledVector(directionToAnchor, springForce * delta);

      const outward = directionToAnchor.clone().negate();
      const outwardSpeed = this.velocity.dot(outward);
      if (outwardSpeed > 0) {
        this.velocity.addScaledVector(outward, -outwardSpeed * Math.min(0.94, 0.55 + stretch * 0.08));
      }
    } else {
      this.velocity.addScaledVector(directionToAnchor, 8 * delta);
    }

    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const desiredSwing = cameraForward
      .addScaledVector(cameraRight, input.moveX * 0.45)
      .addScaledVector(UP, 0.12 + Math.max(0, input.moveY) * 0.22)
      .projectOnPlane(directionToAnchor);

    if (desiredSwing.lengthSq() > 0.001) {
      desiredSwing.normalize();
      const dualGrappleFactor = this.leftGrapple.active && this.rightGrapple.active ? 0.62 : 1;
      const swingAssist = (15 + Math.max(0, input.moveY) * 13) * dualGrappleFactor;
      this.velocity.addScaledVector(desiredSwing, swingAssist * delta);
    }

    if (anchorHeight > 5 && this.velocity.y < 2.5) {
      this.velocity.y += Math.min(4.5, anchorHeight * 0.16) * delta;
    }
  }

  private findWallContact(): WallContact | undefined {
    const point = this.playerPosition;
    let bestContact: WallContact | undefined;
    let bestDistance = 0.92;

    const consider = (distance: number, normal: THREE.Vector3): void => {
      if (distance >= bestDistance) return;
      bestDistance = distance;
      bestContact = { normal: normal.clone(), distance };
    };

    for (const collider of this.level.colliders) {
      if (collider.max.y - collider.min.y < 4) continue;
      if (point.y < collider.min.y - 0.5 || point.y > collider.max.y + 0.5) continue;

      const withinZ = point.z >= collider.min.z - this.playerRadius && point.z <= collider.max.z + this.playerRadius;
      const withinX = point.x >= collider.min.x - this.playerRadius && point.x <= collider.max.x + this.playerRadius;

      if (withinZ) {
        consider(Math.abs(point.x - (collider.min.x - this.playerRadius)), new THREE.Vector3(-1, 0, 0));
        consider(Math.abs(point.x - (collider.max.x + this.playerRadius)), new THREE.Vector3(1, 0, 0));
      }

      if (withinX) {
        consider(Math.abs(point.z - (collider.min.z - this.playerRadius)), new THREE.Vector3(0, 0, -1));
        consider(Math.abs(point.z - (collider.max.z + this.playerRadius)), new THREE.Vector3(0, 0, 1));
      }
    }

    return bestContact;
  }

  private applyWallRun(contact: WallContact, input: InputSnapshot, delta: number): void {
    const normal = contact.normal;
    const flatForward = this.getFlatCameraForward();
    const facingIntoWall = flatForward.dot(normal.clone().negate());
    const wallTangent = new THREE.Vector3().crossVectors(UP, normal).normalize();

    if (wallTangent.dot(flatForward) < 0) wallTangent.negate();

    let runDirection: THREE.Vector3;
    let targetSpeed: number;

    if (facingIntoWall > 0.48) {
      const lateralInfluence = input.moveX * 0.42;
      runDirection = UP.clone().multiplyScalar(0.9).addScaledVector(wallTangent, lateralInfluence).normalize();
      targetSpeed = 15.5;
    } else {
      runDirection = wallTangent.addScaledVector(UP, 0.16).normalize();
      targetSpeed = 18;
    }

    const speedAlongWall = this.velocity.dot(runDirection);
    if (speedAlongWall < targetSpeed) {
      this.velocity.addScaledVector(
        runDirection,
        (targetSpeed - speedAlongWall) * Math.min(1, delta * 7),
      );
    }

    const outwardSpeed = this.velocity.dot(normal);
    if (outwardSpeed > 0) this.velocity.addScaledVector(normal, -outwardSpeed);

    this.velocity.addScaledVector(normal, -7.5 * delta);
    this.velocity.y = Math.max(this.velocity.y, facingIntoWall > 0.48 ? 4.2 : -0.8);
  }

  private updateGrappleLine(grapple: GrappleState): void {
    if (!grapple.active) return;
    const sideOffset = new THREE.Vector3(grapple.side === 'left' ? -0.32 : 0.32, -0.28, -0.55)
      .applyQuaternion(this.camera.quaternion)
      .add(this.camera.position);
    const positions = grapple.line.geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, sideOffset.x, sideOffset.y, sideOffset.z);
    positions.setXYZ(1, grapple.target.x, grapple.target.y, grapple.target.z);
    positions.needsUpdate = true;
  }

  private resolveCollisions(delta: number): void {
    this.collisionCooldown = Math.max(0, this.collisionCooldown - delta);
    const point = this.playerPosition;

    for (const collider of this.level.colliders) {
      const expanded = collider.clone().expandByScalar(this.playerRadius);
      if (!expanded.containsPoint(point)) continue;

      const distances = [
        { value: Math.abs(point.x - expanded.min.x), axis: 'x', sign: -1 },
        { value: Math.abs(expanded.max.x - point.x), axis: 'x', sign: 1 },
        { value: Math.abs(point.y - expanded.min.y), axis: 'y', sign: -1 },
        { value: Math.abs(expanded.max.y - point.y), axis: 'y', sign: 1 },
        { value: Math.abs(point.z - expanded.min.z), axis: 'z', sign: -1 },
        { value: Math.abs(expanded.max.z - point.z), axis: 'z', sign: 1 },
      ].sort((a, b) => a.value - b.value);

      const hit = distances[0];
      const axis = hit.axis as 'x' | 'y' | 'z';
      const normal = new THREE.Vector3();
      normal[axis] = hit.sign;
      point[axis] = hit.sign < 0 ? expanded.min[axis] - 0.01 : expanded.max[axis] + 0.01;

      const intoSurface = this.velocity.dot(normal);
      if (normal.y > 0.5) {
        this.grounded = true;
        if (this.velocity.y < 0) this.velocity.y = 0;
      } else {
        if (intoSurface < 0) this.velocity.addScaledVector(normal, -intoSurface * 1.25);

        const isRunningOnWall = this.wallRunning && normal.dot(this.wallRunNormal) > 0.75;
        if (!isRunningOnWall) this.velocity.multiplyScalar(0.72);
      }

      if (this.collisionCooldown <= 0 && normal.y < 0.5 && !this.wallRunning && Math.abs(intoSurface) > 8) {
        this.score = Math.max(0, this.score - 35);
        this.showMessage('Impact! −35 points');
        this.collisionCooldown = 0.65;
      }
    }

    for (const hazard of this.level.movingHazards) {
      const beam = hazard.userData.beam as THREE.Mesh;
      const box = new THREE.Box3().setFromObject(beam).expandByScalar(this.playerRadius);
      if (box.containsPoint(this.playerPosition)) {
        this.velocity.multiplyScalar(-0.35);
        this.score = Math.max(0, this.score - 100);
        this.showMessage('Hazard hit! −100');
        this.playerPosition.y += 2;
      }
    }
  }

  private collectItems(): void {
    for (const collectible of this.level.collectibles) {
      if (!collectible.visible) continue;
      if (collectible.position.distanceToSquared(this.playerPosition) < 3.5) {
        collectible.visible = false;
        this.score += 100;
        this.energy = Math.min(100, this.energy + 20);
        this.showMessage('+100 energy shard');
      }
    }
  }

  private checkFinish(): void {
    if (this.playerPosition.distanceToSquared(this.level.finishPosition) > 58) return;
    const seconds = (performance.now() - this.levelStartedAt) / 1000;
    const timeBonus = Math.max(0, Math.round(1500 - seconds * 16));
    this.score += timeBonus;

    if (this.levelNumber < 3) {
      this.showMessage(`Level clear! +${timeBonus} time bonus`);
      this.loadLevel(this.levelNumber + 1);
    } else {
      this.playing = false;
      this.hud.startOverlay.classList.remove('hidden');
      this.hud.startOverlay.querySelector('h1')!.textContent = 'Course Complete';
      this.hud.startOverlay.querySelector('p')!.textContent = `Final score: ${this.score.toLocaleString()}`;
      this.hud.startButton.textContent = 'Run Again';
      this.hud.startButton.onclick = () => {
        this.score = 0;
        this.loadLevel(1);
      };
      document.exitPointerLock?.();
    }
  }

  private animateLevel(elapsed: number, delta: number): void {
    if (!this.level) return;
    for (const collectible of this.level.collectibles) {
      collectible.rotation.y += delta * 1.9;
      collectible.rotation.x += delta * 0.8;
      collectible.position.y = Number(collectible.userData.baseY) + Math.sin(elapsed * 2 + Number(collectible.userData.phase)) * 0.45;
    }
    this.level.finish.rotation.z += delta * 0.65;
    for (const hazard of this.level.movingHazards) {
      hazard.rotation.y += delta * Number(hazard.userData.speed);
    }
  }

  private updateHud(): void {
    this.hud.speed.textContent = `${Math.round(this.velocity.length() * 3.6)} km/h`;
    this.hud.score.textContent = this.score.toLocaleString();
    this.hud.energy.textContent = `${Math.round(this.energy)}%`;
    this.hud.level.textContent = `${this.levelNumber} / 3`;
    document.documentElement.style.setProperty('--energy', `${this.energy}%`);
  }

  private updateReticle(): void {
    const canGrapple = Boolean(this.findGrappleHit(0, false));
    this.hud.reticle.classList.toggle('can-grapple', canGrapple);
  }

  private showMessage(message: string): void {
    this.hud.message.textContent = message;
    this.hud.message.classList.remove('show');
    void this.hud.message.offsetWidth;
    this.hud.message.classList.add('show');
  }
}
