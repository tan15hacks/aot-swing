import './style.css';
import { Game } from './game/Game';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="game-canvas" aria-label="Skyline Tether game canvas"></canvas>

  <div class="look-pad" data-control="look" aria-hidden="true"></div>

  <header class="top-hud">
    <div class="brand">SKYLINE <strong>TETHER</strong></div>
    <div class="hud-cluster">
      <div class="hud-card"><span>LEVEL</span><strong data-hud="level">1 / 3</strong></div>
      <div class="hud-card"><span>SCORE</span><strong data-hud="score">0</strong></div>
      <div class="hud-card"><span>SPEED</span><strong data-hud="speed">0 km/h</strong></div>
    </div>
  </header>

  <div class="energy-wrap" aria-label="Energy meter">
    <span>BOOST</span>
    <div class="energy-track"><div class="energy-fill"></div></div>
    <strong data-hud="energy">100%</strong>
  </div>

  <div class="reticle" data-hud="reticle"><span></span></div>
  <div class="message" data-hud="message">Level 1</div>

  <div class="touch-controls">
    <button class="control grapple left" data-control="grapple-left" aria-label="Hold and drag to aim the left tether">
      <strong>L</strong><span>LEFT TETHER</span>
    </button>

    <div class="joystick" data-control="joystick" aria-label="Movement joystick">
      <div class="joystick-knob" data-control="joystick-knob"></div>
    </div>

    <button class="control grapple right" data-control="grapple-right" aria-label="Hold and drag to aim the right tether">
      <strong>R</strong><span>RIGHT TETHER</span>
    </button>

    <div class="center-controls">
      <button class="control boost" data-control="boost">BOOST</button>
      <button class="control brake" data-control="brake">BRAKE</button>
      <button class="control reset" data-control="reset">RESET</button>
    </div>
  </div>

  <section class="start-overlay" data-ui="start-overlay">
    <div class="start-card">
      <p class="eyebrow">LOW-POLY FIRST-PERSON TRAVERSAL</p>
      <h1>Skyline Tether</h1>
      <p>Use two energy tethers to swing through the city, collect shards, avoid hazards, and reach the green exit ring.</p>
      <div class="instructions desktop-help">
        <span><b>Mouse</b> Look</span><span><b>L/R Click</b> Tethers</span><span><b>WASD</b> Move</span><span><b>Space</b> Boost</span><span><b>Shift</b> Brake</span>
      </div>
      <div class="instructions touch-help">
        <span><b>Left stick</b> Move</span><span><b>Swipe anywhere</b> Look</span><span><b>Hold + drag L/R</b> Aim tether</span><span><b>Boost</b> Accelerate</span>
      </div>
      <button class="start-button" data-ui="start">Start Run</button>
      <small>Tip: hold a tether button and drag that same thumb to keep aiming.</small>
    </div>
  </section>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Game canvas was not created.');
new Game(canvas);
