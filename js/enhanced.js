/* ═══════════════════════════════════════════════════════════════
 * 澪鸢增强模块：观影派对 / 弹幕 / 离线缓存
 * ═══════════════════════════════════════════════════════════════ */

/* ============ 0. 通用工具 ============ */
function lyGuestId(){
  let id = '';
  try{ id = localStorage.getItem('lingyuan_guest_id_v1') || ''; }catch(e){}
  if(!id){
    id = 'g_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
    try{ localStorage.setItem('lingyuan_guest_id_v1', id); }catch(e){}
  }
  return id;
}
function lyMyId(){
  if(typeof currentUser !== 'undefined' && currentUser && currentUser.id) return currentUser.id;
  return lyGuestId();
}
function lyMyName(){
  if(typeof currentUser !== 'undefined' && currentUser && typeof userName === 'function'){
    const n = userName();
    if(n) return n;
  }
  return '游客' + lyMyId().slice(-4);
}
function lyMyAvatar(){
  try{
    if(typeof currentUser !== 'undefined' && currentUser && typeof userAvatar === 'function') return userAvatar();
  }catch(e){}
  return '👤';
}

/* ═══════════════════════════════════════════════════════════════
 * 1. 观影派对
 * ═══════════════════════════════════════════════════════════════ */
const PARTY = {
  channel: null,
  roomId: '',
  isHost: false,
  members: new Map(),
  _remoteApplying: false,
  _remoteTimer: null,
  _bound: false
};

function partyInRoom(){ return !!PARTY.channel; }

function partyBroadcast(payload){
  if(!PARTY.channel) return;
  payload.from = lyMyId();
  try{ PARTY.channel.send({ type:'broadcast', event:'sync', payload }); }catch(e){}
}

function partyBroadcastDanmaku(d){
  if(!PARTY.channel) return;
  try{
    PARTY.channel.send({ type:'broadcast', event:'danmaku', payload: Object.assign({ from: lyMyId() }, d) });
  }catch(e){}
}

async function partyCreate(){
  if(typeof supabaseReady !== 'undefined' && !supabaseReady){ toast('云端未连接，无法创建房间'); return; }
  if(typeof sb === 'undefined' || !sb){ toast('云端未连接'); return; }
  const code = (Math.random().toString(36).slice(2,8)).toUpperCase();
  await partyJoinRoom(code, true);
}

async function partyJoinRoom(roomId, isHost){
  partyLeaveRoom();
  if(typeof sb === 'undefined' || !sb){ toast('云端未连接'); return; }
  PARTY.roomId = String(roomId || '').toUpperCase().trim();
  PARTY.isHost = !!isHost;
  if(!PARTY.roomId) return;

  const ch = sb.channel('party:' + PARTY.roomId, {
    config: {
      broadcast: { self: false },
      presence:  { key: lyMyId() }
    }
  });

  ch.on('broadcast', { event:'sync' }, ({ payload }) => {
    if(!payload || payload.from === lyMyId()) return;
    partyApplyRemote(payload);
  });

  ch.on('broadcast', { event:'danmaku' }, ({ payload }) => {
    if(!payload || payload.from === lyMyId()) return;
    DANMAKU.list.push({
      time: Number(payload.time) || 0,
      text: String(payload.text || ''),
      color: payload.color || '#fff',
      user: payload.user || '房友',
      isSelf: false
    });
    DANMAKU.list.sort((a,b) => a.time - b.time);
  });

  ch.on('presence', { event:'sync' }, () => {
    PARTY.members.clear();
    const st = ch.presenceState();
    Object.keys(st).forEach(k => {
      (st[k] || []).forEach(p => {
        PARTY.members.set(p.id, { name: p.name || '?', avatar: p.avatar || '👤' });
      });
    });
    renderPartyBody();
  });

  PARTY.channel = ch;

  ch.subscribe(async status => {
    if(status === 'SUBSCRIBED'){
      await ch.track({ id: lyMyId(), name: lyMyName(), avatar: lyMyAvatar() });
      if(isHost){
        partyBroadcast({ type:'hello', name: lyMyName(), movieName: (state.current && state.current.vod_name) || '' });
      }else{
        partyBroadcast({ type:'join-request' });
      }
      toast(isHost ? '房间已创建：' + PARTY.roomId : '已加入房间：' + PARTY.roomId);
      bindPartyVideoEvents();
      renderPartyBody();
    }
  });
}

function partyLeaveRoom(){
  if(PARTY.channel){
    try{ PARTY.channel.unsubscribe(); }catch(e){}
    PARTY.channel = null;
  }
  PARTY.roomId = '';
  PARTY.isHost = false;
  PARTY.members.clear();
  renderPartyBody();
}

function partyApplyRemote(payload){
  if(!payload) return;
  const v = document.getElementById('video');

  PARTY._remoteApplying = true;
  clearTimeout(PARTY._remoteTimer);
  PARTY._remoteTimer = setTimeout(() => { PARTY._remoteApplying = false; }, 1200);

  if(payload.type === 'play'){
    if(v) v.play().catch(()=>{});
    if(payload.t != null && v) setTimeout(() => { try{ v.currentTime = payload.t; }catch(e){} }, 200);
  } else if(payload.type === 'pause'){
    if(v) v.pause();
  } else if(payload.type === 'seek'){
    if(v && payload.t != null) try{ v.currentTime = payload.t; }catch(e){}
  } else if(payload.type === 'episode'){
    if(payload.lineIdx != null && payload.epIdx != null &&
       (state.lineIdx !== payload.lineIdx || state.epIdx !== payload.epIdx)){
      playEpisode(payload.lineIdx, payload.epIdx);
      setTimeout(() => { if(v && payload.t) try{ v.currentTime = payload.t; }catch(e){} }, 900);
    }
  } else if(payload.type === 'join-request'){
    if(PARTY.isHost && state.current){
      partyBroadcast({
        type: 'state',
        movieName: state.current.vod_name,
        lineIdx: state.lineIdx,
        epIdx:   state.epIdx,
        t:       v ? v.currentTime : 0,
        paused:  v ? v.paused : true
      });
    }
  } else if(payload.type === 'state'){
    if(!state.current || state.current.vod_name !== payload.movieName){
      toast('房主正在看《' + payload.movieName + '》，请自行搜索打开同一部影片');
      return;
    }
    if(state.lineIdx !== payload.lineIdx || state.epIdx !== payload.epIdx){
      playEpisode(payload.lineIdx, payload.epIdx);
    }
    setTimeout(() => {
      if(v && payload.t) try{ v.currentTime = payload.t; }catch(e){}
      if(v && !payload.paused) v.play().catch(()=>{});
    }, 900);
  } else if(payload.type === 'hello'){
    toast('房间成员：' + (payload.name || '房主') + ' 已上线');
  }
}

function bindPartyVideoEvents(){
  const v = document.getElementById('video');
  if(!v || PARTY._bound) return;
  PARTY._bound = true;

  v.addEventListener('play', () => {
    if(!PARTY.channel || PARTY._remoteApplying) return;
    partyBroadcast({ type:'play', t: v.currentTime });
  });
  v.addEventListener('pause', () => {
    if(!PARTY.channel || PARTY._remoteApplying) return;
    if(v.ended) return;
    partyBroadcast({ type:'pause', t: v.currentTime });
  });
  v.addEventListener('seeked', () => {
    if(!PARTY.channel || PARTY._remoteApplying) return;
    partyBroadcast({ type:'seek', t: v.currentTime });
  });
}

function openPartyDialog(){
  document.getElementById('partyMask').classList.add('open');
  document.getElementById('partyDialog').classList.add('open');
  renderPartyBody();
}

function closePartyDialog(e){
  if(e && e.target && !e.target.classList.contains('clear-mask')) return;
  document.getElementById('partyMask').classList.remove('open');
  document.getElementById('partyDialog').classList.remove('open');
}

function renderPartyBody(){
  const box = document.getElementById('partyBody');
  const btn = document.getElementById('vPartyBtn');
  if(btn){
    btn.textContent = partyInRoom() ? ('👥 ' + PARTY.roomId) : '👥 同步';
    btn.style.color = partyInRoom() ? 'var(--brand)' : '';
  }
  if(!box) return;

  if(!partyInRoom()){
    box.innerHTML = `
      <div class="party-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="font-size:13px;color:var(--muted);line-height:1.7">
          创建一个房间，把房间号发给朋友，同一部影片的播放、暂停、切集、拖进度会实时同步。
          无需视频流中转，只同步控制指令。
        </div>
        <button class="mini-btn" style="width:100%;padding:12px" onclick="partyCreate()">＋ 创建房间</button>
      </div>
      <div class="party-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <input id="partyJoinInput" type="text" placeholder="输入房间号，如 A3F7K9"
          style="width:100%;padding:11px 14px;border-radius:10px;background:#0a0d13;border:1px solid var(--line);color:var(--text);font-size:14px;font-family:ui-monospace,monospace;letter-spacing:2px;text-transform:uppercase;outline:none">
        <button class="mini-btn" style="width:100%;padding:12px" onclick="partyJoinFromInput()">→ 加入房间</button>
      </div>
      <div class="hint" style="margin-top:12px">
        提示：房主与成员请先各自搜索并打开<b style="color:var(--brand)">同一部影片</b>，再开始同步播放。
        房主切集时，成员会自动跟随（若已在看同部影片）。
      </div>`;
    return;
  }

  const members = [...PARTY.members.entries()];
  box.innerHTML = `
    <div class="party-row" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="font-size:12.5px;color:var(--muted)">房间号（点击复制）</div>
      <div class="party-code" onclick="partyCopyCode()" title="点击复制">${esc(PARTY.roomId)}</div>
      <div style="font-size:11.5px;color:var(--muted);text-align:center">
        ${PARTY.isHost ? '你是房主' : '你是成员'} · 当前 ${members.length} 人在线
      </div>
    </div>
    <div class="party-row" style="flex-direction:column;align-items:stretch;gap:6px;border-top:1px solid var(--line);padding-top:12px">
      <div style="font-size:12.5px;font-weight:600;color:#c8d2e2;margin-bottom:4px">在线成员</div>
      ${members.map(([id, m]) => `
        <div class="party-member">
          <div class="dot"></div>
          <div class="av">${typeof avatarInner === 'function' ? avatarInner(m.avatar) : '👤'}</div>
          <div class="nm">${esc(m.name)}${id === lyMyId() ? '（你）' : ''}</div>
        </div>`).join('') || '<div style="font-size:12px;color:var(--muted)">正在连接…</div>'}
    </div>
    <div class="party-row" style="border-top:1px solid var(--line);padding-top:12px">
      <button class="mini-btn" style="width:100%;padding:12px;color:#ff9a9a;border-color:rgba(255,107,107,.3)"
        onclick="partyLeaveRoom();renderPartyBody();">🚪 离开房间</button>
    </div>
    <div class="hint" style="margin-top:10px">
      播放/暂停/切集/拖进度会自动同步给所有成员。<br>
      若你正在看的影片与房主不同，切集同步可能失效，请先确保同一部影片。
    </div>`;
}

function partyJoinFromInput(){
  const inp = document.getElementById('partyJoinInput');
  const code = (inp && inp.value || '').trim().toUpperCase();
  if(!code || code.length < 4) return toast('请输入房间号');
  partyJoinRoom(code, false);
}

function partyCopyCode(){
  if(!PARTY.roomId) return;
  navigator.clipboard.writeText(PARTY.roomId)
    .then(() => toast('房间号已复制'))
    .catch(() => prompt('手动复制房间号：', PARTY.roomId));
}

/* ═══════════════════════════════════════════════════════════════
 * 2. 弹幕
 * ═══════════════════════════════════════════════════════════════ */
const DANMAKU = {
  enabled: true,
  list: [],
  loopTimer: null,
  _laneFreeAt: [],
  _lanes: 5,
  _loadedFor: ''
};

function toggleDanmaku(){
  DANMAKU.enabled = !DANMAKU.enabled;
  const btn = document.getElementById('vDanmakuBtn');
  const row = document.getElementById('vDanmakuRow');
  const layer = document.getElementById('danmakuLayer');
  if(btn) btn.style.color = DANMAKU.enabled ? 'var(--brand)' : '';
  if(row) row.style.display = DANMAKU.enabled ? 'flex' : 'none';
  if(layer) layer.style.display = DANMAKU.enabled ? '' : 'none';
  if(!DANMAKU.enabled) clearDanmakuLayer();
  try{ localStorage.setItem('lingyuan_danmaku_on_v1', DANMAKU.enabled ? '1' : '0'); }catch(e){}
  toast(DANMAKU.enabled ? '💬 弹幕已开启' : '💬 弹幕已关闭');
}

function clearDanmakuLayer(){
  const layer = document.getElementById('danmakuLayer');
  if(layer) layer.innerHTML = '';
  DANMAKU._laneFreeAt = [];
}

function currentDanmakuKey(){
  if(!state.current) return '';
  return movieKey(state.current) + '::' + (state.epIdx || 0);
}

async function loadDanmakuForCurrent(){
  const key = currentDanmakuKey();
  if(!key || DANMAKU._loadedFor === key) return;
  DANMAKU._loadedFor = key;
  DANMAKU.list = [];
  clearDanmakuLayer();

  try{
    const cached = JSON.parse(localStorage.getItem('lingyuan_danmaku_v1::' + key) || '[]');
    if(Array.isArray(cached)) DANMAKU.list = cached.map(d => ({ ...d, isSelf: false }));
  }catch(e){}

  if(typeof supabaseReady !== 'undefined' && supabaseReady && typeof sb !== 'undefined' && sb && state.current){
    try{
      const { data } = await sb.from('danmaku')
        .select('time_sec,text,color,user_id,user_name')
        .eq('movie_key', movieKey(state.current))
        .eq('episode_index', state.epIdx || 0)
        .order('time_sec', { ascending: true })
        .limit(3000);
      if(Array.isArray(data)){
        const merged = new Map();
        DANMAKU.list.forEach(d => merged.set(d.time + '|' + d.text, d));
        data.forEach(r => {
          const k = Number(r.time_sec) + '|' + r.text;
          if(!merged.has(k)){
            merged.set(k, {
              time: Number(r.time_sec),
              text: r.text,
              color: r.color || '#fff',
              user: r.user_name || '匿名',
              isSelf: false
            });
          }
        });
        DANMAKU.list = [...merged.values()].sort((a,b) => a.time - b.time);
      }
    }catch(e){ /* 表可能未创建，静默 */ }
  }
  startDanmakuLoop();
}

function startDanmakuLoop(){
  stopDanmakuLoop();
  let lastT = -1;
  let cursor = 0; // 列表按时间有序，用游标避免每 250ms 全量遍历
  DANMAKU.loopTimer = setInterval(() => {
    if(!DANMAKU.enabled) return;
    const v = document.getElementById('video');
    if(!v) return;
    const t = v.currentTime || 0;

    if(lastT >= 0 && (t < lastT - 1.5 || t > lastT + 3)){
      clearDanmakuLayer();
      cursor = 0;
      // 回退/跳转后重置展示标记，让该位置的弹幕重新出现
      DANMAKU.list.forEach(d => { d._shown = false; });
    }
    lastT = t;

    if(v.paused) return;

    const list = DANMAKU.list;
    // 【优化】从上次位置附近继续扫描（兼容播放中新插入的弹幕，回看 30 条）
    const backStart = Math.max(0, cursor - 30);
    let i = backStart;
    for(; i < list.length; i++){
      const d = list[i];
      if(d.time > lastT + 0.15) break; // 已排序，后面的都还没到时间
      if(d._shown) continue;
      if(d.time < lastT - 0.6){ d._shown = true; continue; }
      d._shown = true;
      renderDanmakuItem(d);
    }
    if(i > cursor) cursor = i; // 只前进，不回退
  }, 250);
}

function stopDanmakuLoop(){
  if(DANMAKU.loopTimer){ clearInterval(DANMAKU.loopTimer); DANMAKU.loopTimer = null; }
}

function renderDanmakuItem(d){
  if(!DANMAKU.enabled) return;
  if(danmakuBlocked(d)){ d._shown = true; return; } // 【新功能】屏蔽词/屏蔽用户不渲染
  const layer = document.getElementById('danmakuLayer');
  if(!layer || !d || !d.text) return;

  const v = document.getElementById('video');
  const vw = (v && v.clientWidth) || layer.clientWidth || 640;

  const el = document.createElement('div');
  el.className = 'dm-item' + (d.isSelf ? ' self' : '');
  el.textContent = d.text;
  el.style.color = d.color || '#fff';

  const now = performance.now();
  let lane = 0;
  for(let i = 0; i < DANMAKU._lanes; i++){
    if((DANMAKU._laneFreeAt[i] || 0) <= now){ lane = i; break; }
    lane = i;
  }
  const topPct = 6 + lane * (80 / DANMAKU._lanes);
  el.style.top = topPct + '%';

  const approxWidth = Math.min(600, Math.max(80, d.text.length * 18));
  const dur = Math.max(6, Math.min(14, (vw + approxWidth) / 100));
  el.style.animationDuration = dur + 's';
  layer.appendChild(el);

  DANMAKU._laneFreeAt[lane] = now + dur * 1000 * 0.85;

  setTimeout(() => {
    if(el.parentNode) el.parentNode.removeChild(el);
  }, dur * 1000 + 200);
}

/* ---------- 弹幕屏蔽（新功能） ---------- */
function danmakuBlockList(){
  try{ return JSON.parse(localStorage.getItem('lingyuan_danmaku_block_v1') || '{"words":[],"users":[]}'); }
  catch(e){ return { words: [], users: [] }; }
}
function saveDanmakuBlockList(b){
  try{ localStorage.setItem('lingyuan_danmaku_block_v1', JSON.stringify(b)); }catch(e){}
}
function danmakuBlocked(d){
  if(!d) return false;
  const b = danmakuBlockList();
  const t = String(d.text || '').toLowerCase();
  const u = String(d.user || '');
  return b.words.some(w => w && t.includes(String(w).toLowerCase()))
      || b.users.some(x => x && u === x);
}
function openDanmakuBlockCfg(){
  const b = danmakuBlockList();
  const words = b.words.join('，') || '（无）';
  const users = b.users.join('，') || '（无）';
  const input = prompt(
    '当前屏蔽词：' + words + '\n当前屏蔽用户：' + users +
    '\n\n· 输入关键词（多个用英文逗号分隔）→ 屏蔽包含该词的弹幕\n' +
    '· 输入 "u:用户名" → 屏蔽指定用户\n' +
    '· 输入 "清空" → 清空全部屏蔽\n' +
    '· 留空或取消 → 不修改'
  );
  if(input == null) return;
  const v = String(input).trim();
  if(v === '清空'){
    saveDanmakuBlockList({ words: [], users: [] });
    DANMAKU.list.forEach(d => { d._shown = false; });
    clearDanmakuLayer();
    toast('已清空弹幕屏蔽列表');
    return;
  }
  if(v.startsWith('u:')){
    const uname = v.slice(2).trim();
    if(!uname) return;
    const nb = danmakuBlockList();
    if(!nb.users.includes(uname)) nb.users.push(uname);
    saveDanmakuBlockList(nb);
    DANMAKU.list.forEach(d => { d._shown = false; });
    clearDanmakuLayer();
    toast('已屏蔽用户：' + uname);
    return;
  }
  const ws = v.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if(!ws.length) return;
  const nb = danmakuBlockList();
  let added = 0;
  ws.forEach(w => { if(w && !nb.words.includes(w)){ nb.words.push(w); added++; } });
  saveDanmakuBlockList(nb);
  DANMAKU.list.forEach(d => { d._shown = false; });
  clearDanmakuLayer();
  toast(added ? ('已屏蔽 ' + added + ' 个关键词') : '这些关键词已在屏蔽列表中');
}

function sendDanmakuFromInput(){
  const inp = document.getElementById('vDanmakuInput');
  if(!inp) return;
  sendDanmaku(inp.value);
  inp.value = '';
}

async function sendDanmaku(text){
  text = String(text || '').trim();
  if(!text) return;
  if(text.length > 80) text = text.slice(0, 80);
  if(!state.current) return toast('请先打开一部影片');
  const v = document.getElementById('video');
  const t = v ? v.currentTime : 0;

  const d = {
    time: t,
    text,
    color: '#ffffff',
    user: lyMyName(),
    isSelf: true
  };

  DANMAKU.list.push(d);
  DANMAKU.list.sort((a,b) => a.time - b.time);
  d._shown = true;
  renderDanmakuItem(d);

  partyBroadcastDanmaku(d);

  if(typeof supabaseReady !== 'undefined' && supabaseReady && typeof sb !== 'undefined' && sb && state.current){
    try{
      sb.from('danmaku').insert({
        movie_key: movieKey(state.current),
        episode_index: state.epIdx || 0,
        time_sec: t,
        text: d.text,
        color: d.color,
        user_id: lyMyId(),
        user_name: d.user
      }).then(() => {}).catch(() => {});
    }catch(e){}
  }

  try{
    const key = currentDanmakuKey();
    const cache = JSON.parse(localStorage.getItem('lingyuan_danmaku_v1::' + key) || '[]');
    cache.push({ time: t, text: d.text, color: d.color, user: d.user });
    if(cache.length > 500) cache.splice(0, cache.length - 500);
    localStorage.setItem('lingyuan_danmaku_v1::' + key, JSON.stringify(cache));
  }catch(e){}
}

/* ═══════════════════════════════════════════════════════════════
 * 3. 离线缓存
 * ═══════════════════════════════════════════════════════════════ */
const OFFLINE = {
  dbName: 'lingyuan_offline_v1',
  store:  'episodes',
  db:     null,
  _cancel: false,
  _blobUrls: []
};

function offlineOpenDb(){
  return new Promise((resolve, reject) => {
    if(!window.indexedDB) return reject(new Error('当前环境不支持 IndexedDB'));
    if(OFFLINE.db) return resolve(OFFLINE.db);
    const req = indexedDB.open(OFFLINE.dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(OFFLINE.store)){
        db.createObjectStore(OFFLINE.store, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { OFFLINE.db = req.result; resolve(OFFLINE.db); };
    req.onerror   = () => reject(req.error || new Error('打开缓存库失败'));
  });
}

function offlineTx(mode){
  return offlineOpenDb().then(db => db.transaction(OFFLINE.store, mode));
}

async function offlinePut(record){
  const tx = await offlineTx('readwrite');
  return new Promise((resolve, reject) => {
    const rq = tx.objectStore(OFFLINE.store).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('写入失败'));
  });
}

async function offlinePutMany(records){
  if(!records || !records.length) return true;
  const CHUNK = 50;
  for(let i = 0; i < records.length; i += CHUNK){
    const chunk = records.slice(i, i + CHUNK);
    const tx = await offlineTx('readwrite');
    await new Promise((resolve, reject) => {
      const store = tx.objectStore(OFFLINE.store);
      chunk.forEach(r => store.put(r));
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('写入失败'));
    });
  }
  return true;
}
async function offlineGet(id){
  const tx = await offlineTx('readonly');
  return new Promise((resolve, reject) => {
    const rq = tx.objectStore(OFFLINE.store).get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror   = () => reject(rq.error || new Error('读取失败'));
  });
}

async function offlineAll(){
  const tx = await offlineTx('readonly');
  return new Promise((resolve, reject) => {
    const rq = tx.objectStore(OFFLINE.store).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror   = () => reject(rq.error || new Error('读取失败'));
  });
}

async function offlineDel(id){
  const tx = await offlineTx('readwrite');
  return new Promise(resolve => {
    tx.objectStore(OFFLINE.store).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => resolve(false);
  });
}

async function offlineClearAll(){
  const tx = await offlineTx('readwrite');
  return new Promise(resolve => {
    tx.objectStore(OFFLINE.store).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => resolve(false);
  });
}

function parseM3U8(text, baseUrl){
  const lines = String(text || '').split(/\r?\n/);
  const segs = [];
  const variants = [];
  let hasVariant = false;
  let hasKey = false;
  let mapUri = '';
  let pendingVariant = null;
  for(const raw of lines){
    const t = raw.trim();
    if(!t) continue;
    if(t.startsWith('#EXT-X-STREAM-INF')){
      hasVariant = true;
      const bw = (t.match(/BANDWIDTH=(\d+)/i) || [])[1] || '';
      const res = (t.match(/RESOLUTION=(\d+x\d+)/i) || [])[1] || '';
      pendingVariant = { bandwidth: parseInt(bw, 10) || 0, resolution: res || '', url: '' };
      continue;
    }
    if(t.startsWith('#EXT-X-KEY')){
      if(!/#EXT-X-KEY:METHOD=NONE/i.test(t)) hasKey = true;
      continue;
    }
    if(t.startsWith('#EXT-X-MAP')){
      const m = t.match(/URI="([^"]+)"/);
      if(m && m[1]){
        try{ mapUri = new URL(m[1], baseUrl).href; }catch(e){ mapUri = m[1]; }
      }
      continue;
    }
    if(t.startsWith('#')) continue;
    let abs;
    try{ abs = new URL(t, baseUrl).href; }catch(e){ abs = t; }
    if(pendingVariant){
      pendingVariant.url = abs;
      variants.push(pendingVariant);
      pendingVariant = null;
    }else{
      segs.push(abs);
    }
  }
  return { segs, hasVariant, hasKey, mapUri, variants };
}
function buildM3U8WithBlobs(originalText, blobUrls, initBlobUrl){
  let i = 0;
  return String(originalText || '').split(/\r?\n/).map(line => {
    const t = line.trim();
    if(!t) return line;
    if(t.startsWith('#EXT-X-MAP')){
      if(!initBlobUrl) return line;
      return t.replace(/URI="[^"]*"/, 'URI="' + initBlobUrl + '"');
    }
    if(t.startsWith('#')) return line;
    return blobUrls[i++] || t;
  }).join('\n');
}
function setCacheToast(show, text, pct){
  const el = document.getElementById('cacheToast');
  if(!el) return;
  if(!show){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  const txt = document.getElementById('cacheToastTxt');
  const bar = document.getElementById('cacheToastBar');
  if(txt) txt.textContent = text || '缓存中…';
  if(bar) bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
}

function cancelCurrentCache(){
  OFFLINE._cancel = true;
  if(OFFLINE._abortCtrl){ try{ OFFLINE._abortCtrl.abort(); }catch(e){} }
  setCacheToast(true, '正在取消…', 0);
}
async function cacheCurrentEpisode(){
  if(!state.current) return toast('请先打开一部影片');
  const line = state.lines[state.lineIdx];
  const ep = line && line.episodes[state.epIdx];
  if(!ep || !ep.url) return toast('当前集没有可缓存的地址');
  const url = ep.url;
  if(!/\.m3u8(\?|#|$)/i.test(url)){
    if(url.startsWith('magnet:')) return toast('磁力链接不支持缓存，请用下载工具');
    return toast('该集不是 m3u8 资源，暂不支持离线缓存');
  }

  const id = movieKey(state.current) + '::' + (state.epIdx || 0);

  OFFLINE._cancel = false;
  OFFLINE._abortCtrl = new AbortController();
  const abortCtrl = OFFLINE._abortCtrl;
  setCacheToast(true, '正在解析 m3u8…', 2);

  try{
    const res = await fetch(proxyUrl(url), { signal: abortCtrl.signal });
    if(!res.ok) throw new Error('m3u8 HTTP ' + res.status);
    const text = await res.text();
    let m3u8Text = text; // 【修复】记录"实际用于播放分片的清单"，多码率时必须是子清单
    let parsed = parseM3U8(text, url);

    // 【优化】多码率主清单：自动选最高清晰度的子清单继续缓存，不再直接拒绝
    if(parsed.hasVariant){
      const vs = parsed.variants || [];
      const best = vs.reduce((a, b) => {
        const sa = (a && (a.bandwidth || a.resolution)) || 0;
        const sb = (b && (b.bandwidth || b.resolution)) || 0;
        return sb > sa ? b : a;
      }, vs[0]);
      if(!best || !best.url){ setCacheToast(false); return toast('❌ 多码率清单解析失败，请换其他线路'); }
      setCacheToast(true, '检测到多码率，正在解析最高清晰度…', 5);
      const res2 = await fetch(proxyUrl(best.url), { signal: abortCtrl.signal });
      if(!res2.ok) throw new Error('子清单 HTTP ' + res2.status);
      const text2 = await res2.text();
      m3u8Text = text2;
      parsed = parseM3U8(text2, best.url);
      toast('多码率清单：已自动选择 ' + (best.resolution || (best.bandwidth ? Math.round(best.bandwidth / 1000) + 'Kbps' : '最高清晰度')));
    }

    if(parsed.hasVariant){ setCacheToast(false); return toast('❌ 多级多码率清单，暂不支持'); }
    if(parsed.hasKey){     setCacheToast(false); return toast('❌ AES 加密分片，暂不支持'); }
    if(!parsed.segs.length){ setCacheToast(false); return toast('❌ 未解析到分片'); }

    const total = parsed.segs.length;

    // ① 断点续传：先扫描已下载的分片
    const doneSet = new Set();
    let totalBytes = 0;
    const CHECK_BATCH = 50;
    for(let s = 0; s < total; s += CHECK_BATCH){
      const jobs = [];
      for(let i = s; i < Math.min(total, s + CHECK_BATCH); i++){
        jobs.push(offlineGet(id + '::seg::' + i).catch(() => null).then(seg => ({ i, seg })));
      }
      (await Promise.all(jobs)).forEach(({ i, seg }) => {
        if(seg && seg.blob && seg.blob.size > 0){ doneSet.add(i); totalBytes += seg.blob.size; }
      });
    }
    let doneCount = doneSet.size;
    if(doneCount) toast('检测到已缓存 ' + doneCount + ' 个分片，继续下载剩余部分');

    // ② 单分片下载：30s 超时 + 3 次指数退避重试
    const SEG_TIMEOUT = 30000;
    const RETRY       = 3;
    async function fetchSeg(u, signal){
      let lastErr;
      for(let attempt = 0; attempt < RETRY; attempt++){
        if(OFFLINE._cancel) throw new DOMException('Cancelled','AbortError');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SEG_TIMEOUT);
        const onAbort = () => ctrl.abort();
        signal.addEventListener('abort', onAbort);
        try{
          const r = await fetch(proxyUrl(u), { signal: ctrl.signal }); // 【修复】经本地代理，避开视频站 CORS
          if(!r.ok) throw new Error('HTTP ' + r.status);
          const b = await r.blob();
          if(!b || !b.size) throw new Error('空分片');
          return b;
        }catch(e){
          lastErr = e;
          if(signal.aborted) throw e;
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }finally{
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
        }
      }
      throw lastErr;
    }

    // ③ 边下边写 IndexedDB，失败只记录，不中断全部
    const CONCURRENCY = 8;
    const startPct = 5, endPct = 95;
    let cursor = 0;
    const failedIdx = [];

    async function worker(){
      while(true){
        if(OFFLINE._cancel) return;
        const i = cursor++;
        if(i >= total) return;
        if(doneSet.has(i)) continue;
        try{
          const b = await fetchSeg(parsed.segs[i], abortCtrl.signal);
          await offlinePut({ id: id + '::seg::' + i, blob: b });
          doneSet.add(i); doneCount++; totalBytes += b.size;
          setCacheToast(true,
            '缓存中 ' + doneCount + '/' + total + ' · ' + fmtBytes(totalBytes),
            startPct + Math.round(doneCount / total * (endPct - startPct)));
        }catch(e){
          if(e.name === 'AbortError' && OFFLINE._cancel) return;
          failedIdx.push(i);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

    if(OFFLINE._cancel) throw new Error('__CANCEL__');

    // ④ 失败分片统一重试一轮
    if(failedIdx.length){
      setCacheToast(true, '重试 ' + failedIdx.length + ' 个失败分片…', 96);
      const retryList = failedIdx.splice(0);
      for(const i of retryList){
        if(OFFLINE._cancel) throw new Error('__CANCEL__');
        try{
          const b = await fetchSeg(parsed.segs[i], abortCtrl.signal);
          await offlinePut({ id: id + '::seg::' + i, blob: b });
          doneSet.add(i); doneCount++; totalBytes += b.size;
        }catch(e){ failedIdx.push(i); }
      }
    }

    // ⑤ 仍有失败：保留已完成部分，下次点缓存可续传
    if(failedIdx.length){
      setCacheToast(false);
      throw new Error(failedIdx.length + ' 个分片失败（已保留 ' + doneCount + ' 个，下次点缓存可续传）');
    }

    // ⑥ fMP4 初始化段
    let mapBlob = null;
    if(parsed.mapUri){
      setCacheToast(true, '正在下载初始化段…', 96);
      try{
        mapBlob = await fetchSeg(parsed.mapUri, abortCtrl.signal);
        await offlinePut({ id: id + '::seg::init', blob: mapBlob });
        totalBytes += mapBlob.size;
      }catch(e){
        setCacheToast(false);
        throw new Error('INIT 段下载失败，请换线路');
      }
    }

    const record = {
      id,
      movieKey: movieKey(state.current),
      movieName: state.current.vod_name || '未知影片',
      pic: state.current.vod_pic || '',
      epIdx: state.epIdx || 0,
      epName: ep.name || ('第' + (state.epIdx + 1) + '集'),
      m3u8: m3u8Text, /* 【修复】必须是实际解析分片用的清单（多码率时为子清单） */
      segCount: parsed.segs.length,
      totalBytes,
      hasInit: !!mapBlob,
      createdAt: Date.now()
    };

    setCacheToast(true, '正在写入索引…', 98);
    await offlinePut(record);

    setCacheToast(true, '✅ 缓存完成 · ' + fmtBytes(totalBytes), 100);
    setTimeout(() => setCacheToast(false), 2000);
    toast('✅ 已缓存：' + record.movieName + ' · ' + record.epName);

  }catch(e){
    setCacheToast(false);
    if(e.message === '__CANCEL__' || e.name === 'AbortError') toast('已取消缓存');
    else { console.warn('[离线缓存]', e); toast('❌ 缓存失败：' + (e.message || '未知错误')); }
  }finally{
    OFFLINE._abortCtrl = null;
  }
}
function fmtBytes(n){
  n = Number(n) || 0;
  if(n < 1024) return n + ' B';
  if(n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if(n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function playCachedEpisodeById(id){
  const record = await offlineGet(id);
  if(!record) return toast('缓存不存在');
  // 【优化】分批并行读取分片，避免数百个分片串行等待
  const blobs = new Array(record.segCount);
  const CHUNK = 24;
  for(let s = 0; s < record.segCount; s += CHUNK){
    const jobs = [];
    for(let i = s; i < Math.min(record.segCount, s + CHUNK); i++){
      jobs.push(offlineGet(id + '::seg::' + i).then(seg => ({ i, seg })));
    }
    const res = await Promise.all(jobs);
    for(const { i, seg } of res){
      if(!seg || !seg.blob) return toast('缓存分片缺失，请重新缓存');
      blobs[i] = seg.blob;
    }
  }
  const blobUrls = blobs.map(b => URL.createObjectURL(b));

  let initBlobUrl = '';
  if(record.hasInit){
    const initSeg = await offlineGet(id + '::seg::init');
    if(initSeg && initSeg.blob) initBlobUrl = URL.createObjectURL(initSeg.blob);
  }

  OFFLINE._blobUrls.forEach(u => { try{ URL.revokeObjectURL(u); }catch(e){} });
  OFFLINE._blobUrls = blobUrls;
  if(initBlobUrl) OFFLINE._blobUrls.push(initBlobUrl);

  const newM3u8 = buildM3U8WithBlobs(record.m3u8, blobUrls, initBlobUrl);
  const m3u8Blob = new Blob([newM3u8], { type: 'application/vnd.apple.mpegurl' });
  const m3u8Url = URL.createObjectURL(m3u8Blob);
  OFFLINE._blobUrls.push(m3u8Url);

  try{
    const detailEl = document.getElementById('view-detail');
    if(detailEl && !detailEl.classList.contains('active')){
      if(typeof showView === 'function') showView('view-detail');
    }
    const offDlg = document.getElementById('offlineDialog');
    if(offDlg && offDlg.classList.contains('open')){
      document.getElementById('offlineMask')?.classList.remove('open');
      offDlg.classList.remove('open');
    }
    if(typeof state !== 'undefined'){
      state.current = {
        vod_name: record.movieName || '离线缓存',
        vod_pic:  record.pic || '',
        _offline: true
      };
      state.lines = [{
        name: '离线缓存',
        episodes: [{
          name: record.epName || ('第' + ((record.epIdx || 0) + 1) + '集'),
          url: 'offline://' + id
        }]
      }];
      state.lineIdx = 0;
      state.epIdx = 0;
      state.currentUrl = '';
      if(typeof renderLines === 'function') renderLines();
      if(typeof updateVideoTitle === 'function') updateVideoTitle();
      if(typeof updateFavBtn === 'function') updateFavBtn();
    }
    const dTitle = document.getElementById('dTitle');
    if(dTitle) dTitle.textContent = record.movieName || '离线缓存';
    const dPoster = document.getElementById('dPoster');
    if(dPoster && record.pic) dPoster.src = record.pic;
    const dMeta = document.getElementById('dMeta');
    if(dMeta) dMeta.innerHTML = '<span style="color:var(--brand);font-size:13px">📥 正在播放离线缓存 · 无需网络</span>';
    const dDesc = document.getElementById('dDesc');
    if(dDesc) dDesc.textContent = '本集已完整缓存到本机，断网也能播放。';
  }catch(e){ console.warn('[离线播放 UI]', e); }

  const video = document.getElementById('video');
  if(typeof hlsInstance !== 'undefined' && hlsInstance){ try{ hlsInstance.destroy(); }catch(e){} hlsInstance = null; }
  video.removeAttribute('src'); video.load();
  if(typeof showVideoLoading === 'function') showVideoLoading();

  if(window.Hls && Hls.isSupported()){
    hlsInstance = new Hls({ maxBufferLength: 60 });
    hlsInstance.loadSource(m3u8Url);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.ERROR, (e, data) => {
      if(data.fatal){ hideVideoLoading(); toast('离线播放失败，请重新缓存'); }
    });
  }else if(video.canPlayType('application/vnd.apple.mpegurl')){
    video.src = m3u8Url;
  }else{
    return toast('当前浏览器不支持 HLS 播放');
  }
  video.play().catch(()=>{});
  toast('▶ 正在播放离线缓存');
}
async function openOfflineDialog(){
  document.getElementById('offlineMask').classList.add('open');
  document.getElementById('offlineDialog').classList.add('open');
  await renderOfflineList();
}

function closeOfflineDialog(e){
  if(e && e.target && !e.target.classList.contains('clear-mask')) return;
  document.getElementById('offlineMask').classList.remove('open');
  document.getElementById('offlineDialog').classList.remove('open');
}

async function renderOfflineList(){
  const box = document.getElementById('offlineBody');
  const sum = document.getElementById('offlineSummary');
  if(!box) return;
  let all = [];
  try{ all = await offlineAll(); }catch(e){ all = []; }

  const records = all.filter(r => r && r.movieKey && r.segCount != null);
  records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if(!records.length){
    box.innerHTML = `<div class="off-empty">
      🎬 还没有离线内容<br>
      <span style="font-size:12px;opacity:.8">播放影片时点击剧集旁的 ⬇ 图标即可缓存本集</span>
    </div>`;
    if(sum) sum.innerHTML = '共 0 集 · 0 B';
    return;
  }

  const groups = new Map();
  records.forEach(r => {
    if(!groups.has(r.movieKey)) groups.set(r.movieKey, { name: r.movieName, pic: r.pic, items: [] });
    groups.get(r.movieKey).items.push(r);
  });

  let totalBytes = 0;
  let html = '<div class="off-list">';
  groups.forEach((g, mkey) => {
    html += `<div style="font-size:13px;font-weight:700;color:#c8d2e2;margin:8px 0 6px;padding-left:2px">
      ${esc(g.name)} <span style="color:var(--muted);font-weight:500;font-size:11.5px">· ${g.items.length} 集</span>
    </div>`;
    g.items.forEach(r => {
      totalBytes += r.totalBytes || 0;
      html += `<div class="off-item">
        <div class="off-poster">${r.pic ? `<img loading="lazy" src="${esc(r.pic)}" alt="" onerror="this.remove()">` : ''}</div>
        <div class="off-info">
          <div class="off-name">${esc(r.epName || ('第' + (r.epIdx + 1) + '集'))}</div>
          <div class="off-meta">${fmtBytes(r.totalBytes)} · ${r.segCount} 个分片 · ${fmtWhen(r.createdAt)}</div>
        </div>
        <div class="off-acts">
          <button onclick="playCachedEpisodeById('${esc(r.id)}')">▶ 播放</button>
          <button class="danger" onclick="deleteOfflineItem('${esc(r.id)}', ${r.segCount})">✕</button>
        </div>
      </div>`;
    });
  });
  html += '</div>';
  box.innerHTML = html;
  if(sum) sum.innerHTML = `共 <b>${records.length}</b> 集 · 约 <b>${fmtBytes(totalBytes)}</b> · 保存在本机`;
}

async function deleteOfflineItem(id, segCount){
  if(!confirm('确定删除这个缓存？')) return;
  await offlineDel(id);
  for(let i = 0; i < (segCount || 0); i++){
    await offlineDel(id + '::seg::' + i);
  }
  await offlineDel(id + '::seg::init');
  toast('已删除');
  renderOfflineList();
}
async function clearAllOffline(){
  if(!confirm('确定要清除全部离线缓存吗？此操作不可恢复。')) return;
  await offlineClearAll();
  toast('已清除全部离线缓存');
  renderOfflineList();
}

function releaseOfflineBlobs(){
  OFFLINE._blobUrls.forEach(u => { try{ URL.revokeObjectURL(u); }catch(e){} });
  OFFLINE._blobUrls = [];
}

/* ═══════════════════════════════════════════════════════════════
 * 4. 集成钩子
 * ═══════════════════════════════════════════════════════════════ */

(function hookPlayEpisode(){
  if(typeof window.playEpisode !== 'function') return;
  const orig = window.playEpisode;
  window.playEpisode = function(lineIdx, epIdx){
    orig.apply(this, arguments);
    if(PARTY.channel && !PARTY._remoteApplying){
      const v = document.getElementById('video');
      partyBroadcast({
        type: 'episode',
        lineIdx, epIdx,
        t: v ? v.currentTime : 0
      });
    }
    DANMAKU._loadedFor = '';
    DANMAKU.list = [];
    clearDanmakuLayer();
    setTimeout(loadDanmakuForCurrent, 300);
  };
})();

(function hookOpenMovie(){
  if(typeof window.openMovie !== 'function') return;
  const orig = window.openMovie;
  window.openMovie = function(m, opts){
    orig.apply(this, arguments);
    DANMAKU._loadedFor = '';
    setTimeout(loadDanmakuForCurrent, 600);
  };
})();

(function hookStopVideo(){
  if(typeof window.stopVideo !== 'function') return;
  const orig = window.stopVideo;
  window.stopVideo = function(){
    orig.apply(this, arguments);
    releaseOfflineBlobs();
    stopDanmakuLoop();
  };
})();

(function hookDownloadEpisode(){
  if(typeof window.downloadEpisode !== 'function') return;
  const orig = window.downloadEpisode;
  window.downloadEpisode = function(url, event){
    if(event) event.stopPropagation();
    if(url && /\.m3u8(\?|#|$)/i.test(url)){
      cacheCurrentEpisode();
      return;
    }
    return orig.apply(this, arguments);
  };
})();

document.addEventListener('keydown', e => {
  if(e.target && e.target.id === 'vDanmakuInput' && e.key === 'Enter'){
    e.preventDefault();
    sendDanmakuFromInput();
  }
});

window.addEventListener('pagehide', releaseOfflineBlobs);

(function initDanmakuState(){
  try{
    const v = localStorage.getItem('lingyuan_danmaku_on_v1');
    if(v === '0'){
      DANMAKU.enabled = false;
      const row = document.getElementById('vDanmakuRow');
      const layer = document.getElementById('danmakuLayer');
      const btn = document.getElementById('vDanmakuBtn');
      if(row) row.style.display = 'none';
      if(layer) layer.style.display = 'none';
      if(btn) btn.style.color = '';
    }
  }catch(e){}
})();

async function renderOfflineInProfile(box){
  box = box || document.getElementById('pfBody');
  if(!box) return;
  let all = [];
  try{ all = await offlineAll(); }catch(e){ all = []; }
  const records = (Array.isArray(all) ? all : []).filter(r => r && r.movieKey && r.segCount != null);
  records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if(!records.length){
    box.innerHTML = (typeof profileEmpty === 'function')
      ? profileEmpty('📥', '还没有离线内容', '播放影片时点击剧集旁的 ⬇ 图标即可缓存本集，缓存后可断网观看')
      : '<div class="empty"><div class="big">📥</div><h3>还没有离线内容</h3><p>播放影片时点击剧集旁的 ⬇ 图标即可缓存本集</p></div>';
    return;
  }

  const groups = new Map();
  records.forEach(r => {
    if(!groups.has(r.movieKey)) groups.set(r.movieKey, { name: r.movieName, pic: r.pic, items: [] });
    groups.get(r.movieKey).items.push(r);
  });

  const totalBytes = records.reduce((s, r) => s + (r.totalBytes || 0), 0);

  let html = `<div class="pf-bar">
    <span class="pf-bar-t">共 <b>${records.length}</b> 集 · <b>${fmtBytes(totalBytes)}</b> · 保存在本机</span>
    <button class="mini-btn" style="flex:0 0 auto;width:auto;min-width:0;padding:8px 16px" onclick="clearAllOfflineFromProfile()">🗑 全部清除</button>
  </div>`;

  groups.forEach((g) => {
    html += `<div class="date-sep"><span>${esc(g.name)}</span><em>${g.items.length} 集</em></div>`;
    html += '<div class="his-list">';
    g.items.forEach(r => {
      html += `<div class="his-item">
        <div class="his-poster">${r.pic ? `<img loading="lazy" src="${esc(r.pic)}" alt="" onerror="this.remove()">` : ''}</div>
        <div class="his-info">
          <div class="his-name">${esc(r.epName || ('第' + ((r.epIdx || 0) + 1) + '集'))}</div>
          <div class="his-meta">${fmtBytes(r.totalBytes)} · ${r.segCount} 个分片</div>
          <div class="his-time">🕒 ${esc(fmtWhen(r.createdAt))}</div>
        </div>
        <div class="his-acts">
          <button onclick="event.stopPropagation();playCachedEpisodeById('${esc(r.id)}')">▶ 播放</button>
          <button class="danger" onclick="event.stopPropagation();deleteOfflineFromProfile('${esc(r.id)}', ${r.segCount})">✕</button>
        </div>
      </div>`;
    });
    html += '</div>';
  });

  box.innerHTML = html;
}

async function deleteOfflineFromProfile(id, segCount){
  if(!confirm('确定删除这个缓存？')) return;
  await offlineDel(id);
  for(let i = 0; i < (segCount || 0); i++){
    await offlineDel(id + '::seg::' + i);
  }
  await offlineDel(id + '::seg::init');
  toast('已删除');
  renderOfflineInProfile();
}
async function clearAllOfflineFromProfile(){
  if(!confirm('确定要清除全部离线缓存吗？此操作不可恢复。')) return;
  await offlineClearAll();
  toast('已清除全部离线缓存');
  renderOfflineInProfile();
}

function openOfflineInProfile(){
  const panel = document.getElementById('panel');
  if(panel && panel.classList.contains('open') && typeof togglePanel === 'function') togglePanel();
  pfTab = 'offline';
  document.querySelectorAll('.pf-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === 'offline'));
  if(typeof showView === 'function') showView('view-profile');
  if(typeof renderProfile === 'function') renderProfile();
}
console.log('[澪鸢] 观影派对 / 弹幕 / 离线缓存 模块已加载');