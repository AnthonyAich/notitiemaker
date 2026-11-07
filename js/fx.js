// Kleine effecten die niets aan de inhoud veranderen.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Een pufje confetti vanuit een element, binnen een gegeven container.
export function confetti(container, fromEl, colors) {
  if (reduced()) return;
  const c = container.getBoundingClientRect();
  const r = fromEl.getBoundingClientRect();
  const ox = r.left + r.width / 2 - c.left;
  const oy = r.top + Math.min(r.height / 2, 60) - c.top;
  const palette = colors.concat(['#ffffff', '#1e88e5', '#f03e3e', '#40c057']);

  for (let i = 0; i < 46; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    const w = 6 + Math.random() * 6;
    p.style.cssText = `left:${ox}px;top:${oy}px;width:${w}px;height:${w * (0.4 + Math.random() * 0.6)}px;background:${palette[i % palette.length]}`;
    container.append(p);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 120 + Math.random() * 220;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;
    const spin = (Math.random() - 0.5) * 900;
    p.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.8}px), calc(-50% + ${dy * 0.8}px)) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 260}px)) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
  }
}
