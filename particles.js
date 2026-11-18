// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Project Nox Contributors & Awerkori

/**
 * Project Nox — Cosmic Snow & Stardust Particle System
 *
 * Reusable, zero-GC, 3-tier depth particle canvas with:
 * - Silver / cold-white (#F1F5F9, #DDE4F0, #CBD5E1, #E2D9F5) + cosmic violet & subtle gold
 * - Clamped delta-time physics (consistent across 30Hz–144Hz)
 * - Adaptive density & DPR cap + stable frame-time degradation
 * - Smooth mouse parallax & repulsion, passive touch reaction, and optional passive DeviceOrientation tilt
 * - Full pause / prefers-reduced-motion / hidden-tab suspension
 */

(function () {
  'use strict';

  // Precomputed zero-GC fill caches (alpha buckets 0..10)
  // Palettes: 268 (violet), 242 (indigo), 215 (silver-slate #CBD5E1/#DDE4F0), 42 (Nox gold)
  const FILL_CACHE_HALO = {
    268: Array.from({ length: 11 }, (_, i) => `hsla(268, 82%, 76%, ${((i / 10) * 0.24).toFixed(3)})`),
    242: Array.from({ length: 11 }, (_, i) => `hsla(242, 78%, 76%, ${((i / 10) * 0.22).toFixed(3)})`),
    215: Array.from({ length: 11 }, (_, i) => `rgba(226, 217, 245, ${((i / 10) * 0.24).toFixed(3)})`),
    42:  Array.from({ length: 11 }, (_, i) => `hsla(42, 75%, 68%, ${((i / 10) * 0.18).toFixed(3)})`)
  };

  const FILL_CACHE_MOTE = {
    268: Array.from({ length: 11 }, (_, i) => `hsla(268, 70%, 84%, ${((i / 10) * 0.82).toFixed(3)})`),
    242: Array.from({ length: 11 }, (_, i) => `hsla(242, 65%, 85%, ${((i / 10) * 0.78).toFixed(3)})`),
    215: Array.from({ length: 11 }, (_, i) => `rgba(221, 228, 240, ${((i / 10) * 0.88).toFixed(3)})`),
    42:  Array.from({ length: 11 }, (_, i) => `hsla(42, 70%, 72%, ${((i / 10) * 0.70).toFixed(3)})`)
  };

  const FILL_CACHE_STAR = {
    268: Array.from({ length: 11 }, (_, i) => `hsla(268, 45%, 86%, ${((i / 10) * 0.62).toFixed(3)})`),
    242: Array.from({ length: 11 }, (_, i) => `hsla(242, 42%, 86%, ${((i / 10) * 0.58).toFixed(3)})`),
    215: Array.from({ length: 11 }, (_, i) => `rgba(203, 213, 225, ${((i / 10) * 0.68).toFixed(3)})`),
    42:  Array.from({ length: 11 }, (_, i) => `hsla(42, 52%, 75%, ${((i / 10) * 0.50).toFixed(3)})`)
  };

  const FILL_CACHE_SILVER_CORE = Array.from(
    { length: 11 },
    (_, i) => `rgba(241, 245, 249, ${Math.min(1, (i / 10) * 0.96).toFixed(3)})`
  );

  function isMobile() {
    return window.innerWidth < 768;
  }

  function isLowEndDevice() {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    return cores <= 2 || memory <= 2;
  }

  function initParticleSystem() {
    const canvas = document.querySelector('.particle-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animId = null;
    let width = 0;
    let height = 0;
    let currentDpr = 1;
    let particles = [];
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    let userPaused = false;
    try {
      userPaused = localStorage.getItem('nox-tracker-animations-paused') === '1';
    } catch {
      userPaused = false;
    }
    let resizeTimer = null;
    let lastFrameTime = 0;
    let lastDrawTimestamp = 0;
    let degradedMode = false;
    let slowFrameWindow = [];

    // Interactive state (mouse, passive touch, optional passive orientation)
    let pointerX = -9999;
    let pointerY = -9999;
    let pointerActive = false;
    let targetTiltX = 0;
    let currentTiltX = 0;
    let hasTiltData = false;
    let targetParallaxX = 0;
    let targetParallaxY = 0;
    let currentParallaxX = 0;
    let currentParallaxY = 0;

    function computeTargetCount(mobile, lowEnd) {
      let base;
      if (mobile) {
        base = lowEnd ? 18 : 38;
      } else if (lowEnd) {
        base = 48;
      } else {
        // Scale gently with viewport area (between 85 and 115 on desktop)
        const areaFactor = Math.min(1.2, Math.max(0.85, (width * height) / (1440 * 900)));
        base = Math.round(95 * areaFactor);
      }
      return degradedMode ? Math.max(12, Math.round(base * 0.7)) : base;
    }

    function initSize() {
      const mobile = isMobile();
      const lowEnd = isLowEndDevice();
      currentDpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * currentDpr);
      canvas.height = Math.floor(height * currentDpr);
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

      const count = computeTargetCount(mobile, lowEnd);
      if (particles.length === 0 || Math.abs(particles.length - count) > 10) {
        particles = Array.from({ length: count }, (_, idx) => createParticle(true, mobile, idx, count));
      }
    }

    function createParticle(randomY, mobile, index = 0, total = 1) {
      // 3 depth tiers:
      // depth 0: distant micro stars (42%)
      // depth 1: mid-layer cosmic stardust motes (40%)
      // depth 2: foreground cosmic snow flakes (18%)
      const rand = Math.random();
      const depth = rand < 0.42 ? 0 : rand < 0.82 ? 1 : 2;

      let radius, baseAlpha, baseSpeedY;
      if (depth === 0) {
        radius = mobile ? 0.45 + Math.random() * 0.4 : 0.5 + Math.random() * 0.5;
        baseAlpha = 0.18 + Math.random() * 0.26;
        baseSpeedY = (mobile ? 0.10 : 0.14) + Math.random() * 0.16;
      } else if (depth === 1) {
        radius = mobile ? 0.8 + Math.random() * 0.5 : 0.9 + Math.random() * 0.65;
        baseAlpha = 0.36 + Math.random() * 0.32;
        baseSpeedY = (mobile ? 0.20 : 0.26) + Math.random() * 0.28;
      } else {
        radius = mobile ? 1.15 + Math.random() * 0.55 : 1.3 + Math.random() * 0.75;
        baseAlpha = 0.58 + Math.random() * 0.34;
        baseSpeedY = (mobile ? 0.32 : 0.40) + Math.random() * 0.36;
      }

      // Color mix: silver/cold-white (215), cosmic violet (268), indigo (242), subtle gold (42)
      const colorRoll = Math.random();
      const hue = colorRoll < 0.44 ? 215 : colorRoll < 0.78 ? 268 : colorRoll < 0.94 ? 242 : 42;

      const startX = total > 1 && randomY
        ? ((index / total) * width + (Math.random() - 0.5) * (width / total) * 1.6 + width) % width
        : Math.random() * width;

      return {
        x: startX,
        y: randomY ? Math.random() * height : -12 - Math.random() * 24,
        radius,
        alpha: baseAlpha,
        baseAlpha,
        speedY: baseSpeedY,
        speedX: 0,
        drift: (Math.random() - 0.5) * (depth === 0 ? 0.04 : depth === 1 ? 0.08 : 0.12),
        angle: Math.random() * Math.PI * 2,
        angleSpeed: 0.008 + Math.random() * 0.014,
        sway: (depth === 0 ? 0.10 : depth === 1 ? 0.22 : 0.36) * (0.8 + Math.random() * 0.4),
        hue,
        depth
      };
    }

    function renderFrame(dt = 1) {
      if (!ctx || width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      const mobile = isMobile();

      // Subtle cosmic cursor aura on desktop
      if (pointerActive && pointerX > -100 && pointerY > -100 && !mobile) {
        const auraRadius = 175;
        const aura = ctx.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, auraRadius);
        aura.addColorStop(0, 'rgba(139, 92, 246, 0.045)');
        aura.addColorStop(0.5, 'rgba(226, 217, 245, 0.018)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(pointerX, pointerY, auraRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      currentTiltX += (targetTiltX - currentTiltX) * Math.min(1, 0.06 * dt);

      if (pointerActive && pointerX > -100 && pointerY > -100) {
        const strength = mobile ? 0.010 : 0.018;
        targetParallaxX = (pointerX - width * 0.5) * strength;
        targetParallaxY = (pointerY - height * 0.5) * strength * 0.85;
      } else {
        targetParallaxX = 0;
        targetParallaxY = 0;
      }
      const lerp = Math.min(1, 0.055 * dt);
      currentParallaxX += (targetParallaxX - currentParallaxX) * lerp;
      currentParallaxY += (targetParallaxY - currentParallaxY) * lerp;

      const interactRadius = mobile ? 85 : 118;
      const interactRadiusSq = interactRadius * interactRadius;
      const velocityDecay = Math.pow(0.92, dt);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (!reducedMotion && !userPaused) {
          p.y += p.speedY * dt;
          p.angle += p.angleSpeed * dt;
          p.x += (Math.sin(p.angle) * p.sway + p.drift + currentTiltX * (p.depth + 1) * 0.35) * dt;

          p.x += p.speedX * dt;
          p.speedX *= velocityDecay;

          // Smooth pointer/touch repulsion
          if (pointerActive && pointerX > -100 && pointerY > -100) {
            const dx = p.x - pointerX;
            const dy = p.y - pointerY;
            const distSq = dx * dx + dy * dy;

            if (distSq < interactRadiusSq && distSq > 1) {
              const dist = Math.sqrt(distSq);
              const force = (1 - dist / interactRadius) * (p.depth === 2 ? 2.2 : p.depth === 1 ? 1.5 : 0.7) * (mobile ? 0.55 : 1);
              p.speedX += (dx / dist) * force * 0.35 * dt;
              p.y += (dy / dist) * force * 0.35 * dt;
            }
          }

          // Seamless wrapping
          if (p.y > height + 16) {
            p.y = -12 - Math.random() * 16;
            p.x = Math.random() * width;
            p.speedX = 0;
          }
          if (p.x < -16) p.x = width + 12;
          if (p.x > width + 16) p.x = -12;

          p.alpha = p.baseAlpha * (0.85 + Math.sin(p.angle * 1.8) * 0.22);
        }

        const drawX = p.x - currentParallaxX * (p.depth + 0.5) * 0.55;
        const drawY = p.y - currentParallaxY * (p.depth + 0.5) * 0.55;
        const aIdx = Math.min(10, Math.max(0, Math.round(p.alpha * 10)));

        if (p.depth === 2) {
          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius * 2.1, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_HALO[p.hue]?.[aIdx] || 'rgba(226, 217, 245, 0.16)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_SILVER_CORE[aIdx] || '#f1f5f9';
          ctx.fill();
        } else if (p.depth === 1) {
          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_MOTE[p.hue]?.[aIdx] || 'rgba(221, 228, 240, 0.55)';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = FILL_CACHE_STAR[p.hue]?.[aIdx] || 'rgba(203, 213, 225, 0.35)';
          ctx.fill();
        }
      }
    }

    function isAnimationBlocked() {
      return reducedMotion || userPaused || document.hidden;
    }

    function stopLoop() {
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }

    function startLoop() {
      if (isAnimationBlocked()) return;
      if (animId === null) {
        const now = performance.now();
        lastFrameTime = now;
        lastDrawTimestamp = now;
        animId = requestAnimationFrame(loop);
      }
    }

    function syncMotionClass() {
      const paused = reducedMotion || userPaused;
      document.documentElement.classList.toggle('animations-paused', paused);
    }

    function getTargetFps() {
      if (degradedMode || isMobile() || isLowEndDevice()) return 30;
      return 60;
    }

    function loop(timestamp) {
      if (isAnimationBlocked()) {
        animId = null;
        return;
      }

      const targetFps = getTargetFps();
      const targetInterval = 1000 / targetFps;
      const elapsed = timestamp - lastFrameTime;

      if (elapsed >= targetInterval - 1) {
        const rawDelta = timestamp - lastDrawTimestamp;
        lastDrawTimestamp = timestamp;
        lastFrameTime = timestamp - (elapsed % targetInterval);

        // Clamped delta-time (max 2.5x normal 60fps step) prevents jumps after tab switch
        const dt = Math.min(Math.max(rawDelta / 16.667, 0.2), 2.5);

        const renderStart = performance.now();
        renderFrame(dt);
        const renderCost = performance.now() - renderStart;

        // Stable performance sampling (24 frames) for graceful degradation
        if (!degradedMode) {
          slowFrameWindow.push(renderCost);
          if (slowFrameWindow.length >= 24) {
            const avgCost = slowFrameWindow.reduce((a, b) => a + b, 0) / slowFrameWindow.length;
            slowFrameWindow = [];
            if (avgCost > 14) {
              degradedMode = true;
              const targetCount = computeTargetCount(isMobile(), isLowEndDevice());
              if (particles.length > targetCount) {
                particles.length = targetCount;
              }
            }
          }
        }
      }

      animId = requestAnimationFrame(loop);
    }

    initSize();
    syncMotionClass();
    if (!isAnimationBlocked()) {
      renderFrame(1);
      startLoop();
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    function onMouseMove(e) {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerActive = true;
    }

    function onMouseLeave() {
      pointerActive = false;
      pointerX = -9999;
      pointerY = -9999;
    }

    function onTouchStartOrMove(e) {
      if (e.touches && e.touches.length > 0) {
        pointerX = e.touches[0].clientX;
        pointerY = e.touches[0].clientY;
        pointerActive = true;
      }
    }

    function onTouchEnd() {
      pointerActive = false;
    }

    let lastTiltTimestamp = 0;
    function onDeviceOrientation(e) {
      if (isAnimationBlocked()) return;
      const now = performance.now();
      if (now - lastTiltTimestamp < 60) return;
      lastTiltTimestamp = now;

      const isLandscape = window.innerWidth > window.innerHeight;
      const rawAxis = isLandscape ? e.beta : e.gamma;
      if (typeof rawAxis !== 'number' || isNaN(rawAxis)) return;

      hasTiltData = true;
      if (Math.abs(rawAxis) <= 2.5) {
        targetTiltX = 0;
        return;
      }
      const clamped = Math.max(-25, Math.min(25, rawAxis));
      targetTiltX = (clamped / 25) * 1.1;
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    }

    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        initSize();
        if (isAnimationBlocked()) {
          ctx.clearRect(0, 0, width, height);
        } else {
          startLoop();
        }
      }, 150);
    }

    function applyMotionState() {
      syncMotionClass();
      if (reducedMotion || userPaused) {
        stopLoop();
        ctx.clearRect(0, 0, width, height);
      } else {
        renderFrame(1);
        startLoop();
      }
    }

    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', (e) => {
        reducedMotion = e.matches;
        applyMotionState();
        window.dispatchEvent(new CustomEvent('nox:motion-change', { detail: { paused: reducedMotion || userPaused, reducedMotion } }));
      });
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave, { passive: true });
    window.addEventListener('touchstart', onTouchStartOrMove, { passive: true });
    window.addEventListener('touchmove', onTouchStartOrMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (typeof window.DeviceOrientationEvent !== 'undefined') {
      try {
        window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
      } catch {
        // Sensor unavailable or blocked
      }
    }

    window.__noxParticles = {
      pause() {
        userPaused = true;
        try { localStorage.setItem('nox-tracker-animations-paused', '1'); } catch {}
        applyMotionState();
      },
      resume() {
        userPaused = false;
        try { localStorage.setItem('nox-tracker-animations-paused', '0'); } catch {}
        applyMotionState();
      },
      toggle() {
        if (userPaused) this.resume();
        else this.pause();
        return this.isPaused();
      },
      isPaused() {
        return reducedMotion || userPaused;
      },
      isUserPaused() {
        return userPaused;
      },
      isReducedMotion() {
        return reducedMotion;
      },
      getMetrics() {
        return {
          count: particles.length,
          targetFps: getTargetFps(),
          dpr: currentDpr,
          animActive: animId !== null,
          degradedMode,
          hasTiltData,
          pointerActive
        };
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initParticleSystem);
  } else {
    initParticleSystem();
  }
})();
