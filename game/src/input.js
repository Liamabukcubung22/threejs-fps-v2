// input.js — keyboard, mouse and pointer lock. It only writes into
// G.input and fires discrete callbacks; the simulation owns what happens.
export function attachInput(G, canvas, cb) {
  const inp = G.input;
  const keyState = {};

  const updateMove = () => {
    inp.fwd = (keyState.KeyW || keyState.ArrowUp ? 1 : 0)
      - (keyState.KeyS || keyState.ArrowDown ? 1 : 0);
    inp.strafe = (keyState.KeyD ? 1 : 0) - (keyState.KeyA ? 1 : 0);
    inp.crouch = !!(keyState.KeyC || keyState.ControlLeft || keyState.ControlRight);
    inp.walk = !!keyState.ShiftLeft || !!keyState.ShiftRight;
    inp.turn = (keyState.ArrowLeft ? 1 : 0) - (keyState.ArrowRight ? 1 : 0);
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') updateMove();
      return;
    }
    keyState[e.code] = true;
    if (e.code === 'KeyR') inp.reload = true;
    if (e.code === 'KeyE') inp.use = true;
    if (e.code === 'KeyB') cb.onBuyToggle();
    if (e.code === 'Digit1') inp.slot = 1;
    if (e.code === 'Digit2') inp.slot = 2;
    if (e.code === 'Digit3') inp.slot = 3;
    if (e.code === 'Digit4' || e.code === 'KeyG') inp.grenadeKey = true;
    if (e.code === 'Enter' && G.matchOver) cb.onRestart();
    if (e.code === 'Escape') cb.onEscape();
    if (e.code === 'Space') e.preventDefault();
    updateMove();
  });
  window.addEventListener('keyup', (e) => {
    keyState[e.code] = false;
    if (e.code === 'KeyE') inp.use = false;
    if (e.code === 'KeyR') inp.reload = false;
    updateMove();
  });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keyState)) keyState[k] = false;
    inp.fire = false; inp.use = false;
    updateMove();
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas) {
      cb.onCanvasClick();
      return;
    }
    inp.fire = true;
    inp.fireEdge = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) inp.fire = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    inp.lookDX += e.movementX || 0;
    inp.lookDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    cb.onLockChange(document.pointerLockElement === canvas);
  });

  return {
    lock() { canvas.requestPointerLock(); },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    get locked() { return document.pointerLockElement === canvas; },
  };
}
