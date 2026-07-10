import * as THREE from 'three';
import { InputController, type GrappleSide } from './InputController';
import { createLevel, type LevelData } from './Level';

interface GrappleState {
  active: boolean;
  target: THREE.Vector3;
  line: THREE.Line;
  previousHeld: boolean;
  side: GrappleSide;
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

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 500);
  private readonly clock = new THREE.Clock();
  private readonly playerPosition = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly input: InputController;
  private readonly hud: HudRefs;
  private readonly playerRadius = 0.72;
  private readonly yawPitch = new THREE.Euler(0, 0, 0, 'YXZ');
  private level!: LevelData;
  private levelNumber = 1;
  private score = 0;
  private energy = 100;
  private playing = false;
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
    this.velocity.set(0, 0, -1.5);
    this.energy = 100;
    this.levelStartedAt = performance.now();
    this.releaseGrapple(this.leftGrapple);
    this.releaseGrapple(this.rightGrapple);
    this.showMessage(message);
  }

  private look(deltaX: number, deltaY: number): void {
    const sensitivity = 0.00235;
    this.yawPitch.y -= deltaX * sensitivity;
    this.yawPitch.x -= deltaY * sensitivity;
    this.yawPitch.x = THREE.MathUtils.clamp(this.yawPitch.x, -1.42, 1.42);
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
    this.handleGrappleInput(this.leftGrapple, input.grappleLeft, -0.18);
    this.handleGrappleInput(this.rightGrapple, input.grappleRight, 0.18);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const steer = forward.multiplyScalar(input.moveY).add(right.multiplyScalar(input.moveX));
    if (steer.lengthSq() > 0) {
      steer.normalize();
      this.velocity.addScaledVector(steer, 8.5 * delta);
    }

    this.velocity.y -= 13.5 * delta;
    this.velocity.multiplyScalar(Math.pow(0.996, delta * 60));

    this.applyGrappleForce(this.leftGrapple, delta);
    this.applyGrappleForce(this.rightGrapple, delta);

    if (input.boost && this.energy > 0) {
      const boostDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      this.velocity.addScaledVector(boostDirection, 20 * delta);
      this.energy = Math.max(0, this.energy - 24 * delta);
    } else {
      this.energy = Math.min(100, this.energy + 9 * delta);
    }

    if (input.brake) this.velocity.multiplyScalar(Math.pow(0.94, delta * 60));

    const maxSpeed = input.boost ? 48 : 38;
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);

    this.playerPosition.addScaledVector(this.velocity, delta);
    this.resolveCollisions(delta);
    this.collectItems();
    this.checkFinish();

    if (this.playerPosition.y < -18) this.resetLevel('You fell — try another line');

    this.camera.position.copy(this.playerPosition);
    this.updateGrappleLine(this.leftGrapple);
    this.updateGrappleLine(this.rightGrapple);
    this.updateHud();
    this.updateReticle();
  }

  private handleGrappleInput(grapple: GrappleState, held: boolean, ndcX: number): void {
    if (held && !grapple.previousHeld) this.fireGrapple(grapple, ndcX);
    if (!held && grapple.previousHeld) this.releaseGrapple(grapple);
    grapple.previousHeld = held;
  }

  private fireGrapple(grapple: GrappleState, ndcX: number): void {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, 0), this.camera);
    this.raycaster.far = 75;
    const hit = this.raycaster.intersectObjects(this.level.grappleMeshes, false)[0];
    if (!hit) {
      this.showMessage(`${grapple.side === 'left' ? 'Left' : 'Right'} tether missed`);
      return;
    }

    grapple.active = true;
    grapple.target.copy(hit.point);
    grapple.line.visible = true;
    this.score += 5;
  }

  private releaseGrapple(grapple: GrappleState): void {
    grapple.active = false;
    grapple.line.visible = false;
  }

  private applyGrappleForce(grapple: GrappleState, delta: number): void {
    if (!grapple.active) return;
    const toTarget = grapple.target.clone().sub(this.playerPosition);
    const distance = toTarget.length();
    if (distance < 1) return;

    const direction = toTarget.divideScalar(distance);
    const pullStrength = THREE.MathUtils.clamp(18 + distance * 0.48, 18, 48);
    this.velocity.addScaledVector(direction, pullStrength * delta);

    const radialSpeed = this.velocity.dot(direction);
    if (radialSpeed < -2) this.velocity.addScaledVector(direction, -radialSpeed * 0.22);
  }

  private updateGrappleLine(grapple: GrappleState): void {
    if (!grapple.active) return;
    const sideOffset = new THREE.Vector3(grapple.side === 'left' ? -0.32 : 0.32, -0.24, -0.55)
      .applyQuaternion(this.camera.quaternion)
      .add(this.playerPosition);
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
      const normal = new THREE.Vector3();
      normal[hit.axis as 'x' | 'y' | 'z'] = hit.sign;
      point[hit.axis as 'x' | 'y' | 'z'] = hit.sign < 0
        ? expanded.min[hit.axis as 'x' | 'y' | 'z'] - 0.01
        : expanded.max[hit.axis as 'x' | 'y' | 'z'] + 0.01;

      const intoSurface = this.velocity.dot(normal);
      if (intoSurface < 0) this.velocity.addScaledVector(normal, -intoSurface * 1.35);
      this.velocity.multiplyScalar(0.58);

      if (this.collisionCooldown <= 0 && Math.abs(intoSurface) > 7) {
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
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = 75;
    const canGrapple = this.raycaster.intersectObjects(this.level.grappleMeshes, false).length > 0;
    this.hud.reticle.classList.toggle('can-grapple', canGrapple);
  }

  private showMessage(message: string): void {
    this.hud.message.textContent = message;
    this.hud.message.classList.remove('show');
    void this.hud.message.offsetWidth;
    this.hud.message.classList.add('show');
  }
}
