/* =========================================================
   Kishore Kumar Ultimate Fan Jukebox — app.js
   - Bundle rendering with Popularity Meters
   - Bilingual search engine (English / Hinglish / हिंदी)
   - Voice Search engine (Web Speech API, hi-IN / en-IN)
   - Trivia of the Day, Favourites, PWA install + offline
   ========================================================= */
(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    tabs: $('tabs'), view: $('view'), input: $('searchInput'), form: $('searchForm'),
    clear: $('clearBtn'), mic: $('micBtn'), lang: $('langBtn'),
    voicePanel: $('voicePanel'), voiceText: $('voiceText'),
    trivia: $('triviaText'), triviaHi: $('triviaTextHi'), nextTrivia: $('nextTrivia'),
    install: $('installBtn'), toast: $('toast'), net: $('netStatus')
  };

  // ---------- Safe storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  };

  // ---------- State ----------
  const state = {
    data: null,
    songs: [],              // flattened, with search keys
    tab: store.get('kk.tab', 'b1'),
    query: '',
    favs: new Set(store.get('kk.favs', [])),
    cat: store.get('kk.cat', {}),   // selected chip per category tab, e.g. { pairs: 'Lata Mangeshkar' }
    triviaIndex: 0
  };

  // =========================================================
  //  TEXT NORMALISATION  (the heart of bilingual search)
  // =========================================================
  const DEVA_RE = /[ऀ-ॿ]/;

  /** Fold Roman/Hinglish spellings so "Deewana" ≈ "Diwana", "Zindagi" ≈ "Jindagi", "Yeh" ≈ "Ye". */
  function foldRoman(s) {
    return String(s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' aur ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/ee|ii/g, 'i')
      .replace(/oo|uu/g, 'u')
      .replace(/aa/g, 'a')
      .replace(/w/g, 'v')
      .replace(/z/g, 'j')
      .replace(/q/g, 'k')
      .replace(/ph/g, 'f')
      .replace(/sh/g, 's')
      .replace(/([bcdgjkpt])h/g, '$1')   // bh→b, kh→k, th→t …
      .replace(/(\w)\1+/g, '$1')         // collapse doubles: "mastanna" → "mastana"
      .replace(/([aeiou])h\b/g, '$1')    // "yeh" → "ye", "wah" → "va"
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Normalise Devanagari: drop nukta, unify chandrabindu/anusvara, strip punctuation. */
  function normDeva(s) {
    return String(s)
      .normalize('NFC')
      .replace(/़/g, '')            // nukta (ज़ → ज)
      .replace(/ँ/g, 'ं')      // ँ → ं
      .replace(/[‌‍]/g, '')    // ZWNJ/ZWJ
      .replace(/[^ऀ-ॿ0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Simple Devanagari → Roman transliterator (good enough for matching).
  const V = { 'अ':'a','आ':'a','इ':'i','ई':'i','उ':'u','ऊ':'u','ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऑ':'o' };
  const M = { 'ा':'a','ि':'i','ी':'i','ु':'u','ू':'u','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au','ॉ':'o' };
  const C = { 'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'n','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'n',
    'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
    'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh',
    'स':'s','ह':'h','क़':'k','ख़':'kh','ग़':'g','ज़':'z','फ़':'f','ड़':'r','ढ़':'rh' };
  function devaToRoman(s) {
    const str = normDeva(s);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i], nx = str[i + 1];
      if (C[ch]) {
        out += C[ch];
        if (nx === '्') { i++; continue; }            // virama: no inherent vowel
        if (M[nx]) { out += M[nx]; i++; continue; }
        const endOfWord = !nx || /\s/.test(nx);
        if (!endOfWord) out += 'a';                   // inherent 'a' (dropped at word end)
      } else if (V[ch]) out += V[ch];
      else if (ch === 'ं') out += 'n';
      else if (ch === 'ः') out += 'h';
      else if (/[0-9\s]/.test(ch)) out += ch;
    }
    return out;
  }

  /** Any input (Roman or Devanagari) → folded Roman key. */
  const toKey = (s) => foldRoman(DEVA_RE.test(s) ? devaToRoman(s) : s);
  const compact = (s) => s.replace(/\s+/g, '');

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // =========================================================
  //  SEARCH ENGINE
  // =========================================================
  // Words people add when speaking/typing that aren't part of the title.
  const FILLER = new Set(['play','song','songs','gana','gane','gaana','gaane','search','find','sunao','bajao',
    'chalao','lagao','kishore','kumar','ka','ki','ke','vala','vali','please','plz','mujhe','sunna','hai','do']);
  const FILLER_DEVA = /(बजाओ|सुनाओ|चलाओ|लगाओ|गाना|गाने|किशोर|कुमार|का गाना|प्लीज़?|मुझे|सुनना है)/g;

  function cleanQuery(q) {
    let s = String(q).replace(FILLER_DEVA, ' ');
    const words = toKey(s).split(' ').filter(Boolean);
    const kept = words.filter((w) => !FILLER.has(w));
    return {
      key: words.join(' '),                                   // as typed/spoken (minus Hindi command words)
      keyClean: (kept.length ? kept : words).join(' '),       // with filler words removed
      deva: DEVA_RE.test(s) ? normDeva(s) : ''
    };
  }

  /** A token matches when some word in the haystack starts with it (avoids "asa" matching "kasam"). */
  //  Words of 4+ letters also tolerate one typo ("kehdo" ≈ "kehdun", "chen" ≈ "chain").
  //  Returns 1 for an exact prefix hit, 0.6 for a typo hit, 0 for none.
  const wordPrefixHit = (words, t) => {
    if (words.some((w) => w.startsWith(t))) return 1;
    if (t.length >= 4 && words.some((w) => w.length >= 3 && levenshtein(t, w.slice(0, t.length)) <= 1)) return 0.6;
    return 0;
  };

  const hiName = (n) => (state.data && state.data.names && state.data.names[n]) || n;

  /** Songs live once in data.songs (with tags); collections & categories only point at them. */
  function buildIndex(data) {
    const inColl = {};
    (data.collections || []).forEach((c) => c.sections.forEach((sec) => sec.ids.forEach((id) => { if (!inColl[id]) inColl[id] = c.title; })));
    return (data.songs || [])
      .filter((s) => !s.status)                       // 'review' / 'rejected' songs stay hidden
      .map((song) => {
        const titleKey = toKey(song.title);
        const people = [...song.singers, ...(song.actors || []), song.composer];
        return {
          ...song,
          bundleTitle: inColl[song.id] || '',
          k: {
            title: titleKey,
            titleC: compact(titleKey),
            hiRoman: toKey(song.hi || ''),
            hiDeva: normDeva(`${song.hi || ''} ${people.map(hiName).join(' ')}`),
            meta: toKey(`${song.film} ${people.join(' ')} ${song.year}`),
            composerC: compact(toKey(song.composer))
          }
        };
      });
  }

  // ---------- Auto categories from tags ----------
  const LEAD = 'Kishore Kumar';
  const PAIR_ORDER = ['Lata Mangeshkar', 'Asha Bhosle', 'Mohammed Rafi', 'Manna Dey', 'Mukesh'];
  const CATS = {
    pairs:     { title: '🎤 गायक जोड़ी', en: 'Singer Duos' },
    composers: { title: '🎼 संगीतकार', en: 'Music Directors' },
    actors:    { title: '🎬 अभिनेता', en: 'Actors' }
  };
  function groupsFor(kind) {
    const map = new Map();
    const add = (key, s) => { if (!map.has(key)) map.set(key, []); map.get(key).push(s); };
    state.songs.forEach((s) => {
      if (kind === 'pairs' && s.singers.includes(LEAD)) s.singers.filter((x) => x !== LEAD && PAIR_ORDER.includes(x)).forEach((x) => add(x, s));
      if (kind === 'composers') add(s.composer, s);
      // Actors tab = heroes Kishore sang for (list kept in songs.json "heroes", in display order)
      if (kind === 'actors') (s.actors || []).filter((a) => heroes().includes(a)).forEach((a) => add(a, s));
    });
    let list = [...map.entries()].map(([key, songs]) => ({ key, songs: songs.sort((a, b) => a.year - b.year) }));
    if (kind === 'pairs') list.sort((a, b) => PAIR_ORDER.indexOf(a.key) - PAIR_ORDER.indexOf(b.key));
    else if (kind === 'actors') list.sort((a, b) => heroes().indexOf(a.key) - heroes().indexOf(b.key));
    else {
      // Composers with a single song are gathered into one "Other Music Directors" chip
      const big = list.filter((g) => g.songs.length >= 2).sort((a, b) => b.songs.length - a.songs.length || a.key.localeCompare(b.key));
      const rest = list.filter((g) => g.songs.length < 2).flatMap((g) => g.songs).sort((a, b) => a.year - b.year);
      list = rest.length ? [...big, { key: OTHER, songs: rest }] : big;
    }
    return list;
  }
  const heroes = () => (state.data && state.data.heroes) || [];
  const OTHER = '__other__';
  const groupLabel = (kind, key) => key === OTHER ? 'Other Music Directors' : kind === 'pairs' ? `Kishore & ${key}` : kind === 'actors' ? `Kishore × ${key}` : key;
  const groupLabelHi = (kind, key) => key === OTHER ? 'अन्य संगीतकार' : kind === 'pairs' ? `किशोर और ${hiName(key)}` : kind === 'actors' ? `किशोर × ${hiName(key)}` : hiName(key);

  /** Score a song for a query. 0 = no match. */
  function scoreSong(song, q) {
    const { deva } = q;
    let score = 0;
    // 1) Native Devanagari match (e.g. "ओ मेरे दिल के चैन")
    if (deva) {
      if (song.k.hiDeva === deva) score = 120;
      else if (song.k.hiDeva.includes(deva)) score = 100;
    }
    // Try the query both as-is and with filler words removed; keep the better score.
    for (const key of new Set([q.key, q.keyClean])) if (key) score = Math.max(score, scoreKey(song.k, key));
    return score;
  }

  function scoreKey(k, key) {
    let score = 0;
    {
      const qc = compact(key);
      // 2) Exact / phrase matches on title (Roman or transliterated Hindi)
      if (k.title === key || k.hiRoman === key) score = Math.max(score, 115);
      else if (k.titleC.startsWith(qc)) score = Math.max(score, 95);
      else if (qc.length >= 5 && (k.titleC.includes(qc) || compact(k.hiRoman).includes(qc))) score = Math.max(score, 85);

      // 3) Token coverage across title + film + composer + singers + year (word-prefix match)
      const tokens = key.split(' ').filter(Boolean);
      const words = `${k.title} ${k.hiRoman} ${k.meta}`.split(' ').concat(k.composerC);
      // Whole query as one word: "rd burman" → "rdburman", "laxmikant pyarelal" → "laxmikantpyarelal"
      if (qc.length >= 4 && k.composerC.startsWith(qc)) score = Math.max(score, 88);
      const hit = tokens.reduce((sum, t) => sum + wordPrefixHit(words, t), 0);
      if (hit) score = Math.max(score, Math.round((hit / tokens.length) * 70) + (hit === tokens.length ? 10 : 0));

      // 4) Fuzzy fallback for typos / mis-heard voice ("mere sapno ki rani", "o mere dil ki chen")
      if (score < 60 && qc.length >= 4) {
        const target = k.titleC.slice(0, Math.max(qc.length, 4));
        const d = levenshtein(qc, target);
        const tol = Math.max(1, Math.floor(qc.length / 4));
        if (d <= tol) score = Math.max(score, 75 - d * 8);
      }
    }
    return score;
  }

  function search(raw) {
    const q = cleanQuery(raw);
    return state.songs
      .map((s) => ({ s, score: scoreSong(s, q) }))
      .filter((r) => r.score >= 40)
      .sort((a, b) => b.score - a.score || (b.s.pop || 0) - (a.s.pop || 0));
  }

  // =========================================================
  //  RENDERING
  // =========================================================
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const ytLink = (s) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${s.title} ${s.film} Kishore Kumar`);

  function highlight(text, raw) {
    const safe = esc(text);
    const words = String(raw).trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return safe;
    try { return safe.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>'); } catch { return safe; }
  }

  function songCard(s, { showMeter = false, showBundle = false } = {}) {
    const fav = state.favs.has(s.id);
    const q = state.query;
    return `
      <li class="song${Player.isCurrent(s.id) ? ' playing' : ''}" id="song-${esc(s.id)}">
        <div class="song-top">
          <div class="song-text">
            <p class="song-title">${highlight(s.title, q)}</p>
            <p class="song-hi" lang="hi">${highlight(s.hi, q)}</p>
            <p class="song-meta">🎬 ${esc(s.film)} (${esc(s.year)}) · 🎼 ${esc(s.composer)}</p>
          </div>
          ${thumbHtml(s)}
        </div>
        <div class="chips">
          <span class="chip">🎤 ${esc(s.singers.join(', '))}</span>
          ${s.actors && s.actors.length ? `<span class="chip">⭐ ${esc(s.actors.join(', '))}</span>` : ''}
          ${showBundle ? `<span class="chip">${esc(s.bundleTitle)}</span>` : ''}
        </div>
        ${showMeter && s.pop ? `
          <div class="mini-meter" aria-label="Popularity ${s.pop} out of 100">
            <span>🔥</span>
            <div class="meter-track"><div class="meter-fill" data-w="${s.pop}"></div></div>
            <span>${s.pop}</span>
          </div>` : ''}
        <div class="song-actions">
          ${s.yt && s.embed === false
            ? `<a class="play-btn" href="https://www.youtube.com/watch?v=${esc(s.yt)}" target="_blank" rel="noopener" title="This video only plays on YouTube">▶ Play on YouTube ↗</a>`
            : s.yt
            ? `<button class="play-btn" data-play="${esc(s.id)}" aria-label="Play ${esc(s.title)}">${Player.isCurrent(s.id) ? '🔊 Playing' : '▶ Play'}</button>`
            : `<a class="play-btn" href="${ytLink(s)}" target="_blank" rel="noopener">▶ Listen</a>`}
          <button class="fav-btn" data-fav="${esc(s.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favourites">${fav ? '♥' : '♡'}</button>
        </div>
      </li>`;
  }

  /** Picture of the song = thumbnail of its chosen YouTube video. Tapping it plays the song. */
  function thumbHtml(s) {
    if (!s.yt) return '';
    const img = `<img src="https://i.ytimg.com/vi/${esc(s.yt)}/mqdefault.jpg" alt="${esc(s.title)} — ${esc(s.film)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('noimg')">`;
    return s.embed === false
      ? `<a class="thumb" href="https://www.youtube.com/watch?v=${esc(s.yt)}" target="_blank" rel="noopener" aria-label="Play ${esc(s.title)} on YouTube">${img}<span class="thumb-play">▶</span><span class="thumb-badge">YouTube ↗</span></a>`
      : `<button class="thumb" data-thumbplay="${esc(s.id)}" aria-label="Play ${esc(s.title)}">${img}<span class="thumb-play">${Player.isCurrent(s.id) ? '🔊' : '▶'}</span></button>`;
  }

  const playAllBtns = () => `
    <div class="play-all">
      <button data-playall="continuous">🔁 सब लगातार चलाएँ</button>
      <button data-playall="shuffle">🔀 Shuffle</button>
    </div>`;

  function renderTabs() {
    const tabs = [...state.data.collections.map((b) => ({ id: b.id, title: b.title, hi: b.hi })),
      ...Object.entries(CATS).map(([id, c]) => ({ id, title: c.title, hi: c.en })),
      { id: 'favs', title: '♥ Favourites', hi: `पसंदीदा (${state.favs.size})` }];
    els.tabs.innerHTML = tabs.map((t) => `
      <button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === state.tab && !state.query}">
        ${esc(t.title)}<small lang="hi">${esc(t.hi)}</small>
      </button>`).join('');
  }

  function renderBundle(b) {
    const isTiered = b.id === 'b1';
    return `
      <div class="bundle-head">
        ${playAllBtns()}
        <h2>${esc(b.title)} <span lang="hi" style="font-weight:400;color:var(--muted);font-size:.9rem">· ${esc(b.hi)}</span></h2>
        <p>${esc(b.subtitle)}</p>
      </div>
      ${b.sections.map((sec) => `
        <section class="section ${esc(sec.class)}" aria-labelledby="h-${sec.id}">
          <div class="section-head">
            <h3 id="h-${sec.id}">${esc(sec.title)}</h3>
            <span class="hi" lang="hi">${esc(sec.hi)}</span>
          </div>
          <p class="section-desc">${esc(sec.desc)} · ${secSongs(sec).length} songs</p>
          ${isTiered && sec.meter ? `
            <div class="meter" aria-label="Tier popularity ${sec.meter} out of 100">
              <div class="meter-label"><span>📊 Popularity Meter</span><span>${sec.meter}/100</span></div>
              <div class="meter-track"><div class="meter-fill" data-w="${sec.meter}"></div></div>
            </div>` : ''}
          <ul class="song-grid">
            ${secSongs(sec).map((s) => songCard(s, { showMeter: isTiered })).join('')}
          </ul>
        </section>`).join('')}`;
  }

  const secSongs = (sec) => sec.ids.map((id) => state.songs.find((x) => x.id === id)).filter(Boolean);

  function renderCategory(kind) {
    const groups = groupsFor(kind);
    if (!groups.length) return '<p class="empty">अभी कोई गाना नहीं।</p>';
    let key = state.cat[kind];
    if (!groups.some((g) => g.key === key)) key = groups[0].key;
    const g = groups.find((x) => x.key === key);
    return `
      <div class="cat-chips" role="tablist" aria-label="${esc(CATS[kind].en)}">
        ${groups.map((x) => `<button class="cat-chip" data-cat="${esc(kind)}|${esc(x.key)}" aria-selected="${x.key === key}">
          ${esc(groupLabel(kind, x.key))} <small lang="hi">${esc(groupLabelHi(kind, x.key))}</small><b>${x.songs.length}</b></button>`).join('')}
      </div>
      <div class="bundle-head">
        ${playAllBtns()}
        <h2>${esc(groupLabel(kind, key))} <span lang="hi" style="font-weight:400;color:var(--muted);font-size:.9rem">· ${esc(groupLabelHi(kind, key))}</span></h2>
        <p>${g.songs.length} songs · ${esc(CATS[kind].en)}</p>
      </div>
      <ul class="song-grid">${g.songs.map((s) => songCard(s, { showBundle: true })).join('')}</ul>`;
  }

  function renderFavs() {
    const list = state.songs.filter((s) => state.favs.has(s.id));
    if (!list.length) return `<p class="empty">No favourites yet. Tap ♡ on any song. <br><span lang="hi">अभी कोई पसंदीदा गाना नहीं है।</span></p>`;
    return `<div class="bundle-head">${playAllBtns()}<h2>♥ Your Favourites</h2><p>${list.length} songs</p></div>
      <ul class="song-grid">${list.map((s) => songCard(s, { showBundle: true })).join('')}</ul>`;
  }

  function renderSearch() {
    const results = search(state.query);
    if (!results.length) {
      return `<p class="empty">No match for "<b>${esc(state.query)}</b>".<br>
        <span lang="hi">कोई गाना नहीं मिला — दूसरी स्पेलिंग या फ़िल्म का नाम आज़माएँ।</span></p>`;
    }
    return `<div class="bundle-head">${playAllBtns()}<h2>🔍 ${results.length} result${results.length > 1 ? 's' : ''}</h2>
      <p>for "${esc(state.query)}"</p></div>
      <ul class="song-grid">${results.map((r) => songCard(r.s, { showBundle: true, showMeter: !!r.s.pop })).join('')}</ul>`;
  }

  function render() {
    renderTabs();
    let html;
    if (state.query.trim()) html = renderSearch();
    else if (state.tab === 'favs') html = renderFavs();
    else if (CATS[state.tab]) html = renderCategory(state.tab);
    else html = renderBundle(state.data.collections.find((b) => b.id === state.tab) || state.data.collections[0]);
    els.view.innerHTML = html;
    els.clear.hidden = !state.query;
    // animate meters
    requestAnimationFrame(() => els.view.querySelectorAll('.meter-fill').forEach((m) => { m.style.width = m.dataset.w + '%'; }));
  }

  // =========================================================
  //  TRIVIA OF THE DAY
  // =========================================================
  function dayOfYear(d = new Date()) {
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }
  function showTrivia(i) {
    const list = state.data.trivia || [];
    if (!list.length) return;
    state.triviaIndex = ((i % list.length) + list.length) % list.length;
    const t = list[state.triviaIndex];
    els.trivia.textContent = t.en;
    els.triviaHi.textContent = t.hi || '';
  }

  // =========================================================
  //  VOICE SEARCH ENGINE  (Web Speech API)
  // =========================================================
  const Voice = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const LANGS = { 'hi-IN': 'हि', 'en-IN': 'EN' };
    let lang = store.get('kk.voiceLang', 'hi-IN');
    let rec = null, listening = false, gotFinal = false;

    function updateLangBtn() {
      els.lang.textContent = LANGS[lang];
      els.lang.setAttribute('aria-label', `Voice language: ${lang === 'hi-IN' ? 'Hindi' : 'English (India)'}`);
    }

    function setListening(on) {
      listening = on;
      els.mic.classList.toggle('listening', on);
      els.mic.setAttribute('aria-label', on ? 'Stop voice search' : 'Start voice search');
      els.voicePanel.hidden = !on;
      if (on) els.voiceText.textContent = lang === 'hi-IN' ? 'सुन रहा हूँ… गाने का नाम बोलिए' : 'Listening… say a song name';
    }

    /** Voice commands handled before search. Returns true if handled. */
    function handleCommand(text) {
      const k = toKey(text);
      if (/^(clear|reset|saf karo|hatao)$/.test(k) || /^(साफ़? करो|हटाओ)$/.test(text.trim())) {
        setQuery(''); toast('Search cleared'); return true;
      }
      if (/(favourite|favorite|pasandida|pasandid)/.test(k) || /पसंदीदा/.test(text)) {
        setQuery(''); switchTab('favs'); toast('♥ Favourites'); return true;
      }
      const bundleMap = [
        [/(rajes|kana|bundle 1|bundle one|tier)/, 'b1'],
        [/(composer|vault|bundle 2|bundle two)/, 'b2'],
        [/(duet|bundle 3|bundle three)/, 'b3']
      ];
      if (/^(open|kholo|dikhao|show)\b/.test(k) || /(खोलो|दिखाओ)/.test(text)) {
        for (const [re, id] of bundleMap) if (re.test(k)) { setQuery(''); switchTab(id); return true; }
      }
      return false;
    }

    /** Pick the best alternative transcript by search score. */
    function bestAlternative(result) {
      let best = { text: result[0].transcript, score: -1 };
      for (let i = 0; i < result.length; i++) {
        const text = result[i].transcript.trim();
        const top = search(text)[0];
        const score = top ? top.score : 0;
        if (score > best.score) best = { text, score };
      }
      return best.text;
    }

    function start() {
      if (!SR) {
        toast('Voice search works in Chrome / Edge / Android. आपका ब्राउज़र इसे सपोर्ट नहीं करता।');
        return;
      }
      if (!navigator.onLine) { toast('Voice search needs internet. इंटरनेट चाहिए।'); return; }
      if (listening) { rec && rec.stop(); return; }

      rec = new SR();
      rec.lang = lang;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.continuous = false;
      gotFinal = false;

      rec.onstart = () => setListening(true);

      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            gotFinal = true;
            const text = bestAlternative(r);
            els.voiceText.textContent = `“${text}”`;
            if (!handleCommand(text)) {
              setQuery(text);
              const top = search(text)[0];
              if (top) {
                toast(`🎵 ${top.s.title} — tap ▶ Play`);
                setTimeout(() => {
                  const card = document.getElementById('song-' + top.s.id);
                  if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.querySelector('.play-btn')?.focus({ preventScroll: true }); }
                }, 80);
              }
            }
          } else {
            interim += r[0].transcript;
          }
        }
        if (interim) {
          els.voiceText.textContent = interim + '…';
          els.input.value = interim;
        }
      };

      rec.onerror = (e) => {
        const msg = {
          'not-allowed': 'Microphone permission denied. ब्राउज़र सेटिंग में माइक की अनुमति दें।',
          'service-not-allowed': 'Microphone permission denied. ब्राउज़र सेटिंग में माइक की अनुमति दें।',
          'no-speech': 'Kuch sunai nahi diya — dobara boliye.',
          'audio-capture': 'No microphone found. माइक नहीं मिला।',
          'network': 'Network error — voice search needs internet.'
        }[e.error];
        if (msg) toast(msg);
      };

      rec.onend = () => {
        setListening(false);
        if (!gotFinal && !state.query) els.input.value = '';
      };

      try { rec.start(); } catch { /* already started */ }
    }

    function toggleLang() {
      lang = lang === 'hi-IN' ? 'en-IN' : 'hi-IN';
      store.set('kk.voiceLang', lang);
      updateLangBtn();
      toast(lang === 'hi-IN' ? 'Voice: हिंदी' : 'Voice: English (India)');
    }

    function init() {
      updateLangBtn();
      if (!SR) { els.mic.classList.add('unsupported'); els.mic.title = 'Voice search not supported in this browser'; }
      els.mic.addEventListener('click', start);
      els.lang.addEventListener('click', toggleLang);
    }
    return { init };
  })();

  // =========================================================
  //  NOW PLAYING — in-app YouTube player (official IFrame API)
  //  Plays the exact video stored in songs.json ("yt" field).
  //  Free embed: no login, licence or subscription needed.
  // =========================================================
  const Player = (() => {
    const p = {
      box: $('player'), title: $('npTitle'), sub: $('npSub'), err: $('npError'),
      prev: $('npPrev'), next: $('npNext'), toggle: $('npToggle'), close: $('npClose'), mode: $('npMode')
    };
    let yt = null, ready = false, apiLoading = null;
    let current = null, queue = [], pendingId = null;
    // 'continuous' = play only OUR list, one after another · 'single' = stop after this song
    let mode = store.get('kk.mode', 'continuous');
    let endedFor = null;        // song id whose end we've already handled
    let switchingUntil = 0;     // ignore guard checks while a new video is loading

    function updateModeBtn() {
      const single = mode === 'single';
      p.mode.textContent = single ? '🔂 एक गाना (Single)' : '🔁 लगातार (Continuous)';
      p.mode.setAttribute('aria-pressed', String(!single));
      p.mode.title = single ? 'Stops after this song — tap for Continuous' : 'Plays your list one after another — tap for Single';
    }
    function setMode(m) { mode = m; store.set('kk.mode', m); updateModeBtn(); }

    function loadApi() {
      if (window.YT && window.YT.Player) return Promise.resolve();
      if (apiLoading) return apiLoading;
      apiLoading = new Promise((resolve, reject) => {
        window.onYouTubeIframeAPIReady = resolve;
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => { apiLoading = null; reject(new Error('YouTube API failed')); };
        document.head.appendChild(s);
      });
      return apiLoading;
    }

    const songById = (id) => state.songs.find((s) => s.id === id);

    function showInfo(song) {
      p.title.textContent = song.title;
      p.sub.textContent = `${song.hi} · ${song.film} (${song.year})`;
      p.err.hidden = true;
      document.title = `▶ ${song.title} — Kishore Jukebox`;
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title, artist: song.singers, album: song.film,
            artwork: [{ src: `https://i.ytimg.com/vi/${song.yt}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }]
          });
          navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
          navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
        } catch { /* optional */ }
      }
    }

    function onError(e) {
      // 101/150 = owner disabled embedding, 100 = removed, 2/5 = bad request/HTML5 error
      const song = songById(current);
      p.err.hidden = false;
      p.err.innerHTML = `⚠ This video can't play here. <a href="https://www.youtube.com/watch?v=${esc(song?.yt)}" target="_blank" rel="noopener">Open on YouTube ↗</a> · skipping in 4s…`;
      setTimeout(() => { if (current === song?.id) step(1); }, 4000);
    }

    function onState(e) {
      const S = window.YT.PlayerState;
      if (e.data === S.PLAYING) { p.toggle.textContent = '⏸'; p.toggle.setAttribute('aria-label', 'Pause'); }
      if (e.data === S.PAUSED) { p.toggle.textContent = '▶'; p.toggle.setAttribute('aria-label', 'Play'); }
      if (e.data === S.ENDED) handleEnd();
    }

    /** Our song finished → Single: stop. Continuous: next song from OUR list (never YouTube's). */
    function handleEnd() {
      if (!current || endedFor === current) return;
      endedFor = current;
      if (mode === 'single') {
        const song = songById(current);
        if (song) yt.cueVideoById(song.yt);   // park on our own video, kills YouTube's end-screen / up-next
        p.toggle.textContent = '▶'; p.toggle.setAttribute('aria-label', 'Play');
      } else {
        step(1);
      }
    }

    /** Guard: YouTube must never play its own "next" video inside our player. */
    function guard() {
      if (!yt || !ready || !current || Date.now() < switchingUntil) return;
      const song = songById(current);
      if (!song) return;
      let vid = '', st = -1, d = 0, t = 0;
      try { vid = (yt.getVideoData() || {}).video_id || ''; st = yt.getPlayerState(); d = yt.getDuration(); t = yt.getCurrentTime(); } catch { return; }
      if (vid && vid !== song.yt) {               // YouTube switched to a video that is not ours
        if (mode === 'single') { switchingUntil = Date.now() + 3000; yt.cueVideoById(song.yt); endedFor = current; }
        else handleEnd();
        return;
      }
      // Finish a moment before the real end, so YouTube's autoplay countdown never starts
      if (st === window.YT.PlayerState.PLAYING && d > 60 && t >= d - 0.7) handleEnd();
    }
    setInterval(guard, 500);

    async function play(id, newQueue) {
      const song = songById(id);
      if (!song || !song.yt) return;
      if (!navigator.onLine) { toast('Songs need internet. गाना सुनने के लिए इंटरनेट चाहिए।'); return; }
      if (newQueue && newQueue.length) queue = newQueue;
      current = id;
      endedFor = null;
      switchingUntil = Date.now() + 4000;
      p.box.hidden = false;
      document.body.classList.add('has-player');
      showInfo(song);
      render(); // highlight the playing card

      try { await loadApi(); } catch {
        p.err.hidden = false;
        p.err.innerHTML = `⚠ Player could not load. <a href="https://www.youtube.com/watch?v=${esc(song.yt)}" target="_blank" rel="noopener">Open on YouTube ↗</a>`;
        return;
      }
      if (!yt) {
        pendingId = song.yt;
        yt = new window.YT.Player('ytFrame', {
          host: 'https://www.youtube-nocookie.com',
          videoId: song.yt,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
          events: {
            onReady: (e) => { ready = true; e.target.playVideo(); if (pendingId !== song.yt) e.target.loadVideoById(pendingId); },
            onStateChange: onState,
            onError
          }
        });
      } else if (ready) {
        yt.loadVideoById(song.yt);
      } else {
        pendingId = song.yt;
      }
    }

    function step(dir) {
      if (!queue.length) return;
      const i = queue.indexOf(current);
      const nextId = queue[(i + dir + queue.length) % queue.length];
      play(nextId);
    }

    function closePlayer() {
      if (yt && ready) yt.stopVideo();
      current = null;
      p.box.hidden = true;
      document.body.classList.remove('has-player');
      document.title = 'Kishore Kumar Ultimate Fan Jukebox';
      render();
    }

    p.prev.addEventListener('click', () => step(-1));
    p.next.addEventListener('click', () => step(1));
    p.close.addEventListener('click', closePlayer);
    p.mode.addEventListener('click', () => {
      setMode(mode === 'single' ? 'continuous' : 'single');
      toast(mode === 'single' ? '🔂 Single: यह गाना खत्म होकर रुक जाएगा' : '🔁 Continuous: आपकी list के गाने एक के बाद एक चलेंगे');
    });
    updateModeBtn();
    p.toggle.addEventListener('click', () => {
      if (!yt || !ready) return;
      const S = window.YT.PlayerState;
      yt.getPlayerState() === S.PLAYING ? yt.pauseVideo() : yt.playVideo();
    });

    return { play, setMode, isCurrent: (id) => current === id };
  })();

  // =========================================================
  //  ACTIONS & EVENTS
  // =========================================================
  function setQuery(q) {
    state.query = q;
    if (els.input.value !== q) els.input.value = q;
    render();
  }
  function switchTab(id) {
    state.tab = id;
    store.set('kk.tab', id);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toggleFav(id) {
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    store.set('kk.favs', [...state.favs]);
    render();
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function bindEvents() {
    let t;
    els.input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => setQuery(els.input.value), 150);
    });
    els.form.addEventListener('submit', (e) => { e.preventDefault(); setQuery(els.input.value); els.input.blur(); });
    els.clear.addEventListener('click', () => { setQuery(''); els.input.focus(); });

    els.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      setQuery('');
      switchTab(b.dataset.tab);
    });
    els.view.addEventListener('click', (e) => {
      const f = e.target.closest('[data-fav]');
      if (f) toggleFav(f.dataset.fav);
      const c = e.target.closest('[data-cat]');
      if (c) {
        const [kind, key] = c.dataset.cat.split('|');
        state.cat[kind] = key; store.set('kk.cat', state.cat); render();
        return;
      }
      const pa = e.target.closest('[data-playall]');
      if (pa) {
        let queue = [...els.view.querySelectorAll('[data-play]')].map((b) => b.dataset.play);
        if (!queue.length) { toast('इस list में app के अंदर चलने वाला कोई गाना नहीं है'); return; }
        if (pa.dataset.playall === 'shuffle') queue = queue.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
        Player.setMode('continuous');
        Player.play(queue[0], queue);
        return;
      }
      const p = e.target.closest('[data-play],[data-thumbplay]');
      if (p) {
        // Queue = the songs currently shown on screen, in order
        const queue = [...els.view.querySelectorAll('[data-play]')].map((b) => b.dataset.play);
        Player.play(p.dataset.play || p.dataset.thumbplay, queue);
      }
    });
    els.nextTrivia.addEventListener('click', () => showTrivia(state.triviaIndex + 1));

    // Online / offline indicator
    const net = () => {
      els.net.textContent = navigator.onLine ? '' : '⚠ Offline mode — browsing cached jukebox';
      els.net.classList.toggle('offline', !navigator.onLine);
    };
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    net();
  }

  // ---------- PWA install + service worker ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.install.hidden = false;
  });
  els.install.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { els.install.hidden = true; toast('Installed! 🎉'); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => console.warn('SW failed:', err));
    });
  }

  // ---------- Boot ----------
  async function init() {
    bindEvents();
    Voice.init();
    try {
      const res = await fetch('./songs.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      state.data = await res.json();
    } catch (err) {
      els.view.innerHTML = `<p class="empty">Could not load songs. Please check your connection and reload.<br><span lang="hi">गाने लोड नहीं हो पाए।</span></p>`;
      console.error(err);
      return;
    }
    state.songs = buildIndex(state.data);
    if (state.tab !== 'favs' && !CATS[state.tab] && !state.data.collections.some((b) => b.id === state.tab)) state.tab = 'b1';
    render();
    showTrivia(dayOfYear());

    // Deep-link search: index.html?q=mere+sapnon
    const q = new URLSearchParams(location.search).get('q');
    if (q) setQuery(q);
  }

  // Expose search engine for debugging/testing in the console
  window.KKJukebox = { search: (q) => search(q).map((r) => `${r.score} · ${r.s.title}`), toKey, devaToRoman };

  init();
})();
