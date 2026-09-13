/* Shared binding for migrated, reviewed built-in lessons. */
(() => {
  'use strict';
  const config = window.LESSON_CONFIG;
  if (!config) return;
  window.MASTER_CONFIG = Object.freeze({UNIT_KEY:config.unitKey,LESSON_ID:config.lessonKey,LESSON_NAME:config.lessonName});
  window.MasterLessonRuntime = Object.freeze({
    preview:false, allowServerAction:() => true, previewIdentity:() => {},
    bind() {
      if (config.pageTitle) document.title=config.pageTitle;
      document.querySelectorAll('[data-ml-text]').forEach(el=>{el.textContent=config[el.dataset.mlText] || '';});
      document.querySelectorAll('[data-ml-tab]').forEach(el=>{el.textContent=(config.tabs || [])[Number(el.dataset.mlTab)] || '';});
      const root=document.getElementById('ctw-root');
      if(root){root.dataset.lesson=config.lessonKey;root.dataset.pdf=config.worksheetPath || '';}
      const title=document.getElementById('ctw-title');if(title && config.worksheetTitle)title.textContent=config.worksheetTitle;
      const banner=document.getElementById('ml-template-banner');if(banner)banner.hidden=true;
    }
  });
  document.addEventListener('DOMContentLoaded',()=>window.MasterLessonRuntime.bind(),{once:true});
})();
