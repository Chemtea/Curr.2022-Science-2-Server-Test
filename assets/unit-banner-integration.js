/* Narrow extension of the existing lesson-unit card renderer. No other hub features are changed. */
(() => {
  'use strict';
  if (typeof createUnitCard !== 'function' || !window.ScienceUnitAppearance || window.ScienceUnitBannerIntegrated) return;
  const originalCard = createUnitCard;
  createUnitCard = function (key, unit) {
    const card = originalCard(key, unit);
    const appearance = window.ScienceUnitAppearance;
    // Keep production artwork until a teacher saves a customization.
    // Newly created units have no production theme to preserve.
    const customized = appearance.hasSaved(key) || unit.themeClass === 'theme-custom';
    if (customized) {
      appearance.decorateCard(card, key);
      const icon = card.querySelector('.unit-entry-icon');
      if (icon) icon.innerHTML = appearance.iconHTML(key);
    }
    const entry = customized && card.querySelector('.unit-entry-btn');
    if (entry && !unit.isLocked) {
      const image = document.createElement('span'); image.className = 'sua-inline-icon';
      image.innerHTML = appearance.iconHTML(key);
      const label = document.createElement('span');
      label.textContent = (card.querySelector('.unit-entry-title')?.textContent || '단원') + ' 입장하기 ➔';
      entry.replaceChildren(image, label);
    }
    if (window.ScienceContentManager?.canManage()) {
      const edit = document.createElement('button'); edit.type = 'button';
      edit.className = 'sua-card-edit'; edit.textContent = '문양·색상 변경';
      edit.setAttribute('aria-haspopup', 'dialog');
      edit.addEventListener('click', event => {
        event.stopPropagation(); window.ScienceContentManager.openUnitAppearance(key);
      });
      card.querySelector('.unit-entry-header')?.append(edit);
    }
    return card;
  };
  Object.defineProperty(window, 'ScienceUnitBannerIntegrated', {value: true});
})();
