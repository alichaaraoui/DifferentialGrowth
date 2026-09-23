/**
 * Replaces a native <select> with a styled listbox.
 *
 * The real <select> stays in the DOM as the source of truth, so `.value` and
 * the `change` event keep working exactly as before. The menu is appended to
 * <body> and positioned fixed, because the rack clips its own overflow.
 */

export function enhanceSelect(select) {
  select.classList.add('sr');
  select.setAttribute('tabindex', '-1');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dd-btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `<span></span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>`;
  select.insertAdjacentElement('afterend', button);

  const menu = document.createElement('ul');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  document.body.appendChild(menu);

  const visible = [...select.options].filter((o) => !o.hidden);
  for (const option of visible) {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    menu.appendChild(item);
  }

  const labelFor = (value) =>
    [...select.options].find((o) => o.value === value)?.textContent ?? '';

  function sync() {
    button.querySelector('span').textContent = labelFor(select.value);
    for (const item of menu.children) {
      item.setAttribute('aria-selected', item.dataset.value === select.value ? 'true' : 'false');
    }
  }

  function place() {
    const box = button.getBoundingClientRect();
    menu.style.minWidth = `${box.width}px`;
    menu.style.left = `${box.left}px`;
    // flip above the button when there is not enough room below
    const below = window.innerHeight - box.bottom;
    menu.style.top = below > menu.offsetHeight + 12 ? `${box.bottom + 6}px` : '';
    menu.style.bottom = below > menu.offsetHeight + 12 ? '' : `${window.innerHeight - box.top + 6}px`;
  }

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    const current = menu.querySelector('[aria-selected="true"]');
    (current ?? menu.firstElementChild)?.classList.add('is-cursor');
  }

  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    menu.querySelector('.is-cursor')?.classList.remove('is-cursor');
  }

  const isOpen = () => !menu.hidden;

  function choose(value) {
    if (value !== select.value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync();
    close();
    button.focus();
  }

  function moveCursor(step) {
    const items = [...menu.children];
    const at = items.findIndex((i) => i.classList.contains('is-cursor'));
    const next = Math.min(items.length - 1, Math.max(0, (at < 0 ? 0 : at) + step));
    items[at]?.classList.remove('is-cursor');
    items[next]?.classList.add('is-cursor');
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));

  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen()) open();
      else if (e.key === 'Enter' || e.key === ' ') {
        choose(menu.querySelector('.is-cursor')?.dataset.value ?? select.value);
      } else moveCursor(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape' && isOpen()) {
      close();
    }
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[role="option"]');
    if (item) choose(item.dataset.value);
  });

  menu.addEventListener('pointermove', (e) => {
    const item = e.target.closest('[role="option"]');
    if (!item) return;
    menu.querySelector('.is-cursor')?.classList.remove('is-cursor');
    item.classList.add('is-cursor');
  });

  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !menu.contains(e.target) && e.target !== button && !button.contains(e.target)) close();
  });
  window.addEventListener('resize', () => isOpen() && close());
  document.addEventListener('scroll', () => isOpen() && close(), true);

  sync();
  select._dd = { sync, close };
  return select._dd;
}
