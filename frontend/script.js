/**
 * FlowMind AI — Landing Page Interactive Script
 * ================================================
 * Vanilla JS, no dependencies. Handles:
 *   • Smooth-scroll navigation & active-link highlighting
 *   • Mobile hamburger menu
 *   • Scroll-triggered fade/slide animations (Intersection Observer)
 *   • FAQ accordion
 *   • Workflow demo node animation loop
 *   • Pricing monthly ↔ annual toggle
 *   • Counter (count-up) animation
 *   • Typing / typewriter effect in hero
 *   • Subtle parallax mouse-follow on hero glow
 *   • Waitlist email form validation + feedback
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ──────────────────────────────────────────────
  // UTILITY HELPERS
  // ──────────────────────────────────────────────

  /** Debounce — returns a function that fires at most once per `wait` ms */
  function debounce(fn, wait = 15) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Safe querySelector — returns null without throwing */
  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  /** Safe querySelectorAll — always returns an array */
  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  // ──────────────────────────────────────────────
  // 1. SMOOTH SCROLL NAVIGATION
  // ──────────────────────────────────────────────

  const navbar = qs('.navbar');
  const navLinks = qsa('a[href^="#"]');
  const sections = qsa('section[id]');

  // Smooth scroll for every anchor link that points to an id
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = qs(targetId);
      if (!target) return;

      e.preventDefault();
      const navHeight = navbar ? navbar.offsetHeight : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight;

      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  // Active link highlighting + navbar .scrolled class
  function highlightNav() {
    if (!navbar) return;

    // Add/remove scrolled class for opaque background
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }

    // Determine which section is in view
    const scrollPos = window.scrollY + (navbar.offsetHeight || 80) + 40;
    let currentId = '';

    sections.forEach((section) => {
      if (section.offsetTop <= scrollPos) {
        currentId = section.getAttribute('id');
      }
    });

    // Update active class on nav links
    navLinks.forEach((link) => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${currentId}`) {
        link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', debounce(highlightNav, 10), { passive: true });
  highlightNav(); // initial call

  // ──────────────────────────────────────────────
  // 2. MOBILE MENU TOGGLE
  // ──────────────────────────────────────────────

  const mobileMenuBtn = qs('.mobile-menu-btn');
  const navLinksContainer = qs('.nav-links');

  if (mobileMenuBtn && navLinksContainer) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navLinksContainer.classList.toggle('open');
      mobileMenuBtn.classList.toggle('active', isOpen);
      mobileMenuBtn.setAttribute('aria-expanded', isOpen);
    });

    // Close on link click
    qsa('a', navLinksContainer).forEach((link) => {
      link.addEventListener('click', () => {
        navLinksContainer.classList.remove('open');
        mobileMenuBtn.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (
        navLinksContainer.classList.contains('open') &&
        !navLinksContainer.contains(e.target) &&
        !mobileMenuBtn.contains(e.target)
      ) {
        navLinksContainer.classList.remove('open');
        mobileMenuBtn.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ──────────────────────────────────────────────
  // 3. SCROLL ANIMATIONS (Intersection Observer)
  // ──────────────────────────────────────────────

  const animatedElements = qsa('.animate-on-scroll');

  if (animatedElements.length) {
    const scrollObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const el = entry.target;

          // Stagger children if the element is a grid/container
          const staggerSelectors = '.feature-card, .pricing-card, .testimonial-card, .step';
          const children = qsa(staggerSelectors, el);

          if (children.length) {
            children.forEach((child, i) => {
              child.style.transitionDelay = `${i * 120}ms`;
              child.classList.add('visible');
            });
          }

          el.classList.add('visible');
          scrollObserver.unobserve(el); // animate once
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px',
      }
    );

    animatedElements.forEach((el) => scrollObserver.observe(el));
  }

  // ──────────────────────────────────────────────
  // 4. FAQ ACCORDION
  // ──────────────────────────────────────────────

  const faqItems = qsa('.faq-item');

  faqItems.forEach((item) => {
    const question = qs('.faq-question', item);
    const answer = qs('.faq-answer', item);
    if (!question || !answer) return;

    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');

      // Close all other items first (only-one-open behaviour)
      faqItems.forEach((other) => {
        if (other === item) return;
        other.classList.remove('active');
        const otherAnswer = qs('.faq-answer', other);
        if (otherAnswer) {
          otherAnswer.style.maxHeight = null;
          otherAnswer.style.opacity = '0';
        }
      });

      // Toggle current item
      if (isActive) {
        item.classList.remove('active');
        answer.style.maxHeight = null;
        answer.style.opacity = '0';
      } else {
        item.classList.add('active');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        answer.style.opacity = '1';
      }
    });

    // Initialise: collapse all answers
    answer.style.maxHeight = null;
    answer.style.opacity = '0';
  });

  // ──────────────────────────────────────────────
  // 5. WORKFLOW DEMO ANIMATION
  // ──────────────────────────────────────────────

  const workflowDemo = qs('.workflow-demo');
  let workflowInterval = null;
  let workflowInView = false;

  function animateWorkflow() {
    if (!workflowDemo) return;

    const nodes = qsa('[data-step]', workflowDemo);
    const connectors = qsa('.connector, .workflow-connector, .connection-line', workflowDemo);
    if (!nodes.length) return;

    // Reset all
    nodes.forEach((n) => n.classList.remove('active'));
    connectors.forEach((c) => c.classList.remove('active'));

    // Activate sequentially with staggered delays
    nodes.forEach((node, i) => {
      setTimeout(() => {
        node.classList.add('active');

        // Activate the connector *after* the node (if any)
        if (connectors[i]) {
          setTimeout(() => connectors[i].classList.add('active'), 200);
        }
      }, i * 1200);
    });
  }

  function startWorkflowLoop() {
    if (workflowInterval || !workflowDemo) return;
    animateWorkflow();
    workflowInterval = setInterval(animateWorkflow, 6000);
  }

  function stopWorkflowLoop() {
    if (workflowInterval) {
      clearInterval(workflowInterval);
      workflowInterval = null;
    }
  }

  if (workflowDemo) {
    const workflowObserver = new IntersectionObserver(
      ([entry]) => {
        workflowInView = entry.isIntersecting;
        if (workflowInView) {
          startWorkflowLoop();
        } else {
          stopWorkflowLoop();
        }
      },
      { threshold: 0.2 }
    );
    workflowObserver.observe(workflowDemo);
  }

  // ──────────────────────────────────────────────
  // 6. PRICING TOGGLE (Monthly / Annual)
  // ──────────────────────────────────────────────

  const pricingToggle = qs('.pricing-toggle input, .pricing-toggle .toggle-switch, .billing-toggle');
  const monthlyLabel = qs('.monthly-label, [data-billing="monthly"]');
  const annualLabel = qs('.annual-label, [data-billing="annual"]');

  if (pricingToggle) {
    pricingToggle.addEventListener('change', handlePricingToggle);
    pricingToggle.addEventListener('click', handlePricingToggle);
  }

  function handlePricingToggle() {
    const isAnnual =
      pricingToggle.checked !== undefined ? pricingToggle.checked : pricingToggle.classList.toggle('annual');

    // Toggle active label styles
    if (monthlyLabel && annualLabel) {
      monthlyLabel.classList.toggle('active', !isAnnual);
      annualLabel.classList.toggle('active', isAnnual);
    }

    // Swap prices on all pricing cards
    qsa('.pricing-card').forEach((card) => {
      const priceEl = qs('.price, .pricing-amount, [data-monthly]', card);
      if (!priceEl) return;

      const monthly = priceEl.dataset.monthly || priceEl.textContent;
      const annual = priceEl.dataset.annual;

      if (!annual) {
        // Compute 20% discount from monthly
        const num = parseFloat(monthly.replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) {
          const discounted = (num * 0.8).toFixed(0);
          priceEl.dataset.monthly = monthly;
          priceEl.dataset.annual = monthly.replace(/[0-9.]+/, discounted);
        }
      }

      if (priceEl.dataset.monthly && priceEl.dataset.annual) {
        priceEl.textContent = isAnnual ? priceEl.dataset.annual : priceEl.dataset.monthly;
      }

      // Update billing period label
      const periodEl = qs('.period, .billing-period', card);
      if (periodEl) {
        periodEl.textContent = isAnnual ? '/year' : '/month';
      }
    });
  }

  // ──────────────────────────────────────────────
  // 7. COUNTER ANIMATION
  // ──────────────────────────────────────────────

  const counters = qsa('[data-count], .stat-number, .counter');

  if (counters.length) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          if (el.dataset.counted) return; // only once
          el.dataset.counted = 'true';

          const raw = el.dataset.count || el.textContent;
          const target = parseFloat(raw.replace(/[^0-9.]/g, ''));
          if (isNaN(target) || target === 0) return;

          // Preserve prefix/suffix (e.g. "$" or "+" or "%")
          const prefix = raw.match(/^[^0-9.]*/)?.[0] || '';
          const suffix = raw.match(/[^0-9.]*$/)?.[0] || '';
          const hasDecimal = raw.includes('.');
          const decimalPlaces = hasDecimal ? (raw.split('.')[1] || '').replace(/[^0-9]/g, '').length : 0;

          const duration = 2000; // ms
          const startTime = performance.now();

          function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = eased * target;

            el.textContent =
              prefix +
              (hasDecimal ? current.toFixed(decimalPlaces) : Math.floor(current).toLocaleString()) +
              suffix;

            if (progress < 1) {
              requestAnimationFrame(tick);
            } else {
              // Ensure exact final value
              el.textContent =
                prefix + (hasDecimal ? target.toFixed(decimalPlaces) : target.toLocaleString()) + suffix;
            }
          }

          requestAnimationFrame(tick);
          counterObserver.unobserve(el);
        });
      },
      { threshold: 0.3 }
    );

    counters.forEach((el) => counterObserver.observe(el));
  }

  // ──────────────────────────────────────────────
  // 8. TYPING EFFECT (Hero)
  // ──────────────────────────────────────────────

  const typingEl = qs('.typing-text');

  if (typingEl) {
    const phrases = [
      'customer support',
      'data processing',
      'content creation',
      'email management',
      'sales outreach',
    ];
    let phraseIdx = 0;
    let charIdx = 0;
    let isDeleting = false;
    const typeSpeed = 80;
    const deleteSpeed = 45;
    const pauseAfterType = 1800;
    const pauseAfterDelete = 400;

    function typeStep() {
      const current = phrases[phraseIdx];

      if (!isDeleting) {
        // Typing forward
        typingEl.textContent = current.slice(0, charIdx + 1);
        charIdx++;

        if (charIdx === current.length) {
          // Pause then start deleting
          isDeleting = true;
          setTimeout(typeStep, pauseAfterType);
          return;
        }
        setTimeout(typeStep, typeSpeed);
      } else {
        // Deleting
        typingEl.textContent = current.slice(0, charIdx - 1);
        charIdx--;

        if (charIdx === 0) {
          isDeleting = false;
          phraseIdx = (phraseIdx + 1) % phrases.length;
          setTimeout(typeStep, pauseAfterDelete);
          return;
        }
        setTimeout(typeStep, deleteSpeed);
      }
    }

    // Kick off
    typingEl.textContent = '';
    setTimeout(typeStep, 600);
  }

  // ──────────────────────────────────────────────
  // 9. PARALLAX / MOUSE-FOLLOW GLOW
  // ──────────────────────────────────────────────

  const hero = qs('.hero');
  const heroGlow = qs('.hero-glow, .hero .glow, .glow-effect');

  if (hero && heroGlow) {
    let mouseX = 0;
    let mouseY = 0;
    let currentX = 0;
    let currentY = 0;
    let rafId = null;

    hero.addEventListener(
      'mousemove',
      (e) => {
        const rect = hero.getBoundingClientRect();
        // Normalise to -1…+1 from centre
        mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

        if (!rafId) {
          rafId = requestAnimationFrame(updateGlow);
        }
      },
      { passive: true }
    );

    function updateGlow() {
      // Lerp towards target for smooth follow
      currentX += (mouseX - currentX) * 0.08;
      currentY += (mouseY - currentY) * 0.08;

      const maxShift = 30; // px
      heroGlow.style.transform = `translate(${currentX * maxShift}px, ${currentY * maxShift}px)`;

      // Keep animating while there's meaningful movement
      if (Math.abs(mouseX - currentX) > 0.001 || Math.abs(mouseY - currentY) > 0.001) {
        rafId = requestAnimationFrame(updateGlow);
      } else {
        rafId = null;
      }
    }

    // Reset when mouse leaves hero area
    hero.addEventListener(
      'mouseleave',
      () => {
        mouseX = 0;
        mouseY = 0;
        if (!rafId) rafId = requestAnimationFrame(updateGlow);
      },
      { passive: true }
    );
  }

  // ──────────────────────────────────────────────
  // 10. EMAIL / WAITLIST FORM
  // ──────────────────────────────────────────────

  const forms = qsa('form.waitlist-form, form.email-form, form.cta-form, .hero form, .cta-section form');

  forms.forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const emailInput = qs('input[type="email"], input[name="email"]', form);
      const submitBtn = qs('button[type="submit"], button, .btn', form);

      if (!emailInput) return;

      const email = emailInput.value.trim();

      // Basic RFC-ish email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(email)) {
        showFormMessage(form, 'Please enter a valid email address.', 'error');
        emailInput.focus();
        return;
      }

      // Loading state
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = 'Joining…';
        submitBtn.classList.add('loading');
      }

      // Simulate async request (replace with real fetch in production)
      setTimeout(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText;
          submitBtn.classList.remove('loading');
        }

        emailInput.value = '';
        showFormMessage(form, "You're on the list! We'll be in touch soon.", 'success');
      }, 1200);
    });
  });

  function showFormMessage(form, text, type) {
    // Remove existing message if any
    const existing = qs('.form-message', form);
    if (existing) existing.remove();

    const msg = document.createElement('p');
    msg.className = `form-message form-message--${type}`;
    msg.textContent = text;
    msg.setAttribute('role', 'alert');
    form.appendChild(msg);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      msg.classList.add('fade-out');
      setTimeout(() => msg.remove(), 400);
    }, 5000);
  }

  // ──────────────────────────────────────────────
  // BONUS: Keyboard accessibility for FAQ
  // ──────────────────────────────────────────────

  qsa('.faq-question').forEach((q) => {
    // Make focusable
    if (!q.getAttribute('tabindex')) q.setAttribute('tabindex', '0');
    q.setAttribute('role', 'button');

    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        q.click();
      }
    });
  });

  // ──────────────────────────────────────────────
  // DONE — all features initialised
  // ──────────────────────────────────────────────
  // console.log('FlowMind AI — script loaded');
});
