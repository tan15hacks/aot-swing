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
  private mouseLeft = false;
  private mouseRight = false;
  private touchLeft = false;
  private touchRight = false;
  private touchBoost = false;
  private touchBrake = false;
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookLast = new THREE.Vector2();
  private joystickCenter = new THREE.Vector2();
  private joystickValue = new THREE.Vector2();

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
    });
  }

  private bindTouch(): void {
    const joystick = document.querySelector<HTMLElement>('[data-control="joystick"]');
    const knob = document.querySelector<HTMLElement>('[data-control="joystick-knob"]');
    const lookPad = document.querySelector<HTMLElement>('[data-control="look"]');

    const setHold = (selector: string, setter: (active: boolean) => void): void => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return;
      const begin = (event: PointerEvent): void => {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        setter(true);
        element.classList.add('is-active');
      };
      const end = (event: PointerEvent): void => {
        event.preventDefault();
        setter(false);
        element.classList.remove('is-active');
      };
      element.addEventListener('pointerdown', begin);
      element.addEventListener('pointerup', end);
      element.addEventListener('pointercancel', end);
      element.addEventListener('pointerleave', (event) => {
        if (event.buttons === 0) end(event);
      });
    };

    setHold('[data-control="grapple-left"]', (active) => (this.touchLeft = active));
    setHold('[data-control="grapple-right"]', (active) => (this.touchRight = active));
    setHold('[data-control="boost"]', (active) => (this.touchBoost = active));
    setHold('[data-control="brake"]', (active) => (this.touchBrake = active));

    document.querySelector<HTMLElement>('[data-control="reset"]')?.addEventListener('click', () => {
      this.callbacks.onReset();
    });

    joystick?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.joystickPointer = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      const rect = joystick.getBoundingClientRect();
      this.joystickCenter.set(rect.left + rect.width / 2, rect.top + rect.height / 2);
      this.updateJoystick(event.clientX, event.clientY, knob);
    });

    joystick?.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.joystickPointer) return;
      event.preventDefault();
      this.updateJoystick(event.clientX, event.clientY, knob);
    });

    const releaseJoystick = (event: PointerEvent): void => {
      if (event.pointerId !== this.joystickPointer) return;
      this.joystickPointer = null;
      this.joystickValue.set(0, 0);
      if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
    };
    joystick?.addEventListener('pointerup', releaseJoystick);
    joystick?.addEventListener('pointercancel', releaseJoystick);

    lookPad?.addEventListener('pointerdown', (event) => {
      if (this.lookPointer !== null) return;
      event.preventDefault();
      this.lookPointer = event.pointerId;
      this.lookLast.set(event.clientX, event.clientY);
      lookPad.setPointerCapture(event.pointerId);
    });

    lookPad?.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.lookPointer) return;
      event.preventDefault();
      const deltaX = event.clientX - this.lookLast.x;
      const deltaY = event.clientY - this.lookLast.y;
      this.lookLast.set(event.clientX, event.clientY);
      this.callbacks.onLook(deltaX * 0.72, deltaY * 0.72);
    });

    const releaseLook = (event: PointerEvent): void => {
      if (event.pointerId === this.lookPointer) this.lookPointer = null;
    };
    lookPad?.addEventListener('pointerup', releaseLook);
    lookPad?.addEventListener('pointercancel', releaseLook);
  }

  private updateJoystick(x: number, y: number, knob: HTMLElement | null): void {
    const delta = new THREE.Vector2(x - this.joystickCenter.x, y - this.joystickCenter.y);
    const radius = 42;
    if (delta.length() > radius) delta.setLength(radius);
    this.joystickValue.copy(delta).divideScalar(radius);
    if (knob) knob.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`;
  }

  private isTouchDevice(): boolean {
    return matchMedia('(pointer: coarse)').matches;
  }
}
