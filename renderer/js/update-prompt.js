/* update-prompt.js
 *
 * User-consent flow for packaged-app updates. A newly available release is
 * queued behind any existing modal, then moves through available, downloading,
 * downloaded, and error states without stacking dialogs.
 */
(function () {
  'use strict';

  const T = (key, fallback) => (window.I18N?.t ? window.I18N.t(key, fallback) : fallback);

  let backdrop = null;
  let updateState = null;
  let wantsPrompt = false;
  let flowActive = false;
  let declinedVersion = null;
  let previousFocus = null;
  let renderedStatus = null;
  let rootObserver = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function versionText() {
    return updateState?.version ? `v${updateState.version}` : '';
  }

  function ensureRootObserver() {
    if (rootObserver || typeof MutationObserver !== 'function') return;
    const root = document.getElementById('modal-root');
    if (!root) return;
    rootObserver = new MutationObserver(() => tryOpen());
    rootObserver.observe(root, { childList: true });
  }

  function canOpen(root) {
    return !!(
      root &&
      wantsPrompt &&
      !backdrop &&
      root.childElementCount === 0
    );
  }

  function titleText(status) {
    const version = versionText();
    if (status === 'available') {
      return version
        ? T('update_prompt.available_title', '새 버전 N이 있습니다').replace('N', version)
        : T('update_prompt.available_title_unknown', '새 버전이 있습니다');
    }
    if (status === 'downloading') {
      return T('update_prompt.downloading_title', '업데이트 다운로드 중');
    }
    if (status === 'checking') {
      return T('update_prompt.checking_title', '업데이트 확인 중');
    }
    if (status === 'downloaded') {
      return T('update_prompt.downloaded_title', '업데이트 준비 완료');
    }
    return T('update_prompt.error_title', '업데이트할 수 없습니다');
  }

  function descriptionText(status) {
    if (status === 'available') {
      return T(
        'update_prompt.available_description',
        '지금 다운로드할까요? 다운로드가 끝나면 재시작 시점을 선택할 수 있습니다.'
      );
    }
    if (status === 'downloading') {
      return T(
        'update_prompt.downloading_description',
        '앱을 계속 사용할 수 있습니다. 완료되면 재시작 전에 다시 알려드립니다.'
      );
    }
    if (status === 'checking') {
      return T('update_prompt.checking_description', '사용 가능한 새 버전을 확인하고 있습니다.');
    }
    if (status === 'downloaded') {
      const version = versionText();
      return version
        ? T(
            'update_prompt.downloaded_description',
            '앱을 재시작하면 N 업데이트가 설치됩니다.'
          ).replace('N', version)
        : T(
            'update_prompt.downloaded_description_unknown',
            '앱을 재시작하면 업데이트가 설치됩니다.'
          );
    }
    return updateState?.message ||
      T('update_prompt.error_description', '업데이트를 확인하거나 다운로드하지 못했습니다.');
  }

  function updateProgress() {
    if (!backdrop || updateState?.status !== 'downloading') return;
    const raw = Number(updateState.percent);
    const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    const progress = backdrop.querySelector('.update-prompt-progress');
    const fill = backdrop.querySelector('.update-prompt-progress-fill');
    const value = backdrop.querySelector('.update-prompt-progress-value');
    if (progress) progress.setAttribute('aria-valuenow', String(Math.round(percent)));
    if (fill) fill.style.width = `${percent}%`;
    if (value) {
      value.textContent = T('update_prompt.progress', 'N% 다운로드됨')
        .replace('N', String(Math.round(percent)));
    }
  }

  function makeButton(className, label, handler, disabled = false) {
    const button = el('button', className, label);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', handler);
    return button;
  }

  function render({ focusPrimary = false } = {}) {
    if (!backdrop || !updateState) return;
    const status = updateState.status;
    renderedStatus = status;
    backdrop.textContent = '';

    const modal = el('div', 'modal modal-update-prompt');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'update-prompt-title');
    modal.setAttribute('aria-describedby', 'update-prompt-description');
    modal.setAttribute('aria-busy', status === 'downloading' ? 'true' : 'false');

    const title = el('div', 'modal-title update-prompt-title', titleText(status));
    title.id = 'update-prompt-title';
    const body = el('div', 'modal-body update-prompt-body');
    const description = el('p', 'update-prompt-description', descriptionText(status));
    description.id = 'update-prompt-description';
    body.appendChild(description);

    if (status === 'downloading') {
      const progress = el('div', 'update-prompt-progress');
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', '100');
      progress.appendChild(el('span', 'update-prompt-progress-fill'));
      const progressValue = el('p', 'update-prompt-progress-value');
      progressValue.setAttribute('role', 'status');
      progressValue.setAttribute('aria-live', 'polite');
      body.append(progress, progressValue);
    }

    const actions = el('div', 'modal-actions update-prompt-actions');
    let secondary;
    let primary = null;

    if (status === 'available') {
      secondary = makeButton(
        'btn btn-ghost',
        T('update_prompt.later', '나중에'),
        () => deferCurrentVersion()
      );
      primary = makeButton(
        'btn btn-primary',
        T('update_prompt.update', '업데이트'),
        () => void startDownload()
      );
    } else if (status === 'downloading') {
      secondary = makeButton(
        'btn btn-ghost',
        T('update_prompt.background', '백그라운드에서 계속'),
        () => close()
      );
    } else if (status === 'downloaded') {
      secondary = makeButton(
        'btn btn-ghost',
        T('update_prompt.later', '나중에'),
        () => deferCurrentVersion()
      );
      primary = makeButton(
        'btn btn-primary',
        T('update_prompt.restart', '재시작 및 설치'),
        () => void restartAndInstall()
      );
    } else if (status === 'checking') {
      secondary = makeButton(
        'btn btn-ghost',
        T('update_prompt.close', '닫기'),
        () => close()
      );
      primary = makeButton(
        'btn btn-primary',
        T('settings.update.status.checking', '확인 중…'),
        () => {},
        true
      );
    } else {
      secondary = makeButton(
        'btn btn-ghost',
        T('update_prompt.close', '닫기'),
        () => close()
      );
      primary = makeButton(
        'btn btn-primary',
        T('update_prompt.retry', '다시 시도'),
        () => void retry()
      );
    }

    actions.appendChild(secondary);
    if (primary) actions.appendChild(primary);
    modal.append(title, body, actions);
    backdrop.appendChild(modal);
    updateProgress();

    if (focusPrimary) {
      requestAnimationFrame(() => (primary || secondary).focus());
    }
  }

  function tryOpen() {
    ensureRootObserver();
    const root = document.getElementById('modal-root');
    if (!canOpen(root)) return false;

    previousFocus = document.activeElement;
    backdrop = el('div', 'modal-backdrop update-prompt-backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    root.appendChild(backdrop);
    document.addEventListener('keydown', onKeydown, true);
    render({ focusPrimary: true });
    return true;
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  }

  function close() {
    if (!backdrop) {
      wantsPrompt = false;
      return;
    }
    wantsPrompt = false;
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    backdrop = null;
    renderedStatus = null;
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
    previousFocus = null;
  }

  function deferCurrentVersion() {
    declinedVersion = updateState?.version || '__unknown__';
    flowActive = false;
    close();
  }

  async function startDownload() {
    if (typeof window.kimi?.updateDownload !== 'function') {
      updateState = {
        ...updateState,
        status: 'error',
        message: T('update_prompt.download_unavailable', '이 빌드에서는 업데이트를 다운로드할 수 없습니다.'),
      };
      render({ focusPrimary: true });
      return;
    }
    flowActive = true;
    updateState = { ...updateState, status: 'downloading', percent: 0, message: null };
    render();
    try {
      const result = await window.kimi.updateDownload();
      if (result?.status && result.status !== 'downloading') handleEvent({ type: 'update', ...result });
    } catch (error) {
      handleEvent({
        type: 'update',
        status: 'error',
        version: updateState?.version,
        message: error?.message,
      });
    }
  }

  async function restartAndInstall() {
    const primary = backdrop?.querySelector('.btn-primary');
    if (primary) primary.disabled = true;
    try {
      await window.kimi?.updateQuitAndInstall?.();
    } catch (error) {
      handleEvent({
        type: 'update',
        status: 'error',
        version: updateState?.version,
        message: error?.message,
      });
    }
  }

  async function retry() {
    if (typeof window.kimi?.updateCheck !== 'function') return;
    updateState = { status: 'checking', version: updateState?.version };
    flowActive = true;
    render();
    try {
      const result = await window.kimi.updateCheck();
      if (result?.status === 'none' || result?.status === 'dev') {
        updateState = { ...updateState, ...result };
        flowActive = false;
        close();
      } else if (result?.status) {
        handleEvent({ type: 'update', ...result });
      }
    } catch (error) {
      handleEvent({ type: 'update', status: 'error', message: error?.message });
    }
  }

  function handleEvent(message) {
    if (message?.type !== 'update' || !message.status) return;
    const previousVersion = updateState?.version;
    updateState = {
      ...updateState,
      ...message,
      version: message.version || previousVersion || null,
    };
    const versionKey = updateState.version || '__unknown__';

    if (message.status === 'available') {
      if (declinedVersion === versionKey) return;
      flowActive = true;
      wantsPrompt = true;
    } else if (message.status === 'downloading') {
      if (!flowActive) return;
    } else if (message.status === 'downloaded') {
      if (declinedVersion === versionKey) return;
      flowActive = true;
      wantsPrompt = true;
    } else if (message.status === 'error') {
      if (!flowActive) return;
      wantsPrompt = true;
    } else {
      return;
    }

    if (backdrop) {
      if (renderedStatus === 'downloading' && message.status === 'downloading') {
        updateProgress();
      } else {
        render({ focusPrimary: message.status !== 'downloading' });
      }
    } else {
      tryOpen();
    }
  }

  window.I18N?.onChange?.(() => {
    if (backdrop) render();
  });

  ensureRootObserver();
  window.UpdatePrompt = { handleEvent, close };
})();
