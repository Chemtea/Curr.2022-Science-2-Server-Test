(function () {
  'use strict';

  // Original unit illustrations. Only this fixed catalogue may supply SVG markup.
  // Labels are rendered by the caller so icons work at both menu and banner sizes.
  const drawings = [
    ['car', '자동차', '<path d="M8 23 12 13h24l4 10M7 23h34v13H7zM12 23h24M18 13v10M30 13v10"/><path d="M11 36v4h7v-4m12 0v4h7v-4M12 29h5m14 0h5"/>'],
    ['element', '원소', '<circle cx="24" cy="24" r="3" fill="currentColor"/><ellipse cx="24" cy="24" rx="19" ry="7"/><ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(120 24 24)"/>'],
    ['flask', '삼각플라스크', '<path d="M18 5h12m-10 0v14L8 39q-2 4 3 4h26q5 0 3-4L28 19V5M14 29h20"/><circle cx="21" cy="35" r="1.4" fill="currentColor"/><circle cx="29" cy="38" r="1.1" fill="currentColor"/>'],
    ['galaxy', '은하', '<path d="M25 24c-4-3-8 1-5 4 5 5 14-1 13-8-1-10-17-14-23-4-7 11 4 24 18 22M23 24c4 3 8-1 5-4-5-5-14 1-13 8 1 10 17 14 23 4 7-11-4-24-18-22"/><circle cx="24" cy="24" r="2" fill="currentColor"/>'],
    ['sun', '태양', '<circle cx="24" cy="24" r="10"/><path d="M24 3v6m0 30v6M3 24h6m30 0h6M9 9l4 4m22 22 4 4M9 39l4-4m22-22 4-4"/>'],
    ['earth', '지구', '<circle cx="24" cy="24" r="19"/><path d="m12 9 8 4-1 7-6 2 2 7 6 2 2 10M30 7l-3 6 5 5 7 1 3 5M34 28l-7-2-3 6 5 6 6-3z"/>'],
    ['lightning', '번개', '<path d="M28 3 9 27h13l-3 18 20-27H26z" fill="currentColor" stroke="none"/>'],
    ['light', '빛', '<path d="m25 10-12 27h27zM4 22h16m9 3 15-7M32 30h12M35 35l9 7"/><path d="m8 18 4 4-4 4"/>'],
    ['star', '별', '<path d="m24 4 6 13 14 2-10 10 2 15-12-7-12 7 2-15L4 19l14-2z"/>'],
    ['space', '우주', '<circle cx="24" cy="26" r="11"/><path d="M14 21C4 23 1 28 4 31c4 5 20 4 32-2 9-5 12-9 8-12-2-1-6-1-11 0M37 4v6m-3-3h6M9 8v4m-2-2h4"/>'],
    ['compound', '화합물', '<path d="m20 18-7-6m15 6 7-6M18 28l-6 7m18-7 6 7"/><circle cx="24" cy="24" r="8"/><circle cx="9" cy="8" r="5"/><circle cx="39" cy="8" r="5"/><circle cx="9" cy="39" r="5"/><circle cx="39" cy="39" r="5"/>'],
    ['matter', '물질', '<path d="m24 4 18 10v20L24 44 6 34V14zM6 14l18 10 18-10M24 24v20M15 9l18 10m-18 0 18-10M15 19v20m18-20v20M6 24l18 10 18-10"/>'],
    ['flower', '꽃', '<path d="M24 31v13m0-4c-7 0-11-3-12-8 6-1 10 2 12 6m0-3c6 0 10-3 11-7-5-1-9 2-11 5M19 15c-8-8 3-17 6-7 5-8 15-1 8 7 11 2 6 14-3 10 0 11-13 11-13 0-10 4-15-9-4-11z"/><circle cx="24" cy="19" r="5"/>'],
    ['animal', '동물', '<path d="M15 23c3-6 15-6 18 0l5 8c4 9-5 14-11 10-2-2-4-2-6 0-6 4-15-1-11-10z"/><ellipse cx="8" cy="18" rx="4" ry="6" transform="rotate(-25 8 18)"/><ellipse cx="18" cy="9" rx="4" ry="6" transform="rotate(-10 18 9)"/><ellipse cx="30" cy="9" rx="4" ry="6" transform="rotate(10 30 9)"/><ellipse cx="40" cy="18" rx="4" ry="6" transform="rotate(25 40 18)"/>'],
    ['cell', '세포', '<path d="M43 24c1 12-8 20-21 19C8 42 3 35 5 24 4 12 12 4 24 5c12-1 20 7 19 19z"/><circle cx="24" cy="24" r="8"/><circle cx="26" cy="23" r="2" fill="currentColor"/><path d="M12 17q4-6 7-5m10 24q5 0 7-4M10 29l2 2m22-15 2 2"/>'],
    ['leaf', '나뭇잎', '<path d="M10 37C-1 12 18 6 42 5c-1 24-11 39-29 31M5 43 34 14M15 33l-1-12m9 4 11 1M24 24l-1-10"/>'],
    ['tree', '나무', '<path d="M20 31v12h8V31M11 32c-8 0-10-10-4-14-3-6 3-13 9-11 3-7 14-7 17 0 8-1 13 7 9 13 6 7 0 15-8 12M24 33V18m0 10-8-7m8 4 9-8M15 44h18"/>'],
    ['computer', '컴퓨터', '<rect x="5" y="6" width="38" height="28" rx="3"/><path d="M5 28h38M20 34v7m8-7v7M14 42h20M19 13l-5 5 5 5m10-10 5 5-5 5"/>'],
    ['book', '책', '<path d="M24 12c-6-5-12-6-20-4v31c8-2 14-1 20 4 6-5 12-6 20-4V8c-8-2-14-1-20 4v31M10 16c3 0 6 1 9 3m-9 5c3 0 6 1 9 3m10-8c3-2 6-3 9-3m-9 11c3-2 6-3 9-3"/>'],
    ['magnet', '자석', '<path d="M6 5h11v20a7 7 0 0 0 14 0V5h11v20a18 18 0 0 1-36 0zM6 15h11m14 0h11"/>'],
    ['wave', '파동', '<path d="M3 24h42M3 24c7 0 3-15 10-15s4 30 11 30 4-30 11-30 3 15 10 15"/>']
  ];

  const byId = new Map();
  const all = Object.freeze(drawings.map(([id, label, body]) => {
    const icon = Object.freeze({
      id,
      label,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>'
    });
    byId.set(id, icon);
    return icon;
  }));

  window.ScienceUnitIcons = Object.freeze({
    all,
    get(id) { return byId.get(id); }
  });
})();
