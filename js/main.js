/* =================================================================
   Ryan Novak — ryannovak.net
   Main script: nav, reveal animations, stat counters, mobile menu
   ================================================================= */

(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Scroll-aware nav
  // ---------------------------------------------------------------
  const nav = document.querySelector('.nav');
  let lastScroll = 0;
  const onScroll = () => {
    const y = window.scrollY;
    if (y > 10) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
    lastScroll = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------------------------------------------------------------
  // Mobile menu
  // ---------------------------------------------------------------
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.nav-links');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.toggle('open');
      toggle.setAttribute(
        'aria-expanded',
        menu.classList.contains('open') ? 'true' : 'false'
      );
    });
    // close on link tap
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => menu.classList.remove('open'));
    });
  }

  // ---------------------------------------------------------------
  // Reveal on scroll (IntersectionObserver)
  // ---------------------------------------------------------------
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  if (!reducedMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else {
    document
      .querySelectorAll('.reveal')
      .forEach(el => el.classList.add('visible'));
  }

  // ---------------------------------------------------------------
  // Animated stat counters
  // ---------------------------------------------------------------
  const formatNum = (n, target) => {
    // Preserve comma separators
    if (target >= 1000) return Math.round(n).toLocaleString('en-US');
    return Math.round(n).toString();
  };

  const animateCounter = el => {
    const target = parseFloat(el.dataset.target);
    if (!target || isNaN(target)) return;
    if (reducedMotion) {
      el.textContent = formatNum(target, target);
      return;
    }
    const duration = 1400;
    const start = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatNum(target * eased, target);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = formatNum(target, target);
    };
    requestAnimationFrame(tick);
  };

  const statEls = document.querySelectorAll('[data-target]');
  if (statEls.length && 'IntersectionObserver' in window) {
    const statIO = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            animateCounter(e.target);
            statIO.unobserve(e.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    statEls.forEach(el => statIO.observe(el));
  } else {
    statEls.forEach(el => animateCounter(el));
  }

  // ---------------------------------------------------------------
  // Dynamic year in footer
  // ---------------------------------------------------------------
  const yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
