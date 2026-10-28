/**
 * Project Nox Tracker - Particle Background System
 * Faithfully adapted from Project Nox Manga (ParticleBackground.svelte)
 * Optimized 3-tier cosmic snow / mote particle system with zero-GC cache
 */

(function () {
  'use strict';

  // Zero-GC color cache for high-frequency rendering loop
  const FILL_CACHE_HALO = {
    268: Array.from({ length: 11 }, (_, i) => `hsla(268, 80%, 75%, ${((i / 10) * 0.24).toFixed(3)})`),
    242: Array.from({ length: 11 }, (_, i) => `hsla(242, 80%, 75%, ${((i / 10) * 0.24).toFixed(3)})`),
    212: Array.from({ length: 11 }, (_, i) => `hsla(212, 80%, 75%, ${((i / 10) * 0.24).toFixed(3)})`),
    42:  Array.from({ length: 11 }, (_, i) => `hsla(42, 75%, 65%, ${((i / 10) * 0.22).toFixed(3)})`),
  };

  const FILL_CACHE_MOTE = {
    268: Array.from({ length: 11 }, (_, i) => `hsla(268, 65%, 85%, ${((i / 10) * 0.85).toFixed(3)})`),
    242: Array.from({ length: 11 }, (_, i) => `hsla(242, 65%, 85%, ${((i / 10) * 0.85).toFixed(3)})`),
    212: Array.from({ length: 11 }, (_, i) => `hsla(212, 65%, 85%, ${((i / 10) * 0.85).toFixed(3)})`),
    42:  Array.from({ length: 11 }, (_, i) => `hsla(42, 70%, 70%, ${((i / 10) * 0.75).toFixed(3)})`),
  };

  const FILL_CACHE_STAR = {
    268: Array.from({ length: 11 }, (_, i) => `hsla(268, 40%, 85%, ${((i / 10) * 0.65).toFixed(3)})`),
    242: Array.from({ length: 11 }, (_, i) => `hsla(242, 40%, 85%, ${((i / 10) * 0.65).toFixed(3)})`),
    212: Array.from({ length: 11 }, (_, i) => `hsla(212, 40%, 85%, ${((i / 10) * 0.65).toFixed(3)})`),
    42:  Array.from({ length: 11 }, (_, i) => `hsla(42, 50%, 75%, ${((i / 10) * 0.55).toFixed(3)})`),
  };

  const FILL_CACHE_WHITE = Array.from(
    { length: 11 },
    (_, i) => `rgba(255, 255, 255, ${Math.min(1, (i / 10) * 1.15).toFixed(3)})`
  );

  function isMobile() {
    return window.innerWidth < 768;
  }

  function isLowEndDevice() {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    const isFirefox = /Firefox/i.test(navigator.userAgent);
    return cores <= 2 || memory <= 2 || (isFirefox && isMobile());
  }

  function initParticleSystem() {
    const canvas = document.querySelector('.particle-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animId = null;
    let width = 0;
    let height = 0;
    let particles = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let isScrolling = false;
    let scrollTimeout = null;
    let resizeTimer = null;
    let lastFrameTime = 0;

    // Interactive tracking
    let mouseX = -9999;
    let mouseY = -9999;
    let targetTiltX = 0;
    let currentTiltX = 0;
    let targetParallaxX = 0;
    let targetParallaxY = 0;
    let currentParallaxX = 0;
    let currentParallaxY = 0;

    function initSize() {
      const mobile = isMobile();
      const lowEnd = isLowEndDevice();
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.0 : 1.25);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Adaptive particle density: 65 desktop, 16 mobile, 20 low-end
      const count = mobile ? 16 : lowEnd ? 20 : 65;

      if (particles.length === 0 || Math.abs(particles.length - count) > 10) {
        particles = Array.from({ length: count }, () => createParticle(true, mobile));
      }
    }

    function createParticle(randomY, mobile) {
      // 3 depth tiers for depth-of-field effect:
      // depth 0: small subtle background stars (45%)
      // depth 1: mid floating ambient motes (38%)
      // depth 2: refined foreground snowflakes (17%)
      const rand = Math.random();
      const depth = rand < 0.45 ? 0 : rand < 0.83 ? 1 : 2;

      let radius, baseAlpha, baseSpeedY;

      if (depth === 0) {
        radius = mobile ? 0.45 + Math.random() * 0.35 : 0.55 + Math.random() * 0.4;
        baseAlpha = 0.2 + Math.random() * 0.3;
        baseSpeedY = (mobile ? 0.09 : 0.13) + Math.random() * 0.14;
      } else if (depth === 1) {
        radius = mobile ? 0.75 + Math.random() * 0.45 : 0.85 + Math.random() * 0.55;
        baseAlpha = 0.35 + Math.random() * 0.3;
        baseSpeedY = (mobile ? 0.17 : 0.22) + Math.random() * 0.24;
      } else {
        radius = mobile ? 1.05 + Math.random() * 0.45 : 1.2 + Math.random() * 0.55;
        baseAlpha = 0.55 + Math.random() * 0.35;
        baseSpeedY = (mobile ? 0.26 : 0.32) + Math.random() * 0.32;
      }

      // Hues: Cosmic violet (268), indigo (242), frosty cyan (212), or subtle Nox gold accent (42)
      const colorRoll = Math.random();
      const hue = colorRoll < 0.45 ? 268 : colorRoll < 0.75 ? 242 : colorRoll < 0.92 ? 212 : 42;

      return {
        x: Math.random() * width,
        y: randomY ? Math.random() * height : -15,
        radius,
        alpha: baseAlpha,
        baseAlpha,
        speedY: baseSpeedY,
        baseSpeedY,
        speedX: 0,
        angle: Math.random() * Math.PI * 2,
        angleSpeed: 0.006 + Math.random() * 0.012,
        sway: (depth === 0 ? 0.1 : depth === 1 ? 0.2 : 0.34) * (0.8 + Math.random() * 0.4),
        hue,
        depth
      };
    }

    function renderFrame() {
      if (!ctx || width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      const mobile = isMobile();

      // Cosmic aura following cursor on desktop (zero blur cost, pure radial gradient)
      if (mouseX > -100 && mouseY > -100 && !mobile) {
        const auraRadius = 170;
        const aura = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, auraRadius);
        aura.addColorStop(0, 'rgba(139, 92, 246, 0.045)');
        aura.addColorStop(0.5, 'rgba(99, 102, 241, 0.018)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, auraRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Smooth mobile tilt interpolation
      currentTiltX += (targetTiltX - currentTiltX) * 0.05;

      // Subtle parallax interpolation
      if (mouseX > -100 && mouseY > -100 && !mobile) {
        targetParallaxX = (mouseX - width * 0.5) * 0.015;
        targetParallaxY = (mouseY - height * 0.5) * 0.012;
      } else {
        targetParallaxX = 0;
        targetParallaxY = 0;
      }
      currentParallaxX += (targetParallaxX - currentParallaxX) * 0.05;
      currentParallaxY += (targetParallaxY - currentParallaxY) * 0.05;

      const mouseRadius = 110;
      const mouseRadiusSq = mouseRadius * mouseRadius;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (!reducedMotion) {
          // Downward gravity with subtle wave
          p.y += p.speedY;
          p.angle += p.angleSpeed;
          p.x += Math.sin(p.angle) * p.sway + currentTiltX * (p.depth + 1) * 0.3;

          // Apply temporary interactive horizontal velocity decay
          p.x += p.speedX;
          p.speedX *= 0.92;

          // Smooth mouse interaction (repulsion & gentle swirl)
          if (mouseX > -100 && mouseY > -100 && !mobile) {
            const dx = p.x - mouseX;
            const dy = p.y - mouseY;
            const distSq = dx * dx + dy * dy;

            if (distSq < mouseRadiusSq && distSq > 1) {
              const dist = Math.sqrt(distSq);
              const force = (1 - dist / mouseRadius) * (p.depth === 2 ? 2.5 : p.depth === 1 ? 1.8 : 0.8);
              p.speedX += (dx / dist) * force;
              p.y += (dy / dist) * force * 0.5;
            }
          }

          // Boundary wrapping
          if (p.y > height + 15) {
            p.y = -10;
            p.x = Math.random() * width;
            p.speedX = 0;
          }
          if (p.x < -15) p.x = width + 10;
          if (p.x > width + 15) p.x = -10;

          // Gentle twinkling alpha
          p.alpha = p.baseAlpha * (0.85 + Math.sin(p.angle * 1.8) * 0.25);
        }

        // Apply subtle parallax offset based on depth
        const drawX = p.x + currentParallaxX * (p.depth + 0.4) * 0.5;
        const drawY = p.y + currentParallaxY * (p.depth + 0.4) * 0.5;

        // Draw particle with zero-allocation cached GPU fills
        const aIdx = Math.min(10, Math.max(0, Math.round(p.alpha * 10)));
        if (p.depth === 2) {
          // Foreground snowflakes: soft cosmic halo + luminous crisp core
          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius * 2.0, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_HALO[p.hue]?.[aIdx] || 'rgba(181, 154, 245, 0.15)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_WHITE[aIdx] || '#ffffff';
          ctx.fill();
        } else if (p.depth === 1) {
          // Mid motes: soft pastel star
          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_MOTE[p.hue]?.[aIdx] || 'rgba(168, 85, 247, 0.5)';
          ctx.fill();
        } else {
          // Background stars: tiny sharp points
          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_STAR[p.hue]?.[aIdx] || 'rgba(216, 180, 254, 0.3)';
          ctx.fill();
        }
      }
    }

    function loop(timestamp) {
      if (document.hidden) {
        animId = null;
        return;
      }

      const elapsed = timestamp - lastFrameTime;
      const targetFps = isMobile() || isLowEndDevice() ? 30 : 45;
      const targetInterval = 1000 / targetFps;

      if (elapsed >= targetInterval) {
        lastFrameTime = timestamp - (elapsed % targetInterval);
        renderFrame();
      }

      animId = requestAnimationFrame(loop);
    }

    initSize();
    if (!reducedMotion) {
      renderFrame();
      animId = requestAnimationFrame(loop);
    }

    function onMouseMove(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }

    function onMouseLeave() {
      mouseX = -9999;
      mouseY = -9999;
    }

    let lastTiltTimestamp = 0;
    function onDeviceOrientation(e) {
      const now = performance.now();
      if (now - lastTiltTimestamp < 80) return;
      lastTiltTimestamp = now;

      if (e.gamma !== null && Math.abs(e.gamma) > 1) {
        const clamped = Math.max(-30, Math.min(30, e.gamma));
        targetTiltX = (clamped / 30) * 1.2;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (animId !== null) {
          cancelAnimationFrame(animId);
          animId = null;
        }
      } else if (!reducedMotion && animId === null) {
        lastFrameTime = performance.now();
        animId = requestAnimationFrame(loop);
      }
    }

    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        initSize();
        if (!reducedMotion && animId === null && !document.hidden) {
          lastFrameTime = performance.now();
          animId = requestAnimationFrame(loop);
        }
      }, 150);
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (window.DeviceOrientationEvent) {
      try {
        window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
      } catch (e) {
        // Ignored
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initParticleSystem);
  } else {
    initParticleSystem();
  }
})();
