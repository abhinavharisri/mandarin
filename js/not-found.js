/* ===== 404 page (404.html) =====
   Shows the address that was not found, and points the compass needle at the
   cursor (or the "Take Me Home" button) so it feels like it is searching. */
(() => {
  const path = document.querySelector('[data-lost-path]');
  if (path && location.pathname !== '/404' && location.pathname !== '/404.html') {
    const shown = decodeURIComponent(location.pathname).slice(0, 80);
    path.textContent = `mandarinorchid.in${shown}`;
  }

  const compass = document.querySelector('[data-compass]');
  const needle = document.querySelector('[data-needle]');
  const home = document.querySelector('[data-home-link]');
  if (!compass || !needle) return;

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let angle = 0;
  let target = 0;
  let pointingHome = false;

  const angleTo = (x, y) => {
    const box = compass.getBoundingClientRect();
    const dx = x - (box.left + box.width / 2);
    const dy = y - (box.top + box.height / 2);
    return (Math.atan2(dy, dx) * 180) / Math.PI + 90; // 0° is north (up)
  };

  // Ease the needle towards its target, always turning the short way round.
  const tick = () => {
    const delta = ((target - angle + 540) % 360) - 180;
    angle += delta * 0.12;
    needle.setAttribute('transform', `rotate(${angle.toFixed(2)} 60 60)`);
    requestAnimationFrame(tick);
  };

  if (calm) {
    needle.setAttribute('transform', 'rotate(35 60 60)');
    return;
  }

  window.addEventListener('pointermove', event => {
    if (!pointingHome && event.pointerType === 'mouse') target = angleTo(event.clientX, event.clientY);
  }, { passive: true });

  if (home) {
    const pointHome = () => {
      pointingHome = true;
      const box = home.getBoundingClientRect();
      target = angleTo(box.left + box.width / 2, box.top + box.height / 2);
    };
    home.addEventListener('mouseenter', pointHome);
    home.addEventListener('focus', pointHome);
    home.addEventListener('mouseleave', () => { pointingHome = false; });
    home.addEventListener('blur', () => { pointingHome = false; });
  }

  // Without a mouse (phones), the needle searches by itself.
  let searching = !window.matchMedia('(hover: hover)').matches;
  window.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') searching = false; }, { once: true, passive: true });
  const wander = () => {
    if (searching && !pointingHome) target = angle + (Math.random() * 160 - 80);
    setTimeout(wander, 1400 + Math.random() * 900);
  };

  target = 200; // an opening spin, as if it has just lost its bearings
  wander();
  requestAnimationFrame(tick);
})();
