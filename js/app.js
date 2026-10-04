'use strict';

window.addEventListener('error', e => {
  (window.__loadErrs = window.__loadErrs || []).push((e.message || 'error') + ' @' + (e.lineno || '?'));
});

const MM = 96 / 25.4;                 
const MARGIN = { x: 13, top: 14, bottom: 14 };  

const FONT_FILE_LABELS = {
  'lxgwwenkailite-regular.ttf': '霞鹜文楷',
  'xiaolai-regular.ttf': '小赖字体',
  'muyaosoftbrush-regular.ttf': '沐瑶软笔手写体',
  'qiantuxiaotu-regular.ttf': '千图小兔体',
  'jiangxizhuokai-regular.ttf': '江西拙楷',
  'yanshichunfengkai-regular.ttf': '演示春风楷',
  'yangrendongzhushi-regular.ttf': '杨任东竹石体',
};

const fileSlug = name => 'f_' + name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_');

const KAITI_ENTRY = { id: 'kaiti', label: '楷体（系统）', css: "'KaiTi','STKaiti','FangSong',serif", web: null };

const FONTS = [];

const PAPERS = {
  k16: { w: 185, h: 260, label: '16K' },
  a4:  { w: 210, h: 297, label: 'A4' },
};

const JITTER = [
  { size: 0.03, rot: 0.9, dy: 0.35, dx: 0.20, ink: 5  },
  { size: 0.06, rot: 1.7, dy: 0.65, dx: 0.35, ink: 9  },
  { size: 0.11, rot: 2.9, dy: 1.05, dx: 0.55, ink: 15 },
];

const NOT_LINE_START = new Set('，。、；：？！…—～·）】》〉」』”’％%°,.?!;:)]}');
const NOT_LINE_END   = new Set('（【《〈「『“‘([{');

const PUNCT = new Set(
  '，。、；：？！…—～·–-（）《》〈〉【】〔〕「」『』“”‘’％‰°＃＆＊＠＋｜、,.?!;:()[]{}<>/\\|@#&*+=~^_\'"'
);

function isSymbolChar(ch) {
  if (PUNCT.has(ch)) return true;
  const cp = ch.codePointAt(0);
  if (cp >= 0x2460 && cp <= 0x24FF) return true;  
  if (cp >= 0x3220 && cp <= 0x3247) return true;  
  if (cp >= 0x3280 && cp <= 0x32FF) return true;  
  return false;
}

const SAMPLE = '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。\n\n床前明月光，疑是地上霜。\n举头望明月，低头思故乡。';

const state = {
  text: '',
  fontId: 'f_lxgwwenkailite_regular',
  symFontId: 'same',   
  symScale: 1,         
  charGap: 0,          
  size: 5,        
  spacing: 1.6,   
  jitter: 1,      
  jitterCustom: { size: 0.08, rot: 2.2, dy: 0.8, ink: 12 },
  paper: 'k16',
  paperW: 185,    
  paperH: 260,    
  grid: 'none',
  copies: 1,
  seed: (Math.random() * 2 ** 31) | 0,
};

function getPaper() {
  if (state.paper === 'custom') {
    return { w: state.paperW, h: state.paperH, label: `自定义${state.paperW}x${state.paperH}` };
  }
  return PAPERS[state.paper];
}

function effectiveJ() {
  if (state.jitter !== 3) return JITTER[state.jitter];
  const c = state.jitterCustom;
  return { size: c.size, rot: c.rot, dy: c.dy, dx: c.dy * 0.55, ink: c.ink };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = n => Math.round(n * 100) / 100;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const $ = id => document.getElementById(id);
const pagesEl = $('pages'), previewEl = document.querySelector('.main'), statsEl = $('stats'),
      overlayEl = $('overlay'), overlayText = $('overlayText'), toastEl = $('toast'),
      pageStyleEl = $('pageStyle');

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 240);
  }, 2600);
}

function showOverlay() {
  overlayEl.hidden = false;
  requestAnimationFrame(() => overlayEl.classList.add('show'));
}

function hideOverlay() {
  overlayEl.classList.remove('show');
  setTimeout(() => { overlayEl.hidden = true; }, 200);
}

function syncSlider(el) {
  const min = +el.min, max = +el.max, v = +el.value;
  el.style.setProperty('--p', (((v - min) / (max - min)) * 100).toFixed(2) + '%');
}

const measureCtx = document.createElement('canvas').getContext('2d');
const measureCache = new Map(); 

function getMeasure(font, fs) {
  const key = font.css + '@' + Math.round(fs * 100);
  let m = measureCache.get(key);
  if (!m) {
    measureCtx.font = `${fs}px ${font.css}`;
    const probe = measureCtx.measureText('永');
    let asc = probe.fontBoundingBoxAscent, desc = probe.fontBoundingBoxDescent;
    if (!asc || !desc) { asc = fs * 0.86; desc = fs * 0.26; }
    m = { widths: new Map(), asc: asc / fs, desc: desc / fs };
    measureCache.set(key, m);
  }
  m.ctx = measureCtx;
  return m;
}

function buildLines(chars, widthOf, maxW) {
  const lines = [];
  let cur = [], curW = 0;
  const close = () => { lines.push(cur); cur = []; curW = 0; };
  const GAP = state.charGap * MM;

  for (const ch of chars) {
    if (ch === '\n') { close(); continue; }
    const w = widthOf(ch);

    if (cur.length && curW + w > maxW + 0.01) {
      if (NOT_LINE_START.has(ch)) {   
        cur.push(ch);
        close();
        continue;
      }
      if (NOT_LINE_END.has(cur[cur.length - 1])) {  
        const open = cur.pop();
        close();
        cur.push(open);
        curW = widthOf(open) + GAP;
      } else {
        close();
      }
    }
    cur.push(ch);
    curW += w + GAP;
  }
  if (cur.length || lines.length === 0) close();
  return lines;
}

function computeLayout(font) {
  const paper = getPaper();
  const fs = state.size * MM;
  const lineH = fs * state.spacing;
  const contentW = (paper.w - MARGIN.x * 2) * MM;
  const contentH = (paper.h - MARGIN.top - MARGIN.bottom) * MM;
  const gapPx = state.charGap * MM;

  const symFont = state.symFontId === 'same'
    ? font
    : (FONTS.find(f => f.id === state.symFontId) || font);
  const symFs = fs * state.symScale;

  const text = state.text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  const copies = Math.min(99, Math.max(1, Math.round(state.copies) || 1));
  const full = copies > 1 ? Array(copies).fill(text).join('\n') : text;
  const chars = [...full];

  const textM = getMeasure(font, fs);
  const symM = getMeasure(symFont, symFs);
  for (const ch of new Set(chars)) {
    const m = isSymbolChar(ch) ? symM : textM;
    if (!m.widths.has(ch)) m.widths.set(ch, m.ctx.measureText(ch).width);
  }
  const widthOf = ch => (isSymbolChar(ch) ? symM : textM).widths.get(ch) || fs;

  const charCount = chars.filter(c => c !== '\n').length;
  if (charCount === 0) {
    return { empty: true, charCount: 0, pages: [], paper, font, fs, lineH, contentW, contentH };
  }

  const lines = buildLines(chars, widthOf, contentW);
  const perPage = Math.max(1, Math.floor((contentH + 0.01) / lineH));
  const rawPages = [];
  for (let i = 0; i < lines.length; i += perPage) rawPages.push(lines.slice(i, i + perPage));

  const measure = getMeasure(font, fs);
  const rng = mulberry32(state.seed);
  const J = effectiveJ();

  const pages = rawPages.map(pageLines => pageLines.map((lineChars, li) => {
    const y = li * lineH;
    let x = 0;
    return lineChars.map(ch => {
      const w = widthOf(ch);
      const invisible = (ch === ' ' || ch === '\u3000');
      const isP = isSymbolChar(ch);
      const baseFs = isP ? symFs : fs;
      const k = 1 + (rng() * 2 - 1) * J.size;
      const ink = 56 + Math.round((rng() * 2 - 1) * J.ink);
      const c = {
        ch, w, invisible, punct: isP, k,
        fontCss: isP ? symFont.css : font.css,
        x, y,
        fs: baseFs * k,
        dx: (rng() * 2 - 1) * J.dx * MM,
        dy: (rng() * 2 - 1) * J.dy * MM,
        rot: (rng() * 2 - 1) * J.rot,
        color: `rgb(${ink},${Math.max(18, ink - 3)},${Math.max(14, ink - 8)})`,
      };
      x += w + gapPx;
      return c;
    });
  }));

  return {
    empty: false, charCount, pages, paper, font, symFont, fs, lineH, contentW, contentH,
    asc: measure.asc, desc: measure.desc,
    symAsc: symM.asc, symDesc: symM.desc,
  };
}

const GRID_LINE = 'rgba(150,138,112,0.32)';

function gridStyle(L) {
  if (state.grid === 'tian') {
    const c = L.fs;
    return `background-image:linear-gradient(${GRID_LINE} 0.35px,transparent 0.35px),`
         + `linear-gradient(90deg,${GRID_LINE} 0.35px,transparent 0.35px);`
         + `background-size:${r2(c)}px ${r2(c)}px;`;
  }
  if (state.grid === 'rule') {
    const off = L.lineH / 2 + L.fs * (L.asc - L.desc) / 2 + 1.5;
    return `background-image:linear-gradient(${GRID_LINE} 0.4px,transparent 0.4px);`
         + `background-size:100% ${r2(L.lineH)}px;background-position:0 ${r2(off)}px;`;
  }
  return '';
}

function renderDom(L) {
  if (L.empty) {
    pagesEl.innerHTML = '<div class="empty"><span class="hint-wide">在左侧粘贴要抄写的内容</span><span class="hint-narrow">在上方粘贴要抄写的内容</span></div>';
    pagesEl.style.removeProperty('--pw');
    return;
  }

  const gs = gridStyle(L);
  const contentWmm = r2(L.contentW / MM), contentHmm = r2(L.contentH / MM);

  const html = L.pages.map(pageLines => {
    let inner = '';
    pageLines.forEach(line => {
      line.forEach(c => {
        if (c.invisible) return;
        inner += `<span class="ch" style="left:${r2(c.x)}px;top:${r2(c.y)}px;`
               + `font-size:${r2(c.fs)}px;${c.punct ? `font-family:${c.fontCss};` : ''}`
               + `color:${c.color};`
               + `transform:translate(${r2(c.dx)}px,${r2(c.dy)}px) rotate(${r2(c.rot)}deg)">${esc(c.ch)}</span>`;
      });
    });
    return `<div class="page-wrap"><div class="page">`
         + `<div class="pc" style="left:${MARGIN.x}mm;top:${MARGIN.top}mm;`
         + `width:${contentWmm}mm;height:${contentHmm}mm;line-height:${r2(L.lineH)}px;`
         + `font-family:${L.font.css};${gs}">${inner}</div></div></div>`;
  }).join('');

  pagesEl.innerHTML = html;
}

function syncPageStyle(L) {
  pageStyleEl.textContent = L && !L.empty
    ? `@page{size:${L.paper.w}mm ${L.paper.h}mm;margin:0}`
    : '';
}

function applyScale(L) {
  if (!L || L.empty) return;
  const avail = previewEl.clientWidth - 48;
  const s = Math.min(1, avail / (L.paper.w * MM));
  pagesEl.style.setProperty('--pw', r2(L.paper.w * MM) + 'px');
  pagesEl.style.setProperty('--ph', r2(L.paper.h * MM) + 'px');
  pagesEl.style.setProperty('--s', Math.max(0.2, s));
}

let L = null;
let renderSeq = 0;
let fontFailNoted = false;

async function render(animate) {
  const seq = ++renderSeq;
  const font = FONTS.find(f => f.id === state.fontId) || FONTS[0];

  if (font.web) {
    try { await document.fonts.load(`16px '${font.web}'`, '永'); } catch (e) {  }
    if (seq !== renderSeq) return;
    if (!document.fonts.check(`16px '${font.web}'`) && !fontFailNoted) {
      fontFailNoted = true;
      toast('字体文件没有加载成功，先用系统楷体显示');
    }
  }

  L = computeLayout(font);
  pagesEl.classList.toggle('anim', !!animate);
  renderDom(L);
  syncPageStyle(L);
  applyScale(L);
  statsEl.textContent = L.empty ? '' : `共 ${L.charCount} 字 · ${L.pages.length} 页`;
}

function paintPage(pageIndex, scale) {
  const { paper, fs, lineH, asc, desc, symAsc, symDesc } = L;
  const cv = document.createElement('canvas');
  cv.width = Math.round(paper.w * MM * scale);
  cv.height = Math.round(paper.h * MM * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, paper.w * MM, paper.h * MM);

  ctx.translate(MARGIN.x * MM, MARGIN.top * MM);

  if (state.grid === 'tian') {
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    for (let x = 0; x <= L.contentW + 0.1; x += fs) { ctx.moveTo(x, 0); ctx.lineTo(x, L.contentH); }
    for (let y = 0; y <= L.contentH + 0.1; y += fs) { ctx.moveTo(0, y); ctx.lineTo(L.contentW, y); }
    ctx.stroke();
  } else if (state.grid === 'rule') {
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 0.4;
    const off = lineH / 2 + fs * (asc - desc) / 2 + 1.5;
    ctx.beginPath();
    for (let y = off; y <= L.contentH + 0.1; y += lineH) { ctx.moveTo(0, y); ctx.lineTo(L.contentW, y); }
    ctx.stroke();
  }

  ctx.textBaseline = 'alphabetic';
  L.pages[pageIndex].forEach(line => {
    line.forEach(c => {
      if (c.invisible) return;
      const ad = c.punct ? (symAsc - symDesc) : (asc - desc);
      const baseY = c.y + lineH / 2 + c.fs * ad / 2;
      ctx.save();
      ctx.translate(c.x + c.w / 2 + c.dx, baseY + c.dy);
      ctx.rotate(c.rot * Math.PI / 180);
      ctx.font = `${c.fs}px ${c.fontCss}`;
      ctx.fillStyle = c.color;
      ctx.fillText(c.ch, -(c.w * c.k) / 2, 0);
      ctx.restore();
    });
  });
  return cv;
}

const frame = () => new Promise(r => setTimeout(r, 16));

async function exportPdf() {
  if (!L || L.empty) { toast('先在左侧输入内容'); return; }
  const btns = [$('btnPdf'), $('btnPrint'), $('btnReshuffle')];
  btns.forEach(b => b.disabled = true);
  showOverlay();
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: [L.paper.w, L.paper.h], orientation: 'portrait', compress: true });
    const n = L.pages.length;
    for (let i = 0; i < n; i++) {
      overlayText.textContent = `正在生成第 ${i + 1} / ${n} 页…`;
      await frame();
      const cv = paintPage(i, 3);
      if (i > 0) pdf.addPage([L.paper.w, L.paper.h], 'portrait');
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, L.paper.w, L.paper.h);
      await frame();
    }
    const d = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    pdf.save(`誊稿_${L.paper.label}_${stamp}.pdf`);
    toast('PDF 已生成');
  } catch (err) {
    console.error(err);
    toast('生成失败：' + (err && err.message || err));
  } finally {
    hideOverlay();
    btns.forEach(b => b.disabled = false);
  }
}

const textEl = $('text');

textEl.addEventListener('input', () => {
  
  if (textEl.innerText === '\n' && textEl.innerHTML !== '') textEl.innerHTML = '';
  state.text = textEl.innerText;
  clearTimeout(render._t);
  render._t = setTimeout(render, 200);
});

$('size').addEventListener('input', e => {
  state.size = parseFloat(e.target.value);
  $('sizeOut').textContent = `${state.size} mm`;
  syncSlider(e.target);
  clearTimeout(render._t);
  render._t = setTimeout(render, 120);
});

$('symSize').addEventListener('input', e => {
  state.symScale = parseFloat(e.target.value);
  $('symSizeOut').textContent = `×${state.symScale.toFixed(2)}`;
  syncSlider(e.target);
  clearTimeout(render._t);
  render._t = setTimeout(render, 120);
});

$('gap').addEventListener('input', e => {
  state.charGap = parseFloat(e.target.value);
  const v = state.charGap;
  $('gapOut').textContent = (v > 0 ? `+${v}` : v) + ' mm';
  syncSlider(e.target);
  clearTimeout(render._t);
  render._t = setTimeout(render, 120);
});

$('spacing').addEventListener('input', e => {
  state.spacing = parseFloat(e.target.value);
  $('spacingOut').textContent = `×${state.spacing.toFixed(2)}`;
  syncSlider(e.target);
  clearTimeout(render._t);
  render._t = setTimeout(render, 120);
});

$('jitter').addEventListener('change', e => {
  state.jitter = +e.target.value;
  $('jitterCustom').hidden = state.jitter !== 3;
  render(true);
});

function bindJc(id, key, fmt) {
  const el = $(id), out = $(id + 'Out');
  el.addEventListener('input', () => {
    state.jitterCustom[key] = parseFloat(el.value);
    out.textContent = fmt(state.jitterCustom[key]);
    syncSlider(el);
    clearTimeout(render._t);
    render._t = setTimeout(render, 120);
  });
  out.textContent = fmt(state.jitterCustom[key]);
  syncSlider(el);
}
bindJc('jcSize', 'size', v => Math.round(v * 100) + '%');
bindJc('jcRot', 'rot', v => v.toFixed(1) + '°');
bindJc('jcDy', 'dy', v => v.toFixed(2) + ' mm');
bindJc('jcInk', 'ink', v => String(v));

$('paper').addEventListener('change', e => {
  state.paper = e.target.value;
  $('paperCustom').hidden = state.paper !== 'custom';
  render(true);
});

$('paperW').addEventListener('change', e => {
  state.paperW = Math.min(400, Math.max(80, Math.round(+e.target.value) || 185));
  e.target.value = state.paperW;
  if (state.paper === 'custom') render(true);
});

$('paperH').addEventListener('change', e => {
  state.paperH = Math.min(400, Math.max(80, Math.round(+e.target.value) || 260));
  e.target.value = state.paperH;
  if (state.paper === 'custom') render(true);
});

$('grid').addEventListener('change', e => { state.grid = e.target.value; render(true); });

$('copies').addEventListener('change', e => {
  state.copies = Math.min(99, Math.max(1, Math.round(+e.target.value) || 1));
  e.target.value = state.copies;
  render(true);
});

$('btnReshuffle').addEventListener('click', () => {
  state.seed = (Math.random() * 2 ** 31) | 0;
  render(true);
});

$('chipSample').addEventListener('click', () => {
  textEl.innerText = SAMPLE;
  state.text = SAMPLE;
  render(true);
});

function stepCopies(d) {
  state.copies = Math.min(99, Math.max(1, (Math.round(state.copies) || 1) + d));
  $('copies').value = state.copies;
  render(true);
}
$('copiesMinus').addEventListener('click', () => stepCopies(-1));
$('copiesPlus').addEventListener('click', () => stepCopies(1));

function makeDropdown(mount, onChange) {
  mount.classList.add('dd');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.innerHTML = '<span class="dd-label"></span>'
    + '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  mount.appendChild(btn);
  mount.appendChild(menu);

  let options = [], value = null, openState = false, openedAt = 0;

  function renderBtn() {
    const o = options.find(x => x.value === value);
    const label = btn.querySelector('.dd-label');
    label.textContent = o ? o.label : '';
    label.style.fontFamily = (o && o.fontCss) ? o.fontCss : '';
  }
  function close() {
    if (window.__ddTrace) window.__ddTrace.push(new Error().stack.split('\n').slice(1, 4).join(' | '));
    openState = false; mount.classList.remove('open');
  }
  function positionMenu() {
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.width = r.width + 'px';
    const mh = menu.offsetHeight;
    menu.style.top = (r.bottom + mh + 10 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  }
  function open() {
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    positionMenu();
    menu.style.visibility = '';
    openState = true;
    openedAt = performance.now();
    mount.classList.add('open');
    const sel = menu.querySelector('.dd-opt.selected');
    if (sel) menu.scrollTop = Math.max(0, sel.offsetTop - menu.clientHeight / 2 + sel.offsetHeight / 2);
  }

  btn.addEventListener('click', () => { openState ? close() : open(); });
  menu.addEventListener('click', e => {
    const opt = e.target.closest('.dd-opt');
    if (!opt) return;
    value = opt.dataset.value;
    renderBtn();
    close();
    if (onChange) onChange(value);
  });
  document.addEventListener('pointerdown', e => { if (!mount.contains(e.target)) close(); });
  window.addEventListener('resize', () => { if (openState) positionMenu(); });
  const sideScroller = document.querySelector('.side-scroll');
  if (sideScroller) sideScroller.addEventListener('scroll', () => {
    if (openState && performance.now() - openedAt > 150) close();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  return {
    setOptions(opts, v) {
      options = opts;
      value = v;
      menu.innerHTML = opts.map(o =>
        `<button type="button" class="dd-opt${o.value === v ? ' selected' : ''}" data-value="${esc(o.value)}">`
        + `<span${o.fontCss ? ` style="font-family:${o.fontCss}"` : ''}>${esc(o.label)}</span>`
        + `<svg class="dd-check" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        + `</button>`).join('');
      renderBtn();
    },
    set(v) {
      value = v;
      renderBtn();
      menu.querySelectorAll('.dd-opt').forEach(o => o.classList.toggle('selected', o.dataset.value === v));
    },
    close,
  };
}

const ddFont = makeDropdown($('ddFont'), v => { state.fontId = v; saveLastFontIds(); render(true); });
const ddSym = makeDropdown($('ddSym'), v => { state.symFontId = v; saveLastFontIds(); render(true); });

function rebuildFontUI() {
  const opts = FONTS.map(f => ({ value: f.id, label: f.label, fontCss: f.css }));
  ddFont.setOptions(opts, state.fontId);
  ddSym.setOptions([{ value: 'same', label: '同文字', fontCss: '' }, ...opts], state.symFontId);
}

function ensureValidFontIds() {
  if (!FONTS.some(f => f.id === state.fontId)) {
    state.fontId = (FONTS.find(f => f.id !== 'kaiti') || FONTS[0]).id;
  }
  if (state.symFontId !== 'same' && !FONTS.some(f => f.id === state.symFontId)) {
    state.symFontId = 'same';
  }
}

const fsSupported = 'showDirectoryPicker' in window;
const isHttp = location.protocol === 'http:' || location.protocol === 'https:';
let dirHandle = null;      
let connMode = 'none';     
let connDirName = 'fonts';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shouxiegao', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbSet(key, val) {
  return idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}
function idbGet(key) {
  return idbOpen().then(db => new Promise((res, rej) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

async function rebuildFontsFrom(files) {
  const found = files
    .filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  FONTS.length = 0;
  measureCache.clear();
  for (const f of found) {
    try {
      const buf = await f.getBuffer();
      const face = new FontFace('Dir_' + fileSlug(f.name), buf);
      await face.load();
      document.fonts.add(face);
      FONTS.push({
        id: fileSlug(f.name),
        label: FONT_FILE_LABELS[f.name.toLowerCase()] || f.name.replace(/\.(ttf|otf|woff2?)$/i, ''),
        css: `'Dir_${fileSlug(f.name)}','KaiTi','STKaiti',serif`,
        web: 'Dir_' + fileSlug(f.name),
      });
    } catch (e) {
      console.warn('字体读取失败：', f.name, e);
    }
  }
  FONTS.push(KAITI_ENTRY);
}

async function scanViaHttp() {
  const res = await fetch('fonts/');
  if (!res.ok) throw new Error('fonts 目录不可读');
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const names = [...doc.querySelectorAll('a')]
    .map(a => { try { return decodeURIComponent(a.getAttribute('href') || ''); } catch (e) { return ''; } })
    .filter(n => n && /\.(ttf|otf|woff2?)$/i.test(n));
  await rebuildFontsFrom(names.map(name => ({
    name,
    getBuffer: async () => await (await fetch('fonts/' + encodeURIComponent(name))).arrayBuffer(),
  })));
}

async function scanViaHandle() {
  const files = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind !== 'file') continue;
    files.push({ name, getBuffer: async () => await (await entry.getFile()).arrayBuffer() });
  }
  await rebuildFontsFrom(files);
}

async function useHandle(h) {
  dirHandle = h;
  connMode = 'handle';
  connDirName = h.name || 'fonts';
  try { await idbSet('fontsDir', h); } catch (e) {  }
  await scanViaHandle();
  ensureValidFontIds();
  rebuildFontUI();
  updateConnectRow();
  updateFontStatus();
  ddFont.set(state.fontId);
  ddSym.set(state.symFontId);
  await render(true);
}

async function connectFontsDir() {
  const h = await window.showDirectoryPicker({ id: 'fontsdir', mode: 'readwrite' });
  await useHandle(h);
  toast(`已连接「${connDirName}/」，检测到 ${FONTS.length - 1} 款字体`);
  return h;
}

function updateConnectRow() {
  const b = $('btnConnectDir');
  const folderSvg = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const refreshSvg = '<svg viewBox="0 0 24 24"><path d="M4 10a8 8 0 1 1-1 6M4 10V4m0 6h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  b.innerHTML = (connMode === 'handle' ? refreshSvg + '刷新字体列表' : folderSvg + '连接字体文件夹');
}

function updateFontStatus() {
  const n = FONTS.length - 1;
  if (connMode === 'handle') $('fontStatus').textContent = `${connDirName} · ${n} 款字体`;
  else if (connMode === 'http') $('fontStatus').textContent = `fonts · ${n} 款字体（只读）`;
  else $('fontStatus').textContent = '未连接字体文件夹';
}

$('btnConnectDir').addEventListener('click', async () => {
  if (!fsSupported) {
    toast('此浏览器不支持访问文件夹：请手动把字体放进 fonts 文件夹后刷新页面');
    return;
  }
  try {
    if (connMode === 'handle') {
      let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') { toast('没有该文件夹的读写权限，请重新连接'); return; }
      await scanViaHandle();
      ensureValidFontIds();
      rebuildFontUI();
      ddFont.set(state.fontId);
      ddSym.set(state.symFontId);
      updateFontStatus();
      render(true);
      toast(`字体列表已刷新，检测到 ${FONTS.length - 1} 款字体`);
    } else {
      await connectFontsDir();
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;   
    console.error(err);
    toast('操作失败：' + (err && err.message || err));
  }
});

$('btnImportFont').addEventListener('click', () => {
  if (!fsSupported) {
    toast('此浏览器不支持写入文件夹：请手动把字体放进 fonts 文件夹后点"刷新字体列表"');
    return;
  }
  $('fontFile').click();
});

$('fontFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    if (connMode !== 'handle') await connectFontsDir();   
    let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { toast('没有该文件夹的读写权限，请重新连接'); return; }

    const dest = await dirHandle.getFileHandle(f.name, { create: true });
    const w = await dest.createWritable();
    await w.write(f);
    await w.close();

    await scanViaHandle();
    ensureValidFontIds();
    if (FONTS.some(x => x.id === fileSlug(f.name))) state.fontId = fileSlug(f.name);
    saveLastFontIds();
    rebuildFontUI();
    ddFont.set(state.fontId);
    ddSym.set(state.symFontId);
    updateFontStatus();
    render(true);
    toast(`已导入「${f.name}」到「${connDirName}/」`);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    toast('导入失败：' + (err && err.message || err));
  }
});

function saveLastFontIds() {
  try {
    localStorage.setItem('lastFontIds', JSON.stringify({ fontId: state.fontId, symFontId: state.symFontId }));
  } catch (e) {  }
}

$('btnImportFont').addEventListener('click', () => $('fontFile').click());

$('fontFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    await importFontBuffer(await f.arrayBuffer(), f.name.replace(/\.(ttf|otf|woff2?)$/i, ''));
  } catch (err) {
    console.error(err);
    toast('字体导入失败：文件可能不是有效的字体文件');
  }
});

function currentSettings() {
  return {
    fontId: state.fontId,
    symFontId: state.symFontId,
    symScale: state.symScale,
    size: state.size,
    charGap: state.charGap,
    spacing: state.spacing,
    jitter: state.jitter,
    jitterCustom: { ...state.jitterCustom },
    paper: state.paper,
    paperW: state.paperW,
    paperH: state.paperH,
    grid: state.grid,
    copies: state.copies,
  };
}

function syncSettingsUI() {
  rebuildFontUI();
  ddFont.set(state.fontId);
  ddSym.set(state.symFontId);
  $('size').value = state.size;
  $('symSize').value = state.symScale;
  $('gap').value = state.charGap;
  $('spacing').value = state.spacing;
  syncSlider($('size')); syncSlider($('symSize')); syncSlider($('gap')); syncSlider($('spacing'));
  $('sizeOut').textContent = `${state.size} mm`;
  $('symSizeOut').textContent = `×${state.symScale.toFixed(2)}`;
  const g = state.charGap;
  $('gapOut').textContent = (g > 0 ? `+${g}` : g) + ' mm';
  $('spacingOut').textContent = `×${state.spacing.toFixed(2)}`;

  const jr = document.querySelector(`#jitter input[value="${state.jitter}"]`);
  if (jr) jr.checked = true;
  $('jitterCustom').hidden = state.jitter !== 3;
  $('jcSize').value = state.jitterCustom.size;
  $('jcRot').value = state.jitterCustom.rot;
  $('jcDy').value = state.jitterCustom.dy;
  $('jcInk').value = state.jitterCustom.ink;
  syncSlider($('jcSize')); syncSlider($('jcRot')); syncSlider($('jcDy')); syncSlider($('jcInk'));
  $('jcSizeOut').textContent = Math.round(state.jitterCustom.size * 100) + '%';
  $('jcRotOut').textContent = state.jitterCustom.rot.toFixed(1) + '°';
  $('jcDyOut').textContent = state.jitterCustom.dy.toFixed(2) + ' mm';
  $('jcInkOut').textContent = String(state.jitterCustom.ink);

  const pr = document.querySelector(`#paper input[value="${state.paper}"]`);
  if (pr) pr.checked = true;
  $('paperCustom').hidden = state.paper !== 'custom';
  $('paperW').value = state.paperW;
  $('paperH').value = state.paperH;

  const gr = document.querySelector(`#grid input[value="${state.grid}"]`);
  if (gr) gr.checked = true;

  $('copies').value = state.copies;
}

$('btnExportSettings').addEventListener('click', () => {
  const json = JSON.stringify({ app: '誊稿', version: 1, settings: currentSettings() }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = '誊稿设置.json';
  a.click();
  toast('设置已导出');
});

$('btnImportSettings').addEventListener('click', () => $('settingsFile').click());

$('settingsFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    applySettings(data && data.settings ? data.settings : data);
    toast('设置已导入');
  } catch (err) {
    console.error(err);
    toast('导入失败：不是有效的设置文件');
  }
});

function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  const num = (v, min, max, def) => {
    v = +v;
    return isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  state.fontId = FONTS.some(f => f.id === s.fontId) ? s.fontId : state.fontId;
  state.symFontId = s.symFontId === 'same' || FONTS.some(f => f.id === s.symFontId) ? s.symFontId : 'same';
  state.size = num(s.size, 3.5, 9, 5);
  state.symScale = num(s.symScale, 0.6, 1.4, 1);
  state.charGap = num(s.charGap, -1, 2, 0);
  state.spacing = num(s.spacing, 1.3, 2.4, 1.6);
  state.jitter = [0, 1, 2, 3].includes(s.jitter) ? s.jitter : 1;
  const jc = s.jitterCustom || {};
  state.jitterCustom = {
    size: num(jc.size, 0, 0.2, 0.08),
    rot: num(jc.rot, 0, 6, 2.2),
    dy: num(jc.dy, 0, 2, 0.8),
    ink: num(jc.ink, 0, 30, 12),
  };
  state.paper = ['k16', 'a4', 'custom'].includes(s.paper) ? s.paper : 'k16';
  state.paperW = num(s.paperW, 80, 400, 185);
  state.paperH = num(s.paperH, 80, 400, 260);
  state.grid = ['none', 'tian', 'rule'].includes(s.grid) ? s.grid : 'none';
  state.copies = num(s.copies, 1, 99, 1);
  syncSettingsUI();
  render(true);
}

function bindDblclickReset() {
  const fire = el => {
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.querySelectorAll('.slider-row').forEach(row => {
    const label = row.querySelector('label[for]');
    const el = label && document.getElementById(label.htmlFor);
    if (!el) return;
    row.title = '双击恢复默认';
    row.addEventListener('dblclick', () => fire(el));
    el.addEventListener('dblclick', () => fire(el));
  });
  document.querySelectorAll('.mini-row').forEach(row => {
    const el = row.querySelector('input[type="range"]');
    if (!el) return;
    row.title = '双击恢复默认';
    row.addEventListener('dblclick', () => fire(el));
  });
  [['copies', 'change'], ['paperW', 'change'], ['paperH', 'change']].forEach(([id, ev]) => {
    const el = $(id);
    el.title = '双击恢复默认';
    el.addEventListener('dblclick', () => {
      el.value = el.defaultValue;
      el.dispatchEvent(new Event(ev, { bubbles: true }));
    });
  });
}

$('btnPrint').addEventListener('click', () => window.print());
$('btnPdf').addEventListener('click', exportPdf);

window.addEventListener('resize', () => applyScale(L));

(function bindLineSnap() {
  const sc = document.querySelector('.ta-scroll');
  if (!sc) return;
  let timer;
  sc.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const lh = parseFloat(getComputedStyle(textEl).lineHeight);
      if (!isFinite(lh) || lh <= 0) return;
      const target = Math.round(sc.scrollTop / lh) * lh;
      if (Math.abs(target - sc.scrollTop) > 0.5) {
        sc.scrollTo({ top: target, behavior: 'smooth' });
      }
    }, 140);
  });
})();

bindDblclickReset();

(async () => {
  
  if (fsSupported) {
    try {
      const h = await idbGet('fontsDir');
      if (h) {
        const perm = await h.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') { await useHandle(h); }
      }
    } catch (e) { dirHandle = null; }
  }
  
  if (connMode !== 'handle' && isHttp) {
    try {
      await scanViaHttp();
      connMode = 'http';
      connDirName = 'fonts';
    } catch (e) { connMode = 'none'; }
  }
  
  try {
    const saved = JSON.parse(localStorage.getItem('lastFontIds') || 'null');
    if (saved) { state.fontId = saved.fontId; state.symFontId = saved.symFontId; }
  } catch (e) {  }
  ensureValidFontIds();
  rebuildFontUI();
  updateConnectRow();
  updateFontStatus();
  syncSettingsUI();
  render();
  
  if (location.hash === '#demo') setTimeout(() => $('chipSample').click(), 300);
  
  if (location.search.indexOf('debug') >= 0) {
    window.__fontApi = {
      state, FONTS,
      useMockDir: async mock => { await useHandle(mock); },
      scanViaHandle, scanViaHttp, rebuildFontUI, ensureValidFontIds, ddFont, ddSym, render,
    };
  }
})();
