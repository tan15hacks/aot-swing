import * as THREE from 'three';

export type GrappleSide = 'left' | 'right';

export interface InputSnapshot {
  moveX: number;
  moveY: number;
  boost: boolean;
  brake: boolean;
  grappleLeft: boolean;
  grappleRight: boolean;
}

interface InputCallbacks {
  onLook: (deltaX: number, deltaY: number) => void;
  onReset: () => void;
}

export class InputController {
  private readonly keys = new Set<string>();
  private readonly lookPointers = new Map<number, THREE.Vector2>();
  private mouseLeft = false;
  private mouseRight = false;
  private touchLeft = false;
  private touchRight = false;
  private touchBoost = false;
  private touchBrake = false;
  private joystickPointer: number | null = null;
  private joystickCenter = new THREE.Vector2();
  private joystickValue = new THREE.Vector2();
  private joystickRadius = 42;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    this.bindDesktop();
    this.bindTouch();
  }

  public snapshot(): InputSnapshot {
    const keyboardX = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const keyboardY = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));

    return {
      moveX: THREE.MathUtils.clamp(keyboardX + this.joystickValue.x, -1, 1),
      moveY: THREE.MathUtils.clamp(keyboardY - this.joystickValue.y, -1, 1),
      boost: this.keys.has('Space') || this.touchBoost,
      brake: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBrake,
      grappleLeft: this.mouseLeft || this.touchLeft,
      grappleRight: this.mouseRight || this.touchRight,
    };
  }

  private bindDesktop(): void {
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'KeyR') this.callbacks.onReset();
      if (event.code === 'Space') event.preventDefault();
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });

    this.canvas.addEventListener('click', () => {
      if (!this.isTouchDevice()) void this.canvas.requestPointerLock();
    });

    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.callbacks.onLook(event.movementX, event.movementY);
      }
    });

    this.canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.mouseLeft = true;
      if (event.button === 2) this.mouseRight = true;
    });

    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mouseLeft = false;
      if (event.button === 2) this.mouseRight = false;
    });

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseLeft = false;
      this.mouseRight = false;
      this.touchLeft = false;
      this.touchRight = false;
      this.touchBoost = false;
      this.touchBrake = false;
      this.lookPointers.clear();
      this.joystickValue.set(0, 0);
    });
  }

  private bindTouch(): void {
    const joystick = document.querySelector<HTMLElement>('[data-control="joystick"]');
    const knob = document.querySelector<HTMLElement>('[data-control="joystick-knob"]');
    const lookPad = document.querySelector<HTMLElement>('[data-control="look"]');

    this.bindAimHold('[data-control="grapple-left"]', (active) => {
      this.touchLeft = active;
    });
    this.bindAimHold('[data-control="grapple-right"]', (active) => {
      this.touchRight = active;
    });
    this.bindHold('[data-control="boost"]', (active) => {
      this.touchBoost = active;
    });
    this.bindHold('[data-control="brake"]', (active) => {
      this.touchBrake = active;
    });

    document.querySelector<HTMLElement>('[data-control="reset"]')?.addEventListener('click', () => {
      this.callbacks.onReset();
    });

    joystick?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.joystickPointer !== null) return;
      this.joystickPointer = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      const rect = joystick.getBoundingClientRect();
      this.joystickCenter.set(rect.left + rect.width / 2, rect.top + rect.height / 2);
      this.joystickRadius = Math.max(32, rect.width * 0.36);
      this.updateJoystick(event.clientX, event.clientY, knob);
    });

    joystick?.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.joystickPointer) return;
      event.preventDefault();
      this.updateJoystick(event.clientX, event.clientY, knob);
    });

    const releaseJoystick = (event: PointerEvent): void => {
      if (event.pointerId !== this.joystickPointer) return;
      event.preventDefault();
      this.joystickPointer = null;
      this.joystickValue.set(0, 0);
      if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
    };
    joystick?.addEventListener('pointerup', releaseJoystick);
    joystick?.addEventListener('pointercancel', releaseJoystick);

    lookPad?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      lookPad.setPointerCapture(event.pointerId);
      this.beginLook(event);
    });

    lookPad?.addEventListener('pointermove', (event) => {
      event.preventDefault();
      this.moveLook(event);
    });

    const releaseLook = (event: PointerEvent): void => {
      event.preventDefault();
      this.endLook(event.pointerId);
    };
    lookPad?.addEventListener('pointerup', releaseLook);
    lookPad?.addEventListener('pointercancel', releaseLook);
  }

  private bindAimHold(selector: string, setter: (active: boolean) => void): void {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    const activePointers = new Set<number>();

    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      activePointers.add(event.pointerId);
      setter(true);
      element.classList.add('is-active');
      this.beginLook(event);
    });

    element.addEventListener('pointermove', (event) => {
      if (!activePointers.has(event.pointerId)) return;
      event.preventDefault();
      this.moveLook(event);
    });

    const end = (event: PointerEvent): void => {
      if (!activePointers.has(event.pointerId)) return;
      event.preventDefault();
      activePointers.delete(event.pointerId);
      this.endLook(event.pointerId);
      setter(activePointers.size > 0);
      if (activePointers.size === 0) element.classList.remove('is-active');
    };

    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  }

  private bindHold(selector: string, setter: (active: boolean) => void): void {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    const activePointers = new Set<number>();

    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      activePointers.add(event.pointerId);
      setter(true);
      element.classList.add('is-active');
    });

    const end = (event: PointerEvent): void => {
      if (!activePointers.has(event.pointerId)) return;
      event.preventDefault();
      activePointers.delete(event.pointerId);
      setter(activePointers.size > 0);
      if (activePointers.size === 0) element.classList.remove('is-active');
    };

    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  }

  private beginLook(event: PointerEvent): void {
    this.lookPointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
  }

  private moveLook(event: PointerEvent): void {
    const previous = this.lookPointers.get(event.pointerId);
    if (!previous) return;

    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    previous.set(event.clientX, event.clientY);

    // Touch receives extra gain so a comfortable thumb swipe can turn quickly.
    this.callbacks.onLook(deltaX * 1.45, deltaY * 1.45);
  }

  private endLook(pointerId: number): void {
    this.lookPointers.delete(pointerId);
  }

  private updateJoystick(x: number, y: number, knob: HTMLElement | null): void {
    const delta = new THREE.Vector2(x - this.joystickCenter.x, y - this.joystickCenter.y);
    if (delta.length() > this.joystickRadius) delta.setLength(this.joystickRadius);
    this.joystickValue.copy(delta).divideScalar(this.joystickRadius);
    if (knob) knob.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`;
  }

  private isTouchDevice(): boolean {
    return matchMedia('(pointer: coarse)').matches;
  }
}
