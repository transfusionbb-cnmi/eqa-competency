/* CNMI EQA PWA installer v2.4.1 */
(() => {
  'use strict';

  let deferredInstallPrompt = null;
  const installButton = document.getElementById('pwa-install-button');
  const guideBackdrop = document.getElementById('pwa-guide-backdrop');
  const guideContent = document.getElementById('pwa-guide-content');
  const guideTitle = document.getElementById('pwa-guide-title');
  const guideClose = document.getElementById('pwa-guide-close');
  const guideDone = document.getElementById('pwa-guide-done');

  const userAgent = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(userAgent);

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.navigator.standalone === true;
  }

  function updateInstallButton() {
    if (!installButton) return;
    const canShow = !isStandalone() && (isIOS || isAndroid || Boolean(deferredInstallPrompt));
    installButton.hidden = !canShow;
  }

  function closeGuide() {
    if (guideBackdrop) guideBackdrop.hidden = true;
  }

  function openGuide(platform) {
    if (!guideBackdrop || !guideContent || !guideTitle) return;

    if (platform === 'ios') {
      guideTitle.textContent = 'ติดตั้งบน iPhone / iPad';
      guideContent.innerHTML = `
        <p class="pwa-guide-lead">ใช้เวลาเพียง 3 ขั้นตอน</p>
        <ol class="pwa-install-steps">
          <li class="pwa-install-step"><span class="pwa-install-step-number">1</span><span>แตะปุ่ม <strong>แชร์</strong> ⬆️</span></li>
          <li class="pwa-install-step"><span class="pwa-install-step-number">2</span><span>เลือก <strong>เพิ่มไปยังหน้าจอโฮม</strong></span></li>
          <li class="pwa-install-step"><span class="pwa-install-step-number">3</span><span>แตะ <strong>เพิ่ม</strong></span></li>
        </ol>
        <p class="pwa-guide-note">เมื่อติดตั้งแล้ว ให้เปิดระบบจากไอคอน CNMI EQA บนหน้าจอโฮม</p>`;
    } else {
      guideTitle.textContent = 'ติดตั้งบน Android';
      guideContent.innerHTML = `
        <p class="pwa-guide-lead">เบราว์เซอร์ยังไม่เปิดหน้าต่างติดตั้งอัตโนมัติ</p>
        <ol class="pwa-install-steps">
          <li class="pwa-install-step"><span class="pwa-install-step-number">1</span><span>เปิดเมนู <strong>⋮</strong> ของ Chrome</span></li>
          <li class="pwa-install-step"><span class="pwa-install-step-number">2</span><span>เลือก <strong>ติดตั้งแอป</strong> หรือ <strong>เพิ่มไปยังหน้าจอหลัก</strong></span></li>
          <li class="pwa-install-step"><span class="pwa-install-step-number">3</span><span>แตะ <strong>ติดตั้ง</strong></span></li>
        </ol>`;
    }

    guideBackdrop.hidden = false;
    guideClose?.focus();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeGuide();
    updateInstallButton();
  });

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallButton);

  installButton?.addEventListener('click', async () => {
    if (isStandalone()) {
      updateInstallButton();
      return;
    }

    if (isIOS) {
      openGuide('ios');
      return;
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } finally {
        deferredInstallPrompt = null;
        updateInstallButton();
      }
      return;
    }

    openGuide('android');
  });

  guideClose?.addEventListener('click', closeGuide);
  guideDone?.addEventListener('click', closeGuide);
  guideBackdrop?.addEventListener('click', (event) => {
    if (event.target === guideBackdrop) closeGuide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && guideBackdrop && !guideBackdrop.hidden) closeGuide();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .catch((error) => console.warn('Service worker registration failed:', error));
    });
  }

  updateInstallButton();
})();
