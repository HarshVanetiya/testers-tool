// Selector, XPath and human-readable label helpers for the recorder.
// Classic content script: exposes globalThis.TTSelectors.

globalThis.TTSelectors ||= (() => {
  const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id'];
  const INTERACTIVE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'option',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
    '[role="combobox"]', '[role="treeitem"]', '[contenteditable=""]', '[contenteditable="true"]', '[onclick]',
  ].join(',');
  const TEXT_INPUT_TYPES = new Set([
    'text', 'email', 'password', 'search', 'tel', 'url', 'number', '', 'datetime-local', 'date', 'time', 'month', 'week',
  ]);

  const clean = (s, max = 60) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  const quoteAttr = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  function looksGenerated(value) {
    return (
      /\d{4,}/.test(value) ||
      /^[a-f0-9-]{12,}$/i.test(value) ||
      /^:?r[0-9a-z]{1,3}:?$/.test(value) ||
      /^(ember|react-|ng-|mui-|radix-|headlessui-|downshift-|aria-|uid-|id-)/i.test(value) ||
      /[_-][a-z0-9]{5,}$/i.test(value) && /\d/.test(value)
    );
  }

  function isUnique(selector, root) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function stableClasses(el) {
    return [...el.classList].filter(
      (c) =>
        c.length < 40 &&
        !/\d{2,}/.test(c) &&
        !/^(css|sc|jsx|jss|emotion|styled|makeStyles|ng-|is-|has-|active|focus|hover|selected|open)/i.test(c) &&
        !/^[a-z]{1,3}-[a-z0-9]{5,}$/i.test(c) &&
        !c.includes(':'),
    );
  }

  function anchorSelector(el, root) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !looksGenerated(el.id)) {
      const s = '#' + CSS.escape(el.id);
      if (isUnique(s, root)) return s;
    }
    for (const a of TEST_ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const s = `[${a}=${quoteAttr(v)}]`;
      if (isUnique(s, root)) return s;
      if (isUnique(tag + s, root)) return tag + s;
    }
    return null;
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const root = el.getRootNode() || document;
    const tag = el.tagName.toLowerCase();
    const anchor = anchorSelector(el, root);
    if (anchor) return anchor;
    for (const attr of ['name', 'aria-label', 'placeholder', 'title', 'alt']) {
      const v = el.getAttribute(attr);
      if (!v || v.length > 80) continue;
      const s = `${tag}[${attr}=${quoteAttr(v)}]`;
      if (isUnique(s, root)) return s;
    }
    if (tag === 'input' && el.name && el.value && ['radio', 'checkbox'].includes(el.type)) {
      const s = `input[name=${quoteAttr(el.name)}][value=${quoteAttr(el.value)}]`;
      if (isUnique(s, root)) return s;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && href.length < 100 && !href.startsWith('javascript:')) {
        const s = `a[href=${quoteAttr(href)}]`;
        if (isUnique(s, root)) return s;
      }
    }
    return cssPath(el, root);
  }

  function segment(el) {
    const tag = el.tagName.toLowerCase();
    const classes = stableClasses(el).slice(0, 2);
    let seg = tag + classes.map((c) => '.' + CSS.escape(c)).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) {
        const matchingClass = classes.length ? same.filter((c) => classes.every((k) => c.classList.contains(k))) : same;
        if (matchingClass.length > 1) seg += `:nth-of-type(${same.indexOf(el) + 1})`;
      }
    }
    return seg;
  }

  function cssPath(el, root) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur !== el) {
        const anchor = anchorSelector(cur, root);
        if (anchor) {
          parts.unshift(anchor);
          return parts.join(' > ');
        }
      }
      parts.unshift(segment(cur));
      const sel = parts.join(' > ');
      if (parts.length >= 2 && isUnique(sel, root)) return sel;
      if (cur.tagName === 'BODY' || cur.tagName === 'HTML') break;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function buildXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (cur.id && !looksGenerated(cur.id) && !cur.id.includes('"')) {
        parts.unshift(`//*[@id="${cur.id}"]`);
        return parts.join('/');
      }
      const tag = cur.tagName.toLowerCase();
      let index = 1;
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === cur.tagName) index++;
      }
      parts.unshift(`${tag}[${index}]`);
    }
    return '/' + parts.join('/');
  }

  function textOf(el) {
    return clean(el.innerText || el.textContent || '', 80);
  }

  function labelFromLabelElements(el) {
    if (el.labels && el.labels.length) {
      const label = el.labels[0];
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
      const t = clean(copy.textContent);
      if (t) return t;
    }
    return '';
  }

  function getLabel(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      if (clean(t)) return clean(t);
    }
    if (['input', 'select', 'textarea'].includes(tag)) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type) && el.value) return clean(el.value);
      const fromLabel = labelFromLabelElements(el);
      if (fromLabel) return fromLabel;
      if (el.placeholder) return clean(el.placeholder);
      if (el.title) return clean(el.title);
      if (type === 'image' && el.alt) return clean(el.alt);
      if (el.name) return clean(humanize(el.name));
      if (el.id) return clean(humanize(el.id));
      return '';
    }
    if (tag === 'img') return clean(el.alt || el.title || '');
    const text = textOf(el);
    if (text) return text;
    if (el.title) return clean(el.title);
    const img = el.querySelector('img[alt]');
    if (img?.alt) return clean(img.alt);
    const svgTitle = el.querySelector('svg title');
    if (svgTitle?.textContent) return clean(svgTitle.textContent);
    return '';
  }

  function humanize(s) {
    return String(s)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-[\].]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  function kind(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return 'button';
    if (tag === 'select' || role === 'combobox' || role === 'listbox') return 'dropdown';
    if (type === 'checkbox' || role === 'checkbox' || role === 'menuitemcheckbox') return 'checkbox';
    if (type === 'radio' || role === 'radio' || role === 'menuitemradio') return 'radio button';
    if (role === 'switch') return 'switch';
    if (tag === 'textarea' || tag === 'input' || el.isContentEditable) return 'field';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menu item';
    if (role === 'option' || tag === 'option') return 'option';
    if (role === 'treeitem') return 'tree item';
    if (tag === 'img' || tag === 'svg') return 'image';
    if (tag === 'label') return 'label';
    if (tag === 'summary') return 'toggle';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'li') return 'list item';
    if (tag === 'td' || tag === 'th') return 'cell';
    return 'element';
  }

  function interactiveTarget(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    if (!el || el.nodeType !== 1) return null;
    const hit = el.closest(INTERACTIVE);
    if (hit) return hit;
    // Non-interactive element: prefer a small ancestor with short text.
    let cur = el;
    for (let i = 0; i < 3 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      const t = (cur.innerText || '').trim();
      if (t && t.length <= 80) return cur;
    }
    return el;
  }

  function isTextInput(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
    return !!el.isContentEditable;
  }

  function isPassword(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.type === 'password') return true;
    const hint = `${el.name} ${el.id} ${el.getAttribute('autocomplete') || ''}`.toLowerCase();
    return /password|passwd|current-password|new-password|one-time-code|otp|\bpin\b|cvv|cvc/.test(hint);
  }

  /** "'Login' button", or a fallback that uses the selector when no label exists. */
  function describeTarget(el) {
    const label = getLabel(el);
    const k = kind(el);
    return label ? `'${label}' ${k}` : `${k} (${buildSelector(el)})`;
  }

  return {
    buildSelector,
    buildXPath,
    getLabel,
    kind,
    textOf,
    interactiveTarget,
    isTextInput,
    isPassword,
    describeTarget,
    clean,
  };
})();
