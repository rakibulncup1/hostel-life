/** App-owned accessible confirmations: no browser confirm/prompt popups. */
function showDialog(message, requiredText = null) {
  return new Promise(resolve => {
    let finished = false;
    const overlay = document.createElement('div');
    overlay.className = 'hl-action-overlay';
    const panel = document.createElement('section');
    panel.className = 'hl-action-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','কাজটি নিশ্চিত করুন');
    const title = document.createElement('h2');
    title.textContent = 'কাজটি নিশ্চিত করুন';
    const description = document.createElement('p');
    description.textContent = String(message || 'আপনি কি নিশ্চিত?');
    const actions = document.createElement('div');
    actions.className = 'hl-action-buttons';
    const cancel = document.createElement('button');
    cancel.className = 'secondary-button';
    cancel.type = 'button';
    cancel.textContent = 'বাতিল';
    const confirm = document.createElement('button');
    confirm.className = requiredText == null ? 'primary-button' : 'danger-button';
    confirm.type = 'button';
    confirm.textContent = 'নিশ্চিত করুন';
    let input;
    if (requiredText != null) {
      const label = document.createElement('label');
      label.className = 'field-label';
      const labelText = document.createElement('span');
      labelText.textContent = 'নিচের বাক্যটি হুবহু লিখুন';
      const phrase = document.createElement('code');
      phrase.className = 'platform-delete-phrase';
      phrase.textContent = requiredText;
      input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      confirm.disabled = true;
      input.addEventListener('input', () => { confirm.disabled = input.value.trim() !== requiredText; });
      label.append(labelText, phrase, input);
      panel.append(title, description, label);
    } else panel.append(title, description);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    function finish(value) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', keyboard);
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus?.();
      resolve(value);
    }
    function keyboard(event) {
      if (event.key === 'Escape') { event.preventDefault(); finish(requiredText == null ? false : null); }
      if (event.key === 'Tab') {
        const candidates = [input, cancel, confirm].filter(el => el && !el.disabled);
        const index = candidates.indexOf(document.activeElement);
        if (event.shiftKey && (index <= 0)) { event.preventDefault(); candidates.at(-1)?.focus(); }
        else if (!event.shiftKey && index === candidates.length - 1) { event.preventDefault(); candidates[0]?.focus(); }
      }
    }
    cancel.onclick = () => finish(requiredText == null ? false : null);
    confirm.onclick = () => finish(requiredText == null ? true : input.value.trim());
    actions.append(cancel,confirm);
    panel.append(actions);
    overlay.append(panel);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keyboard);
    (input || cancel).focus();
    overlay.addEventListener('mousedown', event => { if(event.target === overlay) finish(requiredText == null ? false : null); });
  });
}
export const confirmAction = message => showDialog(message);
export const confirmTypedAction = (message, exactPhrase) => showDialog(message, exactPhrase);
