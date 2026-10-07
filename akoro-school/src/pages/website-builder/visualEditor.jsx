/**
 * Website Builder — WordPress-style inline HTML editor helpers.
 * Boots an iframe where text is edited directly; template scripts are
 * disabled while editing and restored byte-for-byte on save.
 */

/* ── Visual (WordPress-style) HTML editor ────────────────────────────────── */
const isFullDoc = (c) => /^\s*(<!doctype html|<html[\s>])/i.test(c || '');

// Injected into the iframe. Kept as a plain string (ES5) so it survives any
// document; communicates with the parent via postMessage({ __editor: true }).
const EDITOR_BOOT_JS = `(function(){
  var REGION = window.__EDIT_REGION__ || null;
  var root = (REGION && document.querySelector(REGION)) || document.body;
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('spellcheck', 'false');
  var st = document.createElement('style');
  st.setAttribute('data-editor-ui', '1');
  st.textContent = '[contenteditable=true]{outline:none;cursor:text}' +
    '[contenteditable=true] *:hover{outline:1px dashed rgba(245,158,11,.8);outline-offset:2px}' +
    '[contenteditable=true] img{cursor:pointer}';
  document.head.appendChild(st);
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a');
    if (a) e.preventDefault();
  }, true);
  var seq = 0;
  document.addEventListener('dblclick', function(e){
    if (e.target && e.target.tagName === 'IMG') {
      var id = e.target.getAttribute('data-edit-img') || ('img-' + (++seq) + '-' + Math.floor(Math.random()*1e6));
      e.target.setAttribute('data-edit-img', id);
      parent.postMessage({ __editor: true, type: 'pick-image', id: id }, '*');
    }
  }, true);
  function serialize(){
    var clone = document.documentElement.cloneNode(true);
    var kill = clone.querySelectorAll('[data-editor-ui],script[data-editor-script]');
    for (var i = 0; i < kill.length; i++) kill[i].parentNode.removeChild(kill[i]);
    var ce = clone.querySelectorAll('[contenteditable]');
    for (var j = 0; j < ce.length; j++) { ce[j].removeAttribute('contenteditable'); ce[j].removeAttribute('spellcheck'); }
    var imgs = clone.querySelectorAll('[data-edit-img]');
    for (var k = 0; k < imgs.length; k++) imgs[k].removeAttribute('data-edit-img');
    var scripts = clone.querySelectorAll('script[data-orig-script]');
    for (var l = 0; l < scripts.length; l++) {
      var s = scripts[l], t = s.getAttribute('data-orig-type');
      s.removeAttribute('data-orig-script'); s.removeAttribute('data-orig-type');
      if (t) s.setAttribute('type', t); else s.removeAttribute('type');
    }
    if (REGION) { var r = clone.querySelector(REGION); return r ? r.innerHTML : ''; }
    return '<!doctype html>\\n' + clone.outerHTML;
  }
  var timer;
  function changed(){ clearTimeout(timer); timer = setTimeout(function(){ parent.postMessage({ __editor: true, type: 'html', html: serialize() }, '*'); }, 300); }
  document.addEventListener('input', changed, true);
  document.addEventListener('blur', changed, true);
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (!d.__editor) return;
    if (d.type === 'set-image') {
      var img = document.querySelector('img[data-edit-img="' + d.id + '"]');
      if (img) { img.src = d.url; changed(); }
    }
    if (d.type === 'cmd') { try { document.execCommand(d.cmd); changed(); } catch(_){} }
    if (d.type === 'scroll-to') {
      var scope = (REGION && document.querySelector(REGION)) || document;
      var els = scope.querySelectorAll('h1,h2,h3');
      var el = els[d.index];
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid #f59e0b'; setTimeout(function(){ el.style.outline = ''; }, 1200); }
    }
    if (d.type === 'get-html') parent.postMessage({ __editor: true, type: 'html', html: serialize() }, '*');
  });
})();`;

// Disable every <script> in the doc (restored at serialize time) and append
// the editor bootstrap. regionSelector limits editing to that element
// (fragments edited inside the theme chrome); null = whole body editable.
function prepareEditableDoc(docHtml, regionSelector) {
  const doc = new DOMParser().parseFromString(docHtml || '', 'text/html');
  // The editor iframe is same-origin by necessity (the parent reads its DOM),
  // so disabling <script> is not enough on its own: inline handlers and
  // javascript: URLs would still run with the portal's origin. Strip them.
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      else if (/^(href|src|action|formaction|xlink:href)$/i.test(attr.name)
               && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll('script').forEach((s) => {
    s.setAttribute('data-orig-script', '1');
    const t = s.getAttribute('type');
    if (t) s.setAttribute('data-orig-type', t);
    s.setAttribute('type', 'text/x-disabled');
  });
  const boot = doc.createElement('script');
  boot.setAttribute('data-editor-script', '1');
  boot.textContent = `window.__EDIT_REGION__=${JSON.stringify(regionSelector || null)};\n${EDITOR_BOOT_JS}`;
  doc.body.appendChild(boot);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}


export { isFullDoc, prepareEditableDoc };
