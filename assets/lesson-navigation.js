/* Shared step display for student lessons and teacher previews. Permissions stay in the host. */
(() => {
  'use strict';
  function show(step) {
    if (!Number.isInteger(step) || step < 1 || step > 4) return false;
    document.querySelectorAll('.step-btn').forEach((button, index) => button.classList.toggle('active', index === step - 1));
    document.querySelectorAll('.step-content').forEach((section, index) => section.classList.toggle('active', index === step - 1));
    window.dispatchEvent(new CustomEvent('lesson-step-change', {detail: step}));
    window.scrollTo({top: 0, behavior: 'smooth'});
    return true;
  }
  window.ScienceLessonNavigation = Object.freeze({show});
})();
