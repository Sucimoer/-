/* =========================================================
 *  ★ 全局错误捕获
 * =======================================================*/
window.addEventListener('error', function(e){
  try{
    var bar = document.getElementById('globalErrBar');
    var msg = document.getElementById('globalErrMsg');
    if(bar && msg){
      msg.textContent = (e.message || '未知错误') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '?');
      bar.classList.add('show');
    }
  }catch(_){}
  console.error('[澪鸢] 全局错误:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', function(e){
  try{
    var bar = document.getElementById('globalErrBar');
    var msg = document.getElementById('globalErrMsg');
    if(bar && msg){
      var r = e.reason || {};
      msg.textContent = 'Promise 未捕获：' + (r.message || r.toString() || '未知');
      bar.classList.add('show');
    }
  }catch(_){}
  console.error('[澪鸢] 未处理的 Promise 拒绝:', e.reason);
});

/* =========================================================
 *  ★ 账号输入归一化
 * =======================================================*/
function normalizeAccountInput(s){
  let v = String(s == null ? '' : s);
  try{ v = v.normalize('NFKC'); }catch(e){}
  return v.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
}

function cyrb53(str, seed){
  seed = seed || 0;
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for(let i = 0; i < str.length; i++){
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function usernameToEmail(username){
  username = normalizeAccountInput(username);
  if(/^[a-zA-Z0-9_]{2,20}$/.test(username)){
    return username.toLowerCase() + '@lingyuan.app';
  }
  return 'u' + cyrb53(username) + '@lingyuan.app';
}

/* =========================================================
 *  Supabase 初始化
 * =======================================================*/
const SUPABASE_URL = 'https://rltrkvovbjfdajhwmtsf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_q0vFymf8Zs7YU3xSkmPwCA_Ju9jwNHJ';

let sb = null;
let supabaseReady = false;

function makeFallbackSb(){
  return {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser:    async () => ({ data: { user: null } }),
      signUp:            async () => ({ data: { user: null }, error: { message: '云端功能未加载' } }),
      signInWithPassword: async () => ({ data: { user: null }, error: { message: '云端功能未加载' } }),
      signOut:           async () => ({}),
      updateUser:        async () => ({ error: { message: '云端功能未加载' } })
    },
    rpc: async () => ({ data: null, error: { message: '云端功能未加载' } }),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) })
    })
  };
}

function initSupabaseClient(){
  if(supabaseReady) return;
  try{
    if(typeof supabase === 'undefined'){
      if(!sb) sb = makeFallbackSb();
      return;
    }
    const customFetch = (url, options) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timeoutId));
    };
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { fetch: customFetch }
    });
    supabaseReady = true;
  }catch(err){
    console.error('[澪鸢] Supabase 初始化失败:', err);
    if(!sb) sb = makeFallbackSb();
  }
}

async function pingSupabase(timeoutMs){
  if(!supabaseReady) return false;
  timeoutMs = timeoutMs || 6000;
  try{
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(SUPABASE_URL + '/auth/v1/health', {
      method : 'GET',
      signal : controller.signal,
      headers: { apikey: SUPABASE_KEY }
    });
    clearTimeout(timer);
    return res.status > 0;
  }catch(e){
    return false;
  }
}

const LOCAL_ACC_KEY     = 'lingyuan_local_accounts_v1';
const LOCAL_SESSION_KEY = 'lingyuan_local_session_v1';
const LOCAL_DATA_PREFIX = 'lingyuan_local_data_v1::';
const LOCAL_MODE_PREF   = 'lingyuan_auth_mode_v1';

let AUTH_MODE = 'cloud';

function isLocalMode(){ return AUTH_MODE === 'local'; }
function loadAuthModePref(){
  try{ return localStorage.getItem(LOCAL_MODE_PREF) || ''; }catch(e){ return ''; }
}
function setAuthMode(m){
  AUTH_MODE = (m === 'local') ? 'local' : 'cloud';
  try{ localStorage.setItem(LOCAL_MODE_PREF, AUTH_MODE); }catch(e){}
  updateAuthModeUI();
}
function updateAuthModeUI(){
  const note = document.getElementById('authNote');
  const btn  = document.getElementById('authModeBtn');
  if(note){
    note.innerHTML = isLocalMode()
      ? '📴 <b style="color:#ffb700">本地账户模式</b>：数据只存这台设备，不需要网络；换设备或清缓存会丢失。'
      : '🔒 <b>云端账户模式</b>：数据存在 Supabase，可跨设备登录同一个账号。';
  }
  if(btn){
    btn.textContent = isLocalMode()
      ? '☁️ 切换为云端账户（需网络 / VPN）'
      : '📴 切换为本地账户（无需网络）';
  }
}
function toggleAuthMode(){
  if(isLocalMode()){
    setAuthMode('cloud');
    toast('已切换为云端账户模式（需要能访问 Supabase）');
    if(!supabaseReady) initSupabaseClient();
  }else{
    setAuthMode('local');
    toast('已切换为本地账户模式（数据仅存本机）');
  }
  if(currentUser) toast('提示：请先退出当前账号再切换模式');
}

function loadLocalAccounts(){
  try{
    const o = JSON.parse(localStorage.getItem(LOCAL_ACC_KEY) || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  }catch(e){ return {}; }
}
function saveLocalAccounts(o){
  try{ localStorage.setItem(LOCAL_ACC_KEY, JSON.stringify(o)); return true; }
  catch(e){ return false; }
}
function localAccKey(name){ return String(name || '').trim().toLowerCase(); }
function localDataKey(name){ return LOCAL_DATA_PREFIX + localAccKey(name); }

function loadLocalData(name){
  try{
    const d = JSON.parse(localStorage.getItem(localDataKey(name)) || 'null');
    if(d && typeof d === 'object'){
      return {
        favorites: Array.isArray(d.favorites) ? d.favorites : [],
        history:   Array.isArray(d.history)   ? d.history   : [],
        searches:  normalizeSearches(d.searches),
        avatar:    typeof d.avatar === 'string' ? d.avatar : ''
      };
    }
  }catch(e){}
  return { favorites: [], history: [], searches: [], avatar: '' };
}
function saveLocalData(name, d){
  try{ localStorage.setItem(localDataKey(name), JSON.stringify(d)); return true; }
  catch(e){ return false; }
}
function getLocalSessionName(){
  try{ return localStorage.getItem(LOCAL_SESSION_KEY) || ''; }catch(e){ return ''; }
}
function setLocalSessionName(n){
  try{
    n ? localStorage.setItem(LOCAL_SESSION_KEY, n)
      : localStorage.removeItem(LOCAL_SESSION_KEY);
  }catch(e){}
}

function bytesToHex(buf){
  try{ return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join(''); }
  catch(e){ return ''; }
}
function randomSalt(){
  try{
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return bytesToHex(a);
  }catch(e){
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
async function hashLocalPassword(password, salt){
  const enc = new TextEncoder();
  if(window.crypto && crypto.subtle){
    try{
      const key = await crypto.subtle.importKey(
        'raw', enc.encode(password), { name:'PBKDF2' }, false, ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        { name:'PBKDF2', salt: enc.encode('lingyuan::' + salt), iterations: 60000, hash:'SHA-256' },
        key, 256
      );
      return 'p1_' + bytesToHex(bits);
    }catch(e){}
    try{
      let buf = enc.encode('lingyuan::' + salt + '::' + password);
      for(let i = 0; i < 3000; i++) buf = await crypto.subtle.digest('SHA-256', buf);
      return 's1_' + bytesToHex(buf);
    }catch(e){}
  }
  let h = 'lingyuan::' + salt + '::' + password;
  for(let i = 0; i < 300; i++) h = cyrb53(h + '::' + i, i);
  return 'c1_' + h;
}

function makeLocalUser(acc){
  return {
    id: 'local:' + localAccKey(acc.username),
    email: localAccKey(acc.username) + '@local',
    user_metadata: { nickname: acc.username, avatar: acc.avatar || '🙂' },
    __local: true
  };
}
async function localSignUp(username, password, avatar){
  const accs = loadLocalAccounts();
  const k = localAccKey(username);
  if(accs[k]) return { ok:false, msg:'本机已存在同名账户' };
  const salt = randomSalt();
  const hash = await hashLocalPassword(password, salt);
  accs[k] = {
    username: String(username).trim(),
    salt, hash,
    avatar: avatar || '🙂',
    recoveryHash: '',
    createdAt: Date.now()
  };
  if(!saveLocalAccounts(accs)) return { ok:false, msg:'本地存储失败（可能空间不足或处于无痕模式）' };
  saveLocalData(username, { favorites: [], history: [], searches: [], avatar: avatar || '🙂' });
  setLocalSessionName(k);
  return { ok:true };
}
async function localSignIn(username, password){
  const accs = loadLocalAccounts();
  const acc = accs[localAccKey(username)];
  if(!acc) return { ok:false, msg:'本机没有这个账户' };
  const hash = await hashLocalPassword(password, acc.salt);
  if(hash !== acc.hash) return { ok:false, msg:'密码不正确' };
  setLocalSessionName(localAccKey(username));
  return { ok:true };
}

function genLocalRecoveryCode(){
  if(!currentUser || !currentUser.__local) return;
  const name = userName();
  const accs = loadLocalAccounts();
  const k = localAccKey(name);
  const acc = accs[k];
  if(!acc) return;
  const code = genRecoveryCode();
  acc.recoveryHash = hashRecoveryCode(code);
  saveLocalAccounts(accs);
  showRecoveryCodeDialog(code);
  toast('✅ 恢复码已生成（仅保存在本机）');
}
async function submitRecoverLocal(){
  const username = normalizeAccountInput($('#rcvUser').value);
  const code     = normalizeAccountInput($('#rcvCode').value);
  const pass     = normalizeAccountInput($('#rcvPass').value);
  const pass2    = normalizeAccountInput($('#rcvPass2').value);

  if(username.length < 2) return toast('请输入用户名');
  if(code.replace(/[^A-Za-z0-9]/g, '').length < 12) return toast('恢复码格式不正确');
  if(pass.length < 4) return toast('新密码至少 4 位');
  if(pass !== pass2) return toast('两次输入的新密码不一致');

  const accs = loadLocalAccounts();
  const acc = accs[localAccKey(username)];
  if(!acc || !acc.recoveryHash) return toast('找不到该账户，或从未生成过恢复码');
  if(acc.recoveryHash !== hashRecoveryCode(code)) return toast('恢复码不正确');

  acc.salt = randomSalt();
  acc.hash = await hashLocalPassword(pass, acc.salt);
  saveLocalAccounts(accs);

  toast('✅ 密码已重置，请用新密码登录');
  authMode = 'login';
  applyAuthMode();
  $('#authUser').value = username;
  $('#authPass').value = '';
  ['#rcvUser','#rcvCode','#rcvPass','#rcvPass2'].forEach(s => { const el = $(s); if(el) el.value = ''; });
}
async function submitAuthLocal(){
  const username = normalizeAccountInput($('#authUser').value);
  const pass     = normalizeAccountInput($('#authPass').value);
  const pass2    = normalizeAccountInput($('#authPass2').value);
  const isReg    = authMode === 'register';

  if(username.length < 2 || username.length > 20) return toast('用户名需 2-20 个字符');
  if(/[\/\\<>"'\s]/.test(username)) return toast('用户名不能包含特殊字符或空格');
  if(isReg){
    if(pass.length < 4) return toast('密码至少 4 位');
    if(pass !== pass2) return toast('两次输入的密码不一致');
  }

  const btn = $('#authSubmit');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = isReg ? '注册中…' : '登录中…';

  try{
    const r = isReg
      ? await localSignUp(username, pass, authAvatar)
      : await localSignIn(username, pass);
    if(!r.ok){ toast(r.msg || '操作失败'); return; }

    const acc = loadLocalAccounts()[localAccKey(username)];
    currentUser = makeLocalUser(acc);
    await loadUserData();
    closeAuth();
    updateUserBtn();
    if($('#view-profile')?.classList.contains('active')) renderProfile();

    if(isReg){
      toast('🎉 本地账户已创建：' + username);
      setTimeout(() => genLocalRecoveryCode(), 500);
    }else{
      toast('欢迎回来，' + username);
    }
  }catch(e){
    console.error('[澪鸢] 本地登录失败:', e);
    toast('操作失败：' + (e.message || '未知错误'));
  }finally{
    btn.disabled = false;
    btn.textContent = isReg ? '注册并登录' : '登录';
  }
}

function requireSupabase(){
  if(isLocalMode()) return true;
  if(!supabaseReady){
    toast('云端功能未加载，请检查网络后刷新页面');
    return false;
  }
  return true;
}

const LS_KEY           = 'yingchao_apis_v3';
const CUSTOM_PREFIX    = 'custom_';
const DEFAULT_API_PATH = 'api.php/provide/vod/';

const DEFAULT_APIS = [
  { id:'dyttzy', name:'电影天堂', url:'https://caiji.dyttzyapi.com/api.php/provide/vod/', enabled:true, detail:'' },
  { id:'ruyi',   name:'如意资源', url:'https://cj.rycjapi.com/api.php/provide/vod/',      enabled:true, detail:'' },
  { id:'bfzy',   name:'暴风资源', url:'https://bfzyapi.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'tyyszy', name:'天翼影视', url:'https://tyyszy.com/api.php/provide/vod/',          enabled:true, detail:'' },
  { id:'ffzy',   name:'非凡资源', url:'https://cj.ffzyapi.com/api.php/provide/vod/',      enabled:true, detail:'' },
  { id:'heimuer',name:'黑木耳',   url:'https://json.heimuer.xyz/api.php/provide/vod/',    enabled:true, detail:'' },
  { id:'zy360',  name:'360资源',  url:'https://360zy.com/api.php/provide/vod/',           enabled:true, detail:'' },
  { id:'wolong', name:'卧龙资源', url:'https://wolongzy.net/api.php/provide/vod/',        enabled:true, detail:'' },
  { id:'jisu',   name:'极速资源', url:'https://jszyapi.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'dbzy',   name:'豆瓣资源', url:'https://dbzyapi.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'mozhua', name:'魔爪资源', url:'https://mozhuazy.com/api.php/provide/vod/',        enabled:true, detail:'' },
  { id:'mdzy',   name:'魔都资源', url:'https://mdzyapi.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'zuid',   name:'最大资源', url:'https://zuidazy.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'yinghua',name:'樱花资源', url:'https://yhzyapi.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'baidu',  name:'百度资源', url:'https://baiduvipapi.com/api.php/provide/vod/',     enabled:true, detail:'' },
  { id:'wujin',  name:'无尽资源', url:'https://api.wujinapi.me/api.php/provide/vod/',     enabled:true, detail:'' },
  { id:'wwzy',   name:'旺旺资源', url:'https://wwzyapi.com/api.php/provide/vod/',         enabled:true, detail:'' },
  { id:'ikun',   name:'爱坤资源', url:'https://ikunzyapi.com/api.php/provide/vod/',       enabled:true, detail:'' },
  { id:'lzi',    name:'量子资源', url:'https://cj.lziapi.com/api.php/provide/vod/',       enabled:true, detail:'' },
  { id:'subo',   name:'速播资源', url:'https://subo.xyz/api.php/provide/vod/',            enabled:true, detail:'' },
  { id:'uku',    name:'U酷资源',  url:'https://api.ukuapi.com/api.php/provide/vod/',      enabled:true, detail:'' },
  { id:'animegarden', name:'Anime Garden', url:'https://api.animes.garden/resources', enabled:false, detail:'', type:'animegarden' }
];

let APIS = loadApis();

function loadApis(){
  try{
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if(Array.isArray(raw) && raw.length){
      let list = raw.map(a => ({
        id:      a.id || CUSTOM_PREFIX + Math.random().toString(36).slice(2, 9),
        name:    a.name || '未命名源',
        url:     a.url  || '',
        detail:  a.detail || '',
        enabled: a.enabled !== false,
        type:    a.type || ''
      })).filter(a => a.url);
      if(!list.some(a => a.id === 'animegarden')){
        const ag = DEFAULT_APIS.find(a => a.id === 'animegarden');
        if(ag) list.push({ ...ag });
        try{ localStorage.setItem(LS_KEY, JSON.stringify(list)); }catch(e){}
      }
      return list;
    }
  }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT_APIS));
}
function saveApis(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(APIS)); }catch(e){} }

function normalizeApiUrl(raw){
  if(!raw) return '';
  let u = String(raw).trim();
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.split('#')[0].split('?')[0];
  u = u.replace(/\/+$/, '');
  try{
    const parsed = new URL(u);
    if(!/api\.php|provide|vod/i.test(parsed.pathname)){
      u = u + '/' + DEFAULT_API_PATH;
    }else{
      u = u + '/';
    }
  }catch(e){
    u = u + '/' + DEFAULT_API_PATH;
  }
  return u;
}

const PROXIES = [
  { name:'直连',          build:u => u },
  { name:'corsproxy',     build:u => 'https://corsproxy.io/?' + encodeURIComponent(u) },
  { name:'allorigins',    build:u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { name:'worker',        build:u => 'https://my-proxy.2169215579.workers.dev/?url=' + encodeURIComponent(u) }
];

async function rawFetch(url, perTimeout = 3000, totalTimeout = 15000, signal, validator){
  const deadline = Date.now() + totalTimeout;
  let lastErr = null;
  for(const proxy of PROXIES){
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const remain = deadline - Date.now();
    if(remain <= 250) break;
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(perTimeout, remain));

    const onAbort = () => { try{ ctrl.abort(); }catch(e){} clearTimeout(timer); };
    if (signal) signal.addEventListener('abort', onAbort);

    try{
      const res = await fetch(proxy.build(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if(!res.ok) throw new Error('HTTP ' + res.status);

      const text = await res.text();
      if(validator && !validator(text)){
        lastErr = new Error('响应不是有效 JSON（可能被反爬/劫持，' + proxy.name + '）');
        continue;
      }
      return text;
    }catch(e){
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('全部代理失败');
}
function parseApiResponse(text){
  if(!text) return {};
  let s = String(text).trim().replace(/^\uFEFF/, '');
  const m = s.match(/^[a-zA-Z_$][\w$]*\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);
  if(m) s = m[1];
  try{ return JSON.parse(s); }
  catch(e){
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if(a >= 0 && b > a){
      try{ return JSON.parse(s.slice(a, b + 1)); }catch(e2){}
    }
    throw e;
  }
}

const WEB_LS_KEY = 'yingchao_web_sources_v1';
const DEFAULT_WEB_SOURCES = [
  { id:'w_baidu',    name:'百度',     icon:'🔍', url:'https://www.baidu.com/s?wd={kw}',                                enabled:true  },
  { id:'w_bing',     name:'必应',     icon:'🌐', url:'https://www.bing.com/search?q={kw}+在线观看',                    enabled:true  },
  { id:'w_iqiyi',    name:'爱奇艺',   icon:'🟩', url:'https://so.iqiyi.com/so/q_{kw}',                                 enabled:false },
  { id:'w_qq',       name:'腾讯视频', icon:'🟦', url:'https://v.qq.com/x/search/?q={kw}',                              enabled:false },
  { id:'w_youku',    name:'优酷',     icon:'🟧', url:'https://so.youku.com/search_video/q_{kw}',                       enabled:false },
  { id:'w_mgtv',     name:'芒果TV',   icon:'🟨', url:'https://so.mgtv.com/so?k={kw}',                                  enabled:false },
  { id:'w_bilibili', name:'哔哩哔哩', icon:'📺', url:'https://search.bilibili.com/all?keyword={kw}',                   enabled:false },
  { id:'w_douban',   name:'豆瓣',     icon:'🎬', url:'https://search.douban.com/movie/subject_search?search_text={kw}', enabled:false },
  { id:'w_olevod',   name:'欧乐影院', icon:'🎥', url:'https://www.olevod.com/index.php/vod/search.html?wd={kw}',       enabled:false },
  { id:'w_libvio',   name:'Libvio',   icon:'🎞️', url:'https://www.libvio.pro/search/-------------.html?wd={kw}',       enabled:false }
];
let WEB_SOURCES = loadWebSources();
function loadWebSources(){
  try{
    const raw = JSON.parse(localStorage.getItem(WEB_LS_KEY) || 'null');
    if(Array.isArray(raw) && raw.length) return raw;
  }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT_WEB_SOURCES));
}
function saveWebSources(){ try{ localStorage.setItem(WEB_LS_KEY, JSON.stringify(WEB_SOURCES)); }catch(e){} }

const SETTINGS_KEY = 'yingchao_settings_v1';
const DEFAULT_SETTINGS = {
  dataMode    : 'cms',
  bg          : { type:'preset', value:'default', dim:0.45, source:'' },
  autoStart   : false,
  closeAction : 'tray',
  skipIntro   : false,
  introSec    : 0,
  skipOutro   : false,
  outroSec    : 0,
  autoNext    : true,
  memoryPlay  : true
};
let SETTINGS = loadSettings();
function loadSettings(){
  let s = {};
  try{ s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }catch(e){}
  const out = Object.assign({}, DEFAULT_SETTINGS, s);
  out.bg = Object.assign({}, DEFAULT_SETTINGS.bg, s.bg || {});
  if(!out.bg.source){
    if(out.bg.type === 'image'){
      out.bg.source = (typeof out.bg.value === 'string' && /^data:image\//i.test(out.bg.value))
        ? 'data' : 'url';
    }else{
      out.bg.source = '';
    }
  }
  if(out.dataMode !== 'web') out.dataMode = 'cms';
  return out;
}
function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); return true; }
  catch(e){
    console.warn('[澪鸢] 设置保存失败:', e);
    toast('设置保存失败：本地存储空间不足');
    return false;
  }
}
const BG_PRESETS = [
  { id:'default', name:'澪鸢绿', color:'#0a0c10', css:'radial-gradient(1200px 500px at 50% -180px,rgba(0,210,106,.10),transparent 65%)' },
  { id:'ocean',   name:'深海蓝', color:'#070b14', css:'radial-gradient(1200px 520px at 50% -180px,rgba(0,176,255,.18),transparent 65%)' },
  { id:'violet',  name:'紫夜',   color:'#0b0813', css:'radial-gradient(1200px 520px at 50% -180px,rgba(155,89,255,.18),transparent 65%)' },
  { id:'sunset',  name:'暖阳',   color:'#120c07', css:'radial-gradient(1200px 520px at 50% -180px,rgba(255,138,0,.16),transparent 65%)' },
  { id:'rose',    name:'玫瑰',   color:'#130910', css:'radial-gradient(1200px 520px at 50% -180px,rgba(255,64,129,.16),transparent 65%)' },
  { id:'pure',    name:'纯黑',   color:'#000000', css:'none' }
];

const BG_DB_NAME = 'lingyuan_bg_v1';
const BG_STORE   = 'images';
const BG_KEY     = 'customBg';
let _bgObjectUrl = '';

function idbOpenBg(){
  return new Promise((resolve, reject) => {
    if(!window.indexedDB) return reject(new Error('当前环境不支持 IndexedDB'));
    let req;
    try{ req = indexedDB.open(BG_DB_NAME, 1); }
    catch(e){ return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(BG_STORE)) db.createObjectStore(BG_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
}
async function idbPutBg(blob){
  const db = await idbOpenBg();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_STORE, 'readwrite');
    tx.objectStore(BG_STORE).put(blob, BG_KEY);
    tx.oncomplete = () => { try{ db.close(); }catch(e){} resolve(true); };
    tx.onerror    = () => { try{ db.close(); }catch(e){} reject(tx.error || new Error('写入失败')); };
    tx.onabort    = () => { try{ db.close(); }catch(e){} reject(tx.error || new Error('写入被中断')); };
  });
}
async function idbGetBg(){
  const db = await idbOpenBg();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_STORE, 'readonly');
    const rq = tx.objectStore(BG_STORE).get(BG_KEY);
    rq.onsuccess = () => { try{ db.close(); }catch(e){} resolve(rq.result || null); };
    rq.onerror   = () => { try{ db.close(); }catch(e){} reject(rq.error || new Error('读取失败')); };
  });
}
async function idbDelBg(){
  try{
    const db = await idbOpenBg();
    await new Promise((resolve) => {
      const tx = db.transaction(BG_STORE, 'readwrite');
      tx.objectStore(BG_STORE).delete(BG_KEY);
      tx.oncomplete = () => { try{ db.close(); }catch(e){} resolve(); };
      tx.onerror = tx.onabort = () => { try{ db.close(); }catch(e){} resolve(); };
    });
  }catch(e){}
}
function dataUrlToBlob(dataUrl){
  try{
    const arr  = String(dataUrl).split(',');
    const mime = (arr[0].match(/:(.*?);/) || [,'image/jpeg'])[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while(n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }catch(e){ return null; }
}
function compressBgImage(file, maxSide, quality){
  maxSide = maxSide || 1920;
  quality = quality || 0.82;
  return new Promise(resolve => {
    let done = false;
    const finish = (b) => { if(done) return; done = true; resolve(b || null); };

    const draw = (src, sw, sh) => {
      try{
        if(!sw || !sh) return finish(null);
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if(!ctx) return finish(null);
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
        if(canvas.toBlob){
          canvas.toBlob(blob => {
            canvas.width = canvas.height = 0;
            finish(blob);
          }, 'image/jpeg', quality);
        }else{
          finish(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
        }
      }catch(e){
        console.warn('[澪鸢] 背景压缩失败:', e);
        finish(null);
      }
    };

    if(typeof createImageBitmap === 'function'){
      try{
        createImageBitmap(file).then(bmp => {
          draw(bmp, bmp.width, bmp.height);
          if(bmp.close) try{ bmp.close(); }catch(e){}
        }).catch(() => viaObjectUrl());
        return;
      }catch(e){}
    }
    viaObjectUrl();

    function viaObjectUrl(){
      let url = '';
      try{ url = URL.createObjectURL(file); }catch(e){ return viaReader(); }
      const img = new Image();
      img.onload = () => {
        draw(img, img.naturalWidth, img.naturalHeight);
        try{ URL.revokeObjectURL(url); }catch(e){}
      };
      img.onerror = () => {
        try{ URL.revokeObjectURL(url); }catch(e){}
        viaReader();
      };
      img.src = url;
    }
    function viaReader(){
      try{
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
          img.onerror = () => finish(null);
          img.src = fr.result;
        };
        fr.onerror = () => finish(null);
        fr.readAsDataURL(file);
      }catch(e){ finish(null); }
    }
  });
}
async function initCustomBg(){
  const b = SETTINGS.bg || {};
  if(b.type !== 'image') return;

  if(typeof b.value === 'string' && /^data:image\//i.test(b.value)){
    try{
      const blob = dataUrlToBlob(b.value);
      if(blob && blob.size > 0){
        await idbPutBg(blob);
        if(_bgObjectUrl){ try{ URL.revokeObjectURL(_bgObjectUrl); }catch(e){} }
        _bgObjectUrl = URL.createObjectURL(blob);
        SETTINGS.bg.type   = 'image';
        SETTINGS.bg.source = 'idb';
        SETTINGS.bg.value  = BG_KEY;
      }else{
        SETTINGS.bg.type   = 'preset';
        SETTINGS.bg.value  = 'default';
        SETTINGS.bg.source = '';
      }
    }catch(e){
      console.warn('[澪鸢] 背景迁移失败:', e);
      SETTINGS.bg.type   = 'preset';
      SETTINGS.bg.value  = 'default';
      SETTINGS.bg.source = '';
    }
    saveSettings();
    applyBackground();
    renderBgPresets();
    syncSettingsUI();
    return;
  }

  if(b.source === 'idb'){
    try{
      const blob = await idbGetBg();
      if(blob && blob.size){
        if(_bgObjectUrl){ try{ URL.revokeObjectURL(_bgObjectUrl); }catch(e){} }
        _bgObjectUrl = URL.createObjectURL(blob);
      }else{
        SETTINGS.bg.type   = 'preset';
        SETTINGS.bg.value  = 'default';
        SETTINGS.bg.source = '';
        saveSettings();
      }
    }catch(e){
      console.warn('[澪鸢] 读取本地背景失败:', e);
    }
    applyBackground();
    renderBgPresets();
    syncSettingsUI();
  }
}

const RECOVER_SQL = `-- ================================================
--  澪鸢 · 找回密码功能配置脚本
--  在 Supabase 控制台 → SQL Editor 中执行一次
-- ================================================

create extension if not exists pgcrypto;

create table if not exists public.password_recovery (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  username      text,
  recovery_hash text not null,
  created_at    timestamptz default now()
);
alter table public.password_recovery enable row level security;
revoke all on public.password_recovery from anon, authenticated;

create or replace function public.save_recovery_code(p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception '未登录'; end if;
  if p_code_hash is null or length(p_code_hash) < 4 then
    raise exception '恢复码无效';
  end if;

  select coalesce(raw_user_meta_data->>'nickname', split_part(email, '@', 1))
    into v_name
    from auth.users
   where id = v_uid;

  insert into public.password_recovery(user_id, username, recovery_hash, created_at)
  values (v_uid, v_name, p_code_hash, now())
  on conflict (user_id) do update
     set username      = excluded.username,
         recovery_hash = excluded.recovery_hash,
         created_at    = now();
  return true;
end;
$$;

create or replace function public.reset_password_with_code(
  p_username     text,
  p_code_hash    text,
  p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare v_uid uuid;
begin
  if p_new_password is null or length(p_new_password) < 4 then
    raise exception '新密码至少 4 位';
  end if;

  select pr.user_id into v_uid
    from public.password_recovery pr
   where lower(trim(pr.username)) = lower(trim(p_username))
     and pr.recovery_hash = p_code_hash
   limit 1;

  if v_uid is null then return false; end if;

  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf')),
         updated_at         = now()
   where id = v_uid;

  return true;
end;
$$;

grant execute on function public.save_recovery_code(text) to authenticated;
grant execute on function public.reset_password_with_code(text, text, text) to anon, authenticated;
`;

let currentUser = null;
let userBucket = { favorites: [], history: [], searches: [], avatar: '' };

const AVATARS = ['🙂','😎','🐱','🐼','🦊','🐧','🍀','⭐','🎬','🎮','🚀','🌸'];
let authMode = 'login';
let authAvatar = AVATARS[0];
let avatarPickTemp = AVATARS[0];
let uploadedAvatar = '';
let currentRecoveryCode = '';

function userId(){ return currentUser ? currentUser.id : '__guest__'; }
function userName(){
  if(!currentUser) return '';
  return currentUser.user_metadata?.nickname
      || (currentUser.email || '').split('@')[0]
      || '用户';
}
function userAvatar(){
  if(userBucket && userBucket.avatar) return userBucket.avatar;
  const metaAv = (currentUser && currentUser.user_metadata && currentUser.user_metadata.avatar) || '';
  if(metaAv) return metaAv;
  return '🙂';
}

const _avatarBlobCache = new Map();
function base64ToBlobUrl(dataUrl){
  if(!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  if(_avatarBlobCache.has(dataUrl)) return _avatarBlobCache.get(dataUrl);
  try{
    const arr  = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    const blob = new Blob([u8arr], { type: mime });
    const url  = URL.createObjectURL(blob);
    if(_avatarBlobCache.size > 20){
      const firstKey = _avatarBlobCache.keys().next().value;
      try{ URL.revokeObjectURL(_avatarBlobCache.get(firstKey)); }catch(e){}
      _avatarBlobCache.delete(firstKey);
    }
    _avatarBlobCache.set(dataUrl, url);
    return url;
  }catch(e){
    console.warn('base64 转 blob 失败:', e);
    return dataUrl;
  }
}

function avatarInner(av){
  if(!av) return '🙂';
  const s = String(av);
  if(s.startsWith('data:')){
    return `<img src="${esc(base64ToBlobUrl(s))}" alt="">`;
  }
  if(/^https?:\/\//i.test(s)){
    return `<img src="${esc(s)}" alt="">`;
  }
  return esc(s);
}

function mutateBucket(fn){
  try{ fn(userBucket); }catch(e){ console.warn(e); }
  saveUserData();
}

async function saveUserData(){
  if(!currentUser) return;

  if(isLocalMode() || currentUser.__local){
    saveLocalData(userName(), {
      favorites: userBucket.favorites,
      history:   userBucket.history,
      searches:  userBucket.searches,
      avatar:    userBucket.avatar || ''
    });
    return;
  }

  if(!supabaseReady) return;
  const payload = {
    favorites: userBucket.favorites,
    history:   userBucket.history,
    searches:  userBucket.searches,
    avatar:    userBucket.avatar || '',
    updated_at: new Date().toISOString()
  };
  try{
    const { data, error } = await sb.from('user_data')
      .update(payload).eq('user_id', currentUser.id).select('user_id');
    if(error){ console.warn('云端同步失败:', error); return; }
    if(!data || !data.length){
      const { error: insErr } = await sb.from('user_data')
        .insert(Object.assign({ user_id: currentUser.id }, payload));
      if(insErr) console.warn('云端初始化失败:', insErr);
    }
  }catch(e){ console.warn('云端同步异常:', e); }
}

async function loadUserData(){
  if(!currentUser) return;
  const metaAv = (currentUser.user_metadata && currentUser.user_metadata.avatar) || '';

  if(isLocalMode() || currentUser.__local){
    const d = loadLocalData(userName());
    userBucket = {
      favorites: d.favorites,
      history:   d.history,
      searches:  normalizeSearches(d.searches),
      avatar:    d.avatar || metaAv
    };
    return;
  }

  if(!supabaseReady){
    userBucket = { favorites: [], history: [], searches: [], avatar: metaAv };
    return;
  }
  try{
    const { data, error } = await sb.from('user_data')
      .select('*').eq('user_id', currentUser.id).maybeSingle();

    if(error){
      console.warn('读取用户数据失败:', error);
      userBucket = { favorites: [], history: [], searches: [], avatar: metaAv };
      return;
    }
    if(data){
      userBucket = {
        favorites: Array.isArray(data.favorites) ? data.favorites : [],
        history:   Array.isArray(data.history)   ? data.history   : [],
        searches:  normalizeSearches(data.searches),
        avatar:    (typeof data.avatar === 'string' && data.avatar) ? data.avatar : metaAv
      };
      if(!data.avatar && metaAv){
        try{
          await sb.from('user_data')
            .update({ avatar: metaAv, updated_at: new Date().toISOString() })
            .eq('user_id', currentUser.id);
        }catch(e){}
      }
    }else{
      const { error: insErr } = await sb.from('user_data').insert({
        user_id: currentUser.id,
        favorites: [], history: [], searches: [], avatar: metaAv
      });
      if(insErr) console.warn('初始化用户数据失败:', insErr);
      userBucket = { favorites: [], history: [], searches: [], avatar: metaAv };
    }
  }catch(e){
    console.warn('loadUserData 异常:', e);
    userBucket = { favorites: [], history: [], searches: [], avatar: metaAv };
  }
}

async function restoreSession(){
  const localName = getLocalSessionName();
  if(localName){
    const acc = loadLocalAccounts()[localName];
    if(acc){
      currentUser = makeLocalUser(acc);
      await loadUserData();
      updateUserBtn();
      return;
    }
    setLocalSessionName('');
  }

  if(isLocalMode()){
    currentUser = null;
    userBucket = { favorites: [], history: [], searches: [], avatar: '' };
    updateUserBtn();
    return;
  }
  if(!supabaseReady){
    console.warn('[澪鸢] Supabase 客户端未就绪，稍后自动重试恢复会话');
    updateUserBtn();
    return;
  }
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(session && session.user){
      currentUser = session.user;
      try{
        const { data: u } = await sb.auth.getUser();
        if(u && u.user) currentUser = u.user;
      }catch(e){}
      await loadUserData();
    }else{
      currentUser = null;
      userBucket = { favorites: [], history: [], searches: [], avatar: '' };
    }
  }catch(e){
    console.warn('恢复会话失败:', e);
    currentUser = null;
    userBucket = { favorites: [], history: [], searches: [], avatar: '' };
  }
  updateUserBtn();
}

function updateUserBtn(){
  const btn = document.getElementById('userBtn');
  if(!btn) return;
  btn.innerHTML = currentUser ? avatarInner(userAvatar()) : '👤';
  btn.title = currentUser ? userName() : '个人中心';
}

function normalizeSearchEntry(x){
  if(typeof x === 'string') return { kw: x, at: 0 };
  if(x && typeof x === 'object' && x.kw) return { kw: String(x.kw), at: Number(x.at) || 0 };
  return null;
}
function normalizeSearches(arr){
  if(!Array.isArray(arr)) return [];
  const seen = new Set(), out = [];
  arr.forEach(x => {
    const e = normalizeSearchEntry(x);
    if(!e || !e.kw || seen.has(e.kw)) return;
    seen.add(e.kw);
    out.push(e);
  });
  return out.slice(0, 200);
}
function getSearches(){ return normalizeSearches(userBucket.searches); }
function addSearch(kw){
  kw = String(kw || '').trim();
  if(!kw) return;
  mutateBucket(b => {
    const list = normalizeSearches(b.searches).filter(x => x.kw !== kw);
    list.unshift({ kw, at: Date.now() });
    if(list.length > 200) list.length = 200;
    b.searches = list;
  });
}
function removeSearchAt(i){
  mutateBucket(b => {
    const list = normalizeSearches(b.searches);
    list.splice(i, 1);
    b.searches = list;
  });
  renderSearchDrop();
  if($('#view-profile')?.classList.contains('active')) renderProfile();
}
function clearSearches(){
  mutateBucket(b => { b.searches = []; });
  hideSearchDrop();
  if($('#view-profile')?.classList.contains('active')) renderProfile();
  toast('已清空搜索记录');
}

function movieKey(m){
  return String(((m && m.vod_name) || '') + '|' + ((m && m.vod_year) || '')).toLowerCase();
}
function getFavorites(){ return userBucket.favorites; }
function isFavorite(key){ return getFavorites().some(f => f.key === key); }
function favEntryFrom(m){
  return {
    key:        movieKey(m),
    name:       m.vod_name || '未知影片',
    pic:        m.vod_pic || '',
    year:       m.vod_year || '',
    type:       (m.type_name || m.vod_class || '').split(',')[0] || '',
    score:      m.vod_score || '',
    remarks:    m.vod_remarks || '',
    content:    String(m.vod_content || m.vod_blurb || '').replace(/<[^>]+>/g,'').slice(0, 400),
    sourceId:   m._sourceId || '',
    sourceName: m._source || '',
    playFrom:   m.vod_play_from || '',
    playUrl:    m.vod_play_url || '',
    magnet:     m._magnet || '',
    addedAt:    Date.now()
  };
}
function addFavorite(m){
  const e = favEntryFrom(m);
  if(!e.key || !e.name) return;
  mutateBucket(b => {
    b.favorites = b.favorites.filter(f => f.key !== e.key);
    b.favorites.unshift(e);
    if(b.favorites.length > 300) b.favorites.length = 300;
  });
}
function removeFavorite(key){
  mutateBucket(b => { b.favorites = b.favorites.filter(f => f.key !== key); });
}
function toggleCurrentFavorite(){
  const m = state.current;
  if(!m) return;
  const key = movieKey(m);
  if(isFavorite(key)){
    removeFavorite(key);
    toast('已取消收藏');
  }else{
    addFavorite(m);
    toast('⭐ 已加入收藏');
  }
  updateFavBtn();
}
function updateFavBtn(){
  const btn = document.getElementById('favBtn');
  if(!btn) return;
  if(!state.current || state.current._offline){ btn.style.display = 'none'; return; }
  btn.style.display = 'inline-flex';
  const on = isFavorite(movieKey(state.current));
  btn.innerHTML = on ? '★ 已收藏' : '☆ 收藏';
  btn.classList.toggle('faved', on);
}

function getHistory(){ return userBucket.history; }
function recordHistory(){
  const m = state.current;
  if(!m) return;
  const line = state.lines[state.lineIdx];
  const ep = line && line.episodes[state.epIdx];
  if(!ep) return;
  const key = movieKey(m);
  const entry = {
    key, name: m.vod_name || '未知影片', pic: m.vod_pic || '',
    year: m.vod_year || '', type: (m.type_name || '').split(',')[0] || '',
    score: m.vod_score || '', remarks: m.vod_remarks || '',
    content: String(m.vod_content || '').replace(/<[^>]+>/g,'').slice(0, 400),
    sourceId: m._sourceId || '', sourceName: m._source || '',
    playFrom: m.vod_play_from || '', playUrl: m.vod_play_url || '',
    magnet: m._magnet || '',
    lineIdx: state.lineIdx, epIdx: state.epIdx,
    epName: ep.name || '', url: ep.url || '', updatedAt: Date.now()
  };
  mutateBucket(b => {
    b.history = b.history.filter(h => h.key !== key);
    b.history.unshift(entry);
    if(b.history.length > 300) b.history.length = 300;
  });
}
function removeHistoryAt(i){
  mutateBucket(b => { b.history.splice(i, 1); });
  renderProfileBody();
  toast('已移除该记录');
}
function clearHistory(){
  if(!confirm('确定清空全部观看历史吗？')) return;
  mutateBucket(b => { b.history = []; });
  renderProfile();
  toast('已清空观看历史');
}
function entryToMovie(e){
  const movie = {
    vod_name:      e.name, vod_pic: e.pic, vod_year: e.year,
    type_name:     e.type, vod_score: e.score, vod_remarks: e.remarks,
    vod_content:   e.content, vod_play_from: e.playFrom, vod_play_url: e.playUrl,
    _source:       e.sourceName, _sourceId: e.sourceId,
    _allSources:   e.sourceName ? [e.sourceName] : []
  };
  if(e.magnet) movie._magnet = e.magnet;
  return movie;
}

function genRecoveryCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => {
    let s = '';
    for(let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
  return 'LY-' + seg() + '-' + seg() + '-' + seg();
}
function hashRecoveryCode(code){
  const clean = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return 'rc_' + cyrb53('lingyuan::' + clean);
}
function isRpcMissing(msg){
  return /function|does not exist|schema cache|Could not find/i.test(String(msg || ''));
}

async function saveRecoveryCodeToCloud(code){
  if(!currentUser) return { ok:false, msg:'未登录' };
  if(!supabaseReady) return { ok:false, msg:'云端未连接' };
  try{
    const { error } = await sb.rpc('save_recovery_code', { p_code_hash: hashRecoveryCode(code) });
    if(error){
      if(isRpcMissing(error.message)) return { ok:false, msg:'云端未开启找回功能', needSql:true };
      return { ok:false, msg: error.message || '保存失败' };
    }
    return { ok:true };
  }catch(e){
    return { ok:false, msg: e.message || '网络错误' };
  }
}

function showRecoveryCodeDialog(code){
  currentRecoveryCode = code || '';
  const el = document.getElementById('rcvCodeText');
  if(el) el.textContent = currentRecoveryCode || '—';
  document.getElementById('rcvCodeMask')?.classList.add('open');
  document.getElementById('rcvCodeDialog')?.classList.add('open');
}
function closeRecoveryCodeDialog(e){
  if(e && e.target && !e.target.classList.contains('clear-mask')) return;
  document.getElementById('rcvCodeMask')?.classList.remove('open');
  document.getElementById('rcvCodeDialog')?.classList.remove('open');
}
function copyRecoveryCode(){
  if(!currentRecoveryCode) return;
  navigator.clipboard.writeText(currentRecoveryCode)
    .then(() => toast('✅ 恢复码已复制'))
    .catch(() => prompt('手动复制恢复码：', currentRecoveryCode));
}

async function generateRecoveryCode(){
  if(!currentUser) return toast('请先登录');
  if(isLocalMode() || currentUser.__local){ return genLocalRecoveryCode(); }
  if(!requireSupabase()) return;
  if(!confirm('生成新的恢复码？\n\n旧的恢复码会立即失效，请务必保存新的。')) return;
  const code = genRecoveryCode();
  const r = await saveRecoveryCodeToCloud(code);
  if(!r.ok){
    if(r.needSql){ toast('云端未开启找回功能'); showRecoverSqlDialog(); }
    else toast('生成失败：' + r.msg);
    return;
  }
  showRecoveryCodeDialog(code);
  toast('✅ 恢复码已生成，请妥善保存');
}

function showRecoverSqlDialog(){
  const box = document.getElementById('sqlBox');
  if(box) box.textContent = RECOVER_SQL;
  document.getElementById('sqlMask')?.classList.add('open');
  document.getElementById('sqlDialog')?.classList.add('open');
}
function closeSqlDialog(e){
  if(e && e.target && !e.target.classList.contains('clear-mask')) return;
  document.getElementById('sqlMask')?.classList.remove('open');
  document.getElementById('sqlDialog')?.classList.remove('open');
}
function copyRecoverSql(){
  navigator.clipboard.writeText(RECOVER_SQL)
    .then(() => toast('✅ SQL 脚本已复制'))
    .catch(() => prompt('手动复制 SQL：', RECOVER_SQL));
}

function openRecover(){
  authMode = 'recover';
  applyAuthMode();
  setTimeout(() => { const el = $('#rcvUser'); if(el) el.focus(); }, 120);
}
function closeRecover(){
  authMode = 'login';
  applyAuthMode();
}

async function submitRecover(){
  if(isLocalMode()) return submitRecoverLocal();
  if(!requireSupabase()) return;
  const username = normalizeAccountInput($('#rcvUser').value);
  const code     = normalizeAccountInput($('#rcvCode').value);
  const pass     = normalizeAccountInput($('#rcvPass').value);
  const pass2    = normalizeAccountInput($('#rcvPass2').value);

  if(username.length < 2) return toast('请输入用户名');
  if(code.replace(/[^A-Za-z0-9]/g, '').length < 12) return toast('恢复码格式不正确');
  if(pass.length < 4) return toast('新密码至少 4 位');
  if(pass !== pass2) return toast('两次输入的新密码不一致');

  const btn = $('#rcvSubmit');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '重置中…';

  try{
    const { data, error } = await sb.rpc('reset_password_with_code', {
      p_username:     username,
      p_code_hash:    hashRecoveryCode(code),
      p_new_password: pass
    });
    if(error){
      if(isRpcMissing(error.message)){
        toast('云端未开启找回功能，请先执行配置脚本');
        showRecoverSqlDialog();
      }else{
        toast(error.message || '重置失败');
      }
      return;
    }
    if(data === true){
      toast('✅ 密码已重置，请用新密码登录');
      $('#rcvUser').value = '';
      $('#rcvCode').value = '';
      $('#rcvPass').value = '';
      $('#rcvPass2').value = '';
      authMode = 'login';
      applyAuthMode();
      $('#authUser').value = username;
      $('#authPass').value = '';
      setTimeout(() => $('#authPass').focus(), 150);
    }else{
      toast('用户名或恢复码不正确');
    }
  }catch(e){
    console.error('[澪鸢] 重置密码失败:', e);
    toast('重置失败：' + (e.message || '网络错误'));
  }finally{
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function submitAuth(){
  if(isLocalMode()) return submitAuthLocal();
  if(!requireSupabase()) return;

  const username = normalizeAccountInput($('#authUser').value);
  const pass     = normalizeAccountInput($('#authPass').value);
  const pass2    = normalizeAccountInput($('#authPass2').value);

  if(username.length < 2 || username.length > 20) return toast('用户名需 2-20 个字符');
  if(/[\/\\<>"'\s]/.test(username)) return toast('用户名不能包含特殊字符或空格');

  const email = usernameToEmail(username);
  const btn = $('#authSubmit');
  const isReg = authMode === 'register';
  btn.disabled = true;
  btn.textContent = isReg ? '注册中…' : '登录中…';

  try{
    if(isReg){
      if(pass.length < 4) return toast('密码至少 4 位');
      if(pass !== pass2) return toast('两次输入的密码不一致');

      const { data, error } = await sb.auth.signUp({
        email, password: pass,
        options: { data: { nickname: username, avatar: authAvatar } }
      });
      if(error) return toast(error.message || '注册失败');
      if(!data.user) return toast('注册成功，但需要邮箱确认；请联系管理员关闭邮箱验证');

      currentUser = data.user;
      const { data: sData, error: sErr } = await sb.auth.signInWithPassword({ email, password: pass });
      if(!sErr && sData?.user) currentUser = sData.user;

      await loadUserData();
      if(authAvatar && (!userBucket.avatar)) await saveAvatarToCloud(authAvatar);

      closeAuth();
      updateUserBtn();
      if($('#view-profile').classList.contains('active')) renderProfile();
      toast('🎉 注册成功，欢迎 ' + username);

      try{
        const rcode = genRecoveryCode();
        const rr = await saveRecoveryCodeToCloud(rcode);
        if(rr.ok){
          setTimeout(() => showRecoveryCodeDialog(rcode), 400);
        }else if(rr.needSql){
          setTimeout(() => { toast('提示：云端未开启找回功能，可在个人中心查看配置'); }, 800);
        }
      }catch(e){ console.warn(e); }

    }else{
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if(error){
        if(/invalid/i.test(error.message || '')){
          return toast('用户名或密码错误（请确认没输成全角字符）');
        }
        return toast(error.message || '登录失败');
      }
      currentUser = data.user;
      try{
        const { data: u } = await sb.auth.getUser();
        if(u && u.user) currentUser = u.user;
      }catch(e){}
      await loadUserData();
      closeAuth();
      updateUserBtn();
      if($('#view-profile').classList.contains('active')) renderProfile();
      toast('欢迎回来，' + userName());
    }
    }catch(err){
    console.error('[澪鸢] 注册/登录失败:', err);
    const errMsg = (err.message || '').toLowerCase();
    if (errMsg.includes('fetch') || err.name === 'AbortError' || errMsg.includes('network')) {
      toast('❌ 网络连接失败：国内网络可能无法直连 Supabase。可以点下方「切换为本地账户」离线使用。');
    } else {
      toast('操作失败：' + (err.message || '未知错误'));
    }
  }finally{
    btn.disabled = false;
    btn.textContent = isReg ? '注册并登录' : '登录';
  }
}

async function doLogout(){
  if(!confirm('确定退出当前账户吗？')) return;
  if(isLocalMode() || (currentUser && currentUser.__local)){
    setLocalSessionName('');
  }else{
    try{ await sb.auth.signOut(); }catch(e){}
  }
  currentUser = null;
  userBucket = { favorites: [], history: [], searches: [], avatar: '' };
  updateUserBtn();
  renderProfile();
  toast('已退出登录');
}

function renderProfileAvatarPicker(){
  const box = document.getElementById('profileAvatarPicker');
  if(!box) return;
  let html = '';
  if(uploadedAvatar){
    html += `<span class="${avatarPickTemp === uploadedAvatar ? 'on' : ''}" onclick="pickProfileAvatar('__UPLOADED__')" title="已上传的图片"><img src="${esc(base64ToBlobUrl(uploadedAvatar))}" alt=""></span>`;
  }
  AVATARS.forEach(a => {
    html += `<span class="${a === avatarPickTemp ? 'on' : ''}" onclick="pickProfileAvatar('${a}')">${a}</span>`;
  });
  html += `<span class="av-upload" onclick="triggerAvatarUpload()" title="上传本地图片">＋</span>`;
  box.innerHTML = html;
}

function triggerAvatarUpload(){
  const inp = document.getElementById('avatarFileInput');
  if(inp) inp.click();
}

function onAvatarFileSelected(file){
  if(!file) return;
  const isImgType = /^image\//i.test(file.type || '');
  const isImgName = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || '');
  if(!isImgType && !isImgName){ toast('请选择图片文件'); return; }
  if(file.size > 20 * 1024 * 1024){ toast('图片不要超过 20MB，请压缩后重试'); return; }

  toast('正在处理图片…');

  compressImageToAvatar(file, async (dataUrl) => {
    if(!dataUrl){ toast('❌ 图片处理失败，请换一张试试'); return; }
    uploadedAvatar = dataUrl;

    if(document.getElementById('avatarDialog')?.classList.contains('open') && currentUser){
      avatarPickTemp = dataUrl;
      renderProfileAvatarPicker();
      await saveAvatarToCloud(dataUrl);
    }else if(document.getElementById('authDialog')?.classList.contains('open')){
      authAvatar = dataUrl;
      renderAvatarPicker();
      toast('图片已就绪，点击下方按钮完成注册');
    }else{
      toast('图片已就绪');
    }
  });
}

function compressImageToAvatar(file, callback){
  const SIZE = 128;
  let called = false;
  const finish = (dataUrl) => {
    if(called) return;
    called = true;
    try{ callback(dataUrl || ''); }catch(e){}
  };

  const renderFrom = (src) => {
    try{
      const w = src.width || src.naturalWidth || 0;
      const h = src.height || src.naturalHeight || 0;
      if(!w || !h || w < 2 || h < 2){ finish(''); return; }
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if(!ctx){ finish(''); return; }
      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(0, 0, SIZE, SIZE);
      const side = Math.min(w, h);
      const sx = (w - side) / 2;
      const sy = (h - side) / 2;
      ctx.drawImage(src, sx, sy, side, side, 0, 0, SIZE, SIZE);
      finish(canvas.toDataURL('image/jpeg', 0.78));
    }catch(e){
      console.warn('canvas 绘制失败:', e);
      finish('');
    }
  };

  if(typeof createImageBitmap === 'function'){
    try{
      createImageBitmap(file)
        .then(bmp => {
          renderFrom(bmp);
          if(bmp.close) try{ bmp.close(); }catch(e){}
        })
        .catch(() => tryBlobUrl());
      return;
    }catch(e){}
  }
  tryBlobUrl();

  function tryBlobUrl(){
    let url = '';
    try{ url = URL.createObjectURL(file); }catch(e){ return tryFileReader(); }
    const img = new Image();
    img.onload = () => {
      renderFrom(img);
      try{ URL.revokeObjectURL(url); }catch(e){}
    };
    img.onerror = () => {
      try{ URL.revokeObjectURL(url); }catch(e){}
      tryFileReader();
    };
    img.src = url;
  }

  function tryFileReader(){
    try{
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload  = () => renderFrom(img);
        img.onerror = () => finish('');
        img.src = reader.result;
      };
      reader.onerror = () => finish('');
      reader.readAsDataURL(file);
    }catch(e){ finish(''); }
  }
}

function openAvatarDialog(){
  if(!currentUser) return toast('请先登录');
  if(!isLocalMode() && !requireSupabase()) return;
  const cur = userAvatar();
  if(cur && (cur.startsWith('data:') || /^https?:\/\//i.test(cur))){
    uploadedAvatar = cur;
  }
  avatarPickTemp = cur || AVATARS[0];
  renderProfileAvatarPicker();
  document.getElementById('avatarMask').classList.add('open');
  document.getElementById('avatarDialog').classList.add('open');
}
function closeAvatarDialog(e){
  if(e && e.target && !e.target.classList.contains('clear-mask')) return;
  document.getElementById('avatarMask').classList.remove('open');
  document.getElementById('avatarDialog').classList.remove('open');
}
async function pickProfileAvatar(a){
  let target;
  if(a === '__UPLOADED__'){
    if(!uploadedAvatar){ toast('请先上传一张图片'); return; }
    target = uploadedAvatar;
  }else{
    target = a;
  }
  avatarPickTemp = target;
  renderProfileAvatarPicker();
  await saveAvatarToCloud(target);
}

async function saveAvatarToCloud(av){
  if(!currentUser) return;
  userBucket.avatar = av || '';
  updateUserBtn();
  renderProfile();

  if(isLocalMode() || currentUser.__local){
    const name = userName();
    saveLocalData(name, {
      favorites: userBucket.favorites,
      history:   userBucket.history,
      searches:  userBucket.searches,
      avatar:    userBucket.avatar
    });
    const accs = loadLocalAccounts();
    const k = localAccKey(name);
    if(accs[k]){ accs[k].avatar = userBucket.avatar; saveLocalAccounts(accs); }
    if(currentUser.user_metadata) currentUser.user_metadata.avatar = userBucket.avatar;
    updateUserBtn();
    renderProfile();
    toast('头像已更新（本地）');
    return;
  }

  if(!supabaseReady){ toast('云端未连接，头像仅在本次会话生效'); return; }

  let saved = false;

  try{
    const { data, error } = await sb.from('user_data')
      .update({ avatar: userBucket.avatar, updated_at: new Date().toISOString() })
      .eq('user_id', currentUser.id)
      .select('user_id');
    if(error){
      console.warn('user_data 保存头像失败:', error);
    }else if(data && data.length){
      saved = true;
    }else{
      const { error: insErr } = await sb.from('user_data')
        .insert({ user_id: currentUser.id, avatar: userBucket.avatar });
      if(insErr) console.warn('user_data 插入头像失败:', insErr);
      else saved = true;
    }
  }catch(e){ console.warn('user_data 保存头像异常:', e); }

  if(userBucket.avatar && userBucket.avatar.length < 20000){
    try{
      const { data: uData, error: uErr } = await sb.auth.updateUser({
        data: { avatar: userBucket.avatar }
      });
      if(uErr){
        console.warn('user_metadata 保存头像失败:', uErr);
      }else{
        saved = true;
        if(uData && uData.user) currentUser = uData.user;
      }
    }catch(e){ console.warn('user_metadata 保存头像异常:', e); }
  }

  updateUserBtn();
  renderProfile();
  toast(saved ? '头像已更新' : '头像仅在本地生效（云端保存失败）');
}

function openAuth(mode){
  authMode = mode === 'register' ? 'register' : 'login';
  authAvatar = AVATARS[0];
  $('#authUser').value = '';
  $('#authPass').value = '';
  $('#authPass2').value = '';
  const ru = $('#rcvUser'), rc = $('#rcvCode'), rp = $('#rcvPass'), rp2 = $('#rcvPass2');
  if(ru) ru.value = ''; if(rc) rc.value = ''; if(rp) rp.value = ''; if(rp2) rp2.value = '';
  renderAvatarPicker();
  applyAuthMode();
  $('#authMask').classList.add('open');
  $('#authDialog').classList.add('open');
  setTimeout(() => {
    const el = authMode === 'recover' ? $('#rcvUser') : $('#authUser');
    if(el) el.focus();
  }, 120);
}
function closeAuth(){
  $('#authMask').classList.remove('open');
  $('#authDialog').classList.remove('open');
}
function switchAuthMode(mode){ authMode = mode; applyAuthMode(); }
function applyAuthMode(){
  const isRecover = authMode === 'recover';
  const mainPane = document.getElementById('authMainPane');
  const rcvPane  = document.getElementById('authRecoverPane');
  if(mainPane) mainPane.style.display = isRecover ? 'none' : 'block';
  if(rcvPane)  rcvPane.style.display  = isRecover ? 'block' : 'none';

  if(isRecover){
    const t = $('#authTitle');
    if(t) t.textContent = '找回密码';
    return;
  }

  const isReg = authMode === 'register';
  $('#authTitle').textContent = isReg ? '注册新账户' : '登录账户';
  $('#authSubmit').textContent = isReg ? '注册并登录' : '登录';
  $('#authTabLogin').classList.toggle('active', !isReg);
  $('#authTabReg').classList.toggle('active', isReg);
  $('#authPass2').style.display = isReg ? '' : 'none';
  $('#authAvatarRow').style.display = isReg ? '' : 'none';
}
function renderAvatarPicker(){
  const box = document.getElementById('avatarPicker');
  if(!box) return;
  let html = '';
  if(uploadedAvatar){
    html += `<span class="${authAvatar === uploadedAvatar ? 'on' : ''}" onclick="pickAvatar('__UPLOADED__')" title="已上传的图片"><img src="${esc(base64ToBlobUrl(uploadedAvatar))}" alt=""></span>`;
  }
  AVATARS.forEach(a => {
    html += `<span class="${a === authAvatar ? 'on' : ''}" onclick="pickAvatar('${a}')">${a}</span>`;
  });
  html += `<span class="av-upload" onclick="triggerAvatarUpload()" title="上传本地图片">＋</span>`;
  box.innerHTML = html;
}

function pickAvatar(a){
  if(a === '__UPLOADED__'){
    if(!uploadedAvatar){ toast('请先上传一张图片'); return; }
    authAvatar = uploadedAvatar;
  }else{
    authAvatar = a;
  }
  renderAvatarPicker();
}

const state = {
  keyword  : '', results  : [], current  : null,
  lines    : [], lineIdx  : 0, epIdx    : 0,
  hlsLevels: null, hlsLevel : -1,
  currentUrl : '', outroTimer : null,
  outroRunning : false, outroCancelled : false,
  resumeAt : 0, resumeReason : '',
  _seekTimer : null, _lastSelfSeek : 0
};
let hlsInstance = null;
let lastProgressSave = 0;
let editingApiIdx = -1;
let editingWebIdx = -1;
let wvState = { url:'', name:'', icon:'' };
let wvToken = 0;
let pfTab = 'fav';
let clearSelectedIds = { api: new Set(), web: new Set() };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let toastEl;
function toast(msg){
  if(!toastEl){ toastEl = document.createElement('div'); toastEl.className='toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.classList.remove('show'), 2600);
}
function fmtTime(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  const pad = n => String(n).padStart(2,'0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtWhen(ts){
  if(!ts) return '';
  const d = new Date(ts), diff = Date.now() - ts;
  if(diff < 60000) return '刚刚';
  if(diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
  if(diff < 86400000) return Math.floor(diff/3600000) + ' 小时前';
  if(diff < 7*86400000) return Math.floor(diff/86400000) + ' 天前';
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function fmtFull(ts){
  if(!ts) return '';
  const d = new Date(ts), pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtSmartTime(ts){
  if(!ts) return '未知时间';
  const d = new Date(ts), now = new Date(), pad = n => String(n).padStart(2,'0');
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  if(sameDay(d, now)) return '今天 ' + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if(sameDay(d, y)) return '昨天 ' + hm;
  if(d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${hm}`;
}

function fmtHM(ts){
  if(!ts) return '';
  const d = new Date(ts), pad = n => String(n).padStart(2,'0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function dayKey(ts){
  const d = new Date(ts || 0), pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function dayLabel(ts){
  if(!ts) return '更早';
  const d = new Date(ts), now = new Date(), pad = n => String(n).padStart(2,'0');
  const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  if(sameDay(d, now)) return '今天';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if(sameDay(d, y)) return '昨天';
  if(d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}
function groupByDay(list, getTs){
  const groups = new Map();
  list.forEach((item, i) => {
    const ts = getTs(item) || 0;
    const k = ts ? dayKey(ts) : 'unknown';
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ item, i, ts });
  });
  return groups;
}
function dateSepHTML(ts, count){
  return `<div class="date-sep"><span>${esc(dayLabel(ts))}</span><em>${count}</em></div>`;
}

function currentBgUrl(){
  const b = SETTINGS.bg || {};
  if(b.type !== 'image') return '';
  if(b.source === 'idb')  return _bgObjectUrl || '';
  if(b.source === 'data') return '';
  return String(b.value || '');
}

function applyBackground(){
  const b = SETTINGS.bg || { type:'preset', value:'default', dim:0.45 };
  const body = document.body;
  body.style.backgroundAttachment = 'fixed';
  body.style.backgroundSize = 'cover';
  body.style.backgroundPosition = 'center center';
  body.style.backgroundRepeat = 'no-repeat';

  const imgUrl = currentBgUrl();
  if(b.type === 'image' && imgUrl){
    const dim = Math.max(0, Math.min(0.9, b.dim ?? 0.45));
    body.style.backgroundImage =
      `linear-gradient(rgba(5,7,10,${dim}),rgba(5,7,10,${dim})), url("${String(imgUrl).replace(/"/g,'\\"')}")`;
    body.style.backgroundColor = '#05070a';
    return;
  }
  const p = BG_PRESETS.find(x => x.id === b.value) || BG_PRESETS[0];
  body.style.backgroundImage = p.css;
  body.style.backgroundColor = p.color;
}
function switchPanelTab(tab){
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.panel-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  $('#panel').scrollTop = 0;
}
function applyDataMode(){
  const isWeb = SETTINGS.dataMode === 'web';
  const cmsPane = $('#pane-cms-sources');
  const webPane = $('#pane-web-sources');
  if(cmsPane) cmsPane.style.display = isWeb ? 'none' : 'block';
  if(webPane) webPane.style.display = isWeb ? 'block' : 'none';
  document.querySelectorAll('input[name=dataMode]').forEach(r => { r.checked = (r.value === SETTINGS.dataMode); });
}
function renderBgPresets(){
  const box = $('#bgPresets');
  if(!box) return;
  const cur = SETTINGS.bg.type === 'preset' ? SETTINGS.bg.value : '';
  box.innerHTML = BG_PRESETS.map(p => `
    <div class="bg-chip${cur === p.id ? ' on' : ''}" onclick="chooseBgPreset('${p.id}')">
      <span class="bg-chip-preview" style="background-color:${p.color};background-image:${p.css}"></span>
      <span>${p.name}</span>
    </div>`).join('');
}
function chooseBgPreset(id){
  SETTINGS.bg.type  = 'preset';
  SETTINGS.bg.value = id;
  SETTINGS.bg.source = '';
  saveSettings(); applyBackground(); renderBgPresets();
  const urlInput = $('#bgUrl'); if(urlInput) urlInput.value = '';
  toast('已应用背景：' + ((BG_PRESETS.find(p=>p.id===id)||{}).name || id));
}
function applyBgUrl(){
  const u = $('#bgUrl').value.trim();
  if(!u) return toast('请输入图片链接');
  if(!/^https?:\/\//i.test(u) && !u.startsWith('data:image')) return toast('请输入有效的图片链接');
  SETTINGS.bg.type   = 'image';
  SETTINGS.bg.source = 'url';
  SETTINGS.bg.value  = u;
  if(saveSettings()) { applyBackground(); renderBgPresets(); toast('背景已更新'); }
}
function resetBg(){
  SETTINGS.bg.type   = 'preset';
  SETTINGS.bg.value  = 'default';
  SETTINGS.bg.source = '';
  SETTINGS.bg.dim    = 0.45;
  saveSettings();
  idbDelBg();
  if(_bgObjectUrl){ try{ URL.revokeObjectURL(_bgObjectUrl); }catch(e){} _bgObjectUrl = ''; }
  applyBackground(); syncSettingsUI();
  toast('已恢复默认背景');
}
function applyAutoStart(){
  if(window.electronAPI && typeof window.electronAPI.setAutoLaunch === 'function'){
    try{ window.electronAPI.setAutoLaunch(!!SETTINGS.autoStart); }catch(e){}
  }
}
function applyCloseAction(){
  if(window.electronAPI && typeof window.electronAPI.setCloseAction === 'function'){
    try{ window.electronAPI.setCloseAction(SETTINGS.closeAction); }catch(e){}
  }
}
function syncSettingsUI(){
  const g = id => document.getElementById(id);
  if(!g('setAutoStart')) return;
  g('setAutoStart').checked = !!SETTINGS.autoStart;
  document.querySelectorAll('input[name=closeAction]').forEach(r => r.checked = (r.value === SETTINGS.closeAction));
  document.querySelectorAll('input[name=dataMode]').forEach(r => r.checked = (r.value === SETTINGS.dataMode));
  g('setSkipIntro').checked = !!SETTINGS.skipIntro;
  g('setIntroSec').value    = SETTINGS.introSec | 0;
  g('setSkipOutro').checked = !!SETTINGS.skipOutro;
  g('setOutroSec').value    = SETTINGS.outroSec | 0;
  g('setAutoNext').checked  = !!SETTINGS.autoNext;
  g('setMemory').checked    = !!SETTINGS.memoryPlay;
  const dim = Math.round((SETTINGS.bg.dim ?? 0.45) * 100);
  g('bgDim').value = dim;
  g('bgDimVal').textContent = dim + '%';
  const isUrlBg = SETTINGS.bg.type === 'image' && SETTINGS.bg.source === 'url';
  g('bgUrl').value = isUrlBg ? String(SETTINGS.bg.value || '') : '';
  renderBgPresets();
  applyDataMode();
}
function bindSettingsEvents(){
  const g = id => document.getElementById(id);
  document.querySelectorAll('input[name=dataMode]').forEach(r => {
    r.addEventListener('change', () => {
      if(!r.checked) return;
      SETTINGS.dataMode = r.value;
      saveSettings(); applyDataMode();
      if(r.value === 'web'){ renderWebSourceList(); toast('已切换到「网页搜索源」模式'); }
      else{ renderApiList(); toast('已切换到「苹果CMS接口」模式'); }
    });
  });
  g('setAutoStart').addEventListener('change', e => {
    SETTINGS.autoStart = e.target.checked; saveSettings(); applyAutoStart();
    toast(e.target.checked ? '已开启开机自启（桌面版生效）' : '已关闭开机自启');
  });
  document.querySelectorAll('input[name=closeAction]').forEach(r => {
    r.addEventListener('change', () => {
      if(!r.checked) return;
      SETTINGS.closeAction = r.value; saveSettings(); applyCloseAction();
      toast(r.value === 'tray' ? '关闭时：隐藏到托盘' : '关闭时：彻底退出');
    });
  });
  g('setSkipIntro').addEventListener('change', e => {
    SETTINGS.skipIntro = e.target.checked;
    if(e.target.checked && !(+g('setIntroSec').value > 0)){ g('setIntroSec').value = 90; SETTINGS.introSec = 90; }
    saveSettings(); toast(SETTINGS.skipIntro ? '已开启跳过片头' : '已关闭跳过片头');
  });
  g('setIntroSec').addEventListener('input', e => {
    SETTINGS.introSec = Math.max(0, Math.min(600, parseInt(e.target.value) || 0)); saveSettings();
  });
  g('setSkipOutro').addEventListener('change', e => {
    SETTINGS.skipOutro = e.target.checked;
    if(e.target.checked && !(+g('setOutroSec').value > 0)){ g('setOutroSec').value = 60; SETTINGS.outroSec = 60; }
    saveSettings(); toast(SETTINGS.skipOutro ? '已开启跳过片尾' : '已关闭跳过片尾');
  });
  g('setOutroSec').addEventListener('input', e => {
    SETTINGS.outroSec = Math.max(0, Math.min(600, parseInt(e.target.value) || 0)); saveSettings();
  });
  g('setAutoNext').addEventListener('change', e => {
    SETTINGS.autoNext = e.target.checked; saveSettings();
    toast(SETTINGS.autoNext ? '已开启自动连播' : '已关闭自动连播');
  });
  g('setMemory').addEventListener('change', e => {
    SETTINGS.memoryPlay = e.target.checked; saveSettings();
    toast(SETTINGS.memoryPlay ? '已开启记忆播放' : '已关闭记忆播放');
  });
  g('bgDim').addEventListener('input', e => {
    const v = parseInt(e.target.value) || 0;
    g('bgDimVal').textContent = v + '%';
    SETTINGS.bg.dim = v / 100;
    applyBackground();
  });
  g('bgDim').addEventListener('change', () => saveSettings());

  g('bgFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!f) return;
    const isImgType = /^image\//i.test(f.type || '');
    const isImgName = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(f.name || '');
    if(!isImgType && !isImgName){ toast('请选择图片文件'); return; }

    toast('正在处理图片…');
    const blob = await compressBgImage(f, 1920, 0.82);
    if(!blob) return toast('❌ 图片处理失败，请换一张试试');

    try{
      await idbPutBg(blob);
    }catch(err){
      console.warn('[澪鸢] 背景写入 IndexedDB 失败:', err);
      return toast('❌ 保存失败：' + (err.message || '本地存储不可用'));
    }

    if(_bgObjectUrl){ try{ URL.revokeObjectURL(_bgObjectUrl); }catch(e2){} }
    _bgObjectUrl = URL.createObjectURL(blob);

    SETTINGS.bg.type   = 'image';
    SETTINGS.bg.source = 'idb';
    SETTINGS.bg.value  = BG_KEY;
    saveSettings();
    applyBackground();
    renderBgPresets();
    const input = $('#bgUrl'); if(input) input.value = '';
    toast('✅ 本地背景已应用（' + Math.max(1, Math.round(blob.size / 1024)) + ' KB）');
  });
}

const PROGRESS_KEY = 'yingchao_progress_v1';
function progressKey(){ return PROGRESS_KEY + '::' + userId(); }
function progressMap(){ try{ return JSON.parse(localStorage.getItem(progressKey()) || '{}') || {}; }catch(e){ return {}; } }
function getProgress(url){ if(!url) return 0; const m = progressMap(); return (m[url] && m[url].t) || 0; }
function getProgressEntry(url){ if(!url) return null; return progressMap()[url] || null; }
function setProgress(url, t, d){
  if(!url) return;
  const m = progressMap();
  const finished = (d && t > d - 10);
  if(!SETTINGS.memoryPlay || !t || t < 5 || finished){ delete m[url]; }
  else{ m[url] = { t: Math.floor(t), d: Math.floor(d || 0), ts: Date.now() }; }
  const keys = Object.keys(m);
  if(keys.length > 400){
    keys.sort((a,b) => (m[a].ts || 0) - (m[b].ts || 0))
        .slice(0, keys.length - 400).forEach(k => delete m[k]);
  }
  try{ localStorage.setItem(progressKey(), JSON.stringify(m)); }catch(e){}
}
function saveCurrentProgress(){
  const v = $('#video');
  if(!v || !state.currentUrl) return;
  const d = v.duration;
  if(isFinite(d) && d > 0 && v.currentTime > 0) setProgress(state.currentUrl, v.currentTime, d);
}
function clearAllProgress(){ try{ localStorage.removeItem(progressKey()); }catch(e){} toast('已清除全部播放记录'); }

const CONFIG_APP_NAME = '澪鸢';
const CONFIG_FILE_VER = 1;
function exportConfig(){
  if(!APIS.length && !WEB_SOURCES.length){ toast('当前没有任何数据源可导出'); return; }
  const data = {
    app: CONFIG_APP_NAME, version: CONFIG_FILE_VER,
    exportedAt: new Date().toISOString(),
    summary: { apis: APIS.length, webSources: WEB_SOURCES.length },
    apis: APIS.map(a => ({ id:a.id, name:a.name, url:a.url, detail:a.detail||'', enabled:a.enabled!==false, type:a.type||'' })),
    webSources: WEB_SOURCES.map(s => ({ id:s.id, name:s.name, icon:s.icon||'🔍', url:s.url, enabled:s.enabled!==false }))
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type:'application/json;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  const fname = `澪鸢数据源_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`已导出：${APIS.length} 个接口 / ${WEB_SOURCES.length} 个搜索源`);
}
function onImportFile(e){ const file = e.target.files && e.target.files[0]; if(file) importConfig(file); e.target.value = ''; }
function importConfig(file){
  if(!file) return;
  if(file.size > 2 * 1024 * 1024){ toast('文件过大（超过 2MB），可能不是有效的配置文件'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try{ const data = JSON.parse(reader.result); applyImportedConfig(data); }
    catch(err){ console.error(err); toast('❌ 文件解析失败，请确认是有效的配置文件'); }
  };
  reader.onerror = () => toast('文件读取失败');
  reader.readAsText(file, 'utf-8');
}
function applyImportedConfig(data){
  if(!data || typeof data !== 'object'){ toast('❌ 文件格式不正确'); return; }
  const rawApis = Array.isArray(data.apis) ? data.apis : [];
  const rawWeb  = Array.isArray(data.webSources) ? data.webSources : (Array.isArray(data.web_sources) ? data.web_sources : []);
  const validApis = rawApis.filter(a => a && typeof a.url === 'string' && /^https?:\/\//i.test(a.url))
    .map(a => ({ id: typeof a.id==='string'?a.id:'', name:(a.name&&String(a.name).trim())||'未命名源', url:a.url.trim(),
      detail:(a.detail&&String(a.detail).trim())||'', enabled:a.enabled!==false, type:a.type||'' }));
  const validWeb = rawWeb.filter(s => s && typeof s.url === 'string' && s.url.includes('{kw}'))
    .map(s => ({ id: typeof s.id==='string'?s.id:'', name:(s.name&&String(s.name).trim())||'未命名搜索源',
      icon:(s.icon&&String(s.icon).trim())||'🔍', url:s.url.trim(), enabled:s.enabled!==false }));
  if(!validApis.length && !validWeb.length){ toast('❌ 文件里没有找到有效的数据源'); return; }
  const msg = '📦 发现配置文件：\n\n· 苹果CMS接口：'+validApis.length+' 个\n· 网页搜索源：'+validWeb.length+' 个\n\n' +
              '将采用「合并」方式导入：\n· 保留现有全部数据源\n· 只把新数据源追加进来\n· 网址重复的项会自动跳过\n\n确定继续吗？';
  if(!confirm(msg)) return;
  const apiUrlSet = new Set(APIS.map(a => a.url));
  const apiIdSet  = new Set(APIS.map(a => a.id));
  let apiAdded = 0, apiSkipped = 0;
  validApis.forEach(a => {
    if(apiUrlSet.has(a.url)){ apiSkipped++; return; }
    let id = a.id && !apiIdSet.has(a.id) ? a.id : '';
    if(!id){ do { id = CUSTOM_PREFIX + Math.random().toString(36).slice(2, 9); } while(apiIdSet.has(id)); }
    apiIdSet.add(id);
    APIS.push({ id, name: a.name, url: a.url, detail: a.detail, enabled: a.enabled, type: a.type });
    apiUrlSet.add(a.url); apiAdded++;
  });
  const webUrlSet = new Set(WEB_SOURCES.map(s => s.url));
  const webIdSet  = new Set(WEB_SOURCES.map(s => s.id));
  let webAdded = 0, webSkipped = 0;
  validWeb.forEach(s => {
    if(webUrlSet.has(s.url)){ webSkipped++; return; }
    let id = s.id && !webIdSet.has(s.id) ? s.id : '';
    if(!id){ do { id = 'w_' + Math.random().toString(36).slice(2, 9); } while(webIdSet.has(id)); }
    webIdSet.add(id);
    WEB_SOURCES.push({ id, name: s.name, icon: s.icon, url: s.url, enabled: s.enabled });
    webUrlSet.add(s.url); webAdded++;
  });
  saveApis(); saveWebSources(); refreshDataSourceUI();
  const parts = [];
  if(apiAdded || apiSkipped) parts.push(`接口 +${apiAdded} 跳过 ${apiSkipped}`);
  if(webAdded || webSkipped) parts.push(`搜索源 +${webAdded} 跳过 ${webSkipped}`);
  if(!apiAdded && !webAdded && !apiSkipped && !webSkipped){ toast('文件内没有可导入的数据'); }
  else{ toast(`✅ 已合并：${parts.join(' / ')}`); }
}
function refreshDataSourceUI(){
  renderApiList(); updateApiCount(); renderWebSourceList(); updateWebCount();
  if(document.getElementById('clearDialog')?.classList.contains('open')){ renderClearLists(); updateClearSummary(); }
}

function openClearDialog(){
  clearSelectedIds.api.clear(); clearSelectedIds.web.clear();
  const p = document.getElementById('clrProgress'), c = document.getElementById('clrCookie');
  if(p) p.checked = false; if(c) c.checked = false;
  renderClearLists(); updateClearSummary();
  document.getElementById('clearMask').classList.add('open');
  document.getElementById('clearDialog').classList.add('open');
}
function closeClearDialog(e){
  if(e && e.target && !e.target.classList.contains('clear-mask')) return;
  const dlg = document.getElementById('clearDialog'), msk = document.getElementById('clearMask');
  if(dlg) dlg.classList.remove('open'); if(msk) msk.classList.remove('open');
}
function renderClearLists(){
  const apiBox = document.getElementById('clearApiList'), webBox = document.getElementById('clearWebList');
  if(!apiBox || !webBox) return;
  if(!APIS.length){
    apiBox.innerHTML = '<div class="clear-empty">暂无苹果CMS接口</div>';
    const cnt = document.getElementById('clearApiCount'); if(cnt) cnt.textContent = '0 个';
  }else{
    const cnt = document.getElementById('clearApiCount'); if(cnt) cnt.textContent = APIS.length + ' 个';
    apiBox.innerHTML = APIS.map((a) => {
      const isDefault = DEFAULT_APIS.some(d => d.id === a.id);
      const on = clearSelectedIds.api.has(a.id);
      return `<label class="clear-item">
        <input type="checkbox" data-type="api" data-id="${esc(a.id)}" ${on ? 'checked' : ''} onchange="onClearItemToggle(this)">
        <div class="clear-item-info">
          <div class="clear-item-name">${esc(a.name)}</div>
          <div class="clear-item-desc" title="${esc(a.url)}">${esc(a.url)}</div>
        </div>
        <span class="clear-item-tag${isDefault ? ' default' : ''}">${isDefault ? '默认' : '自定义'}</span>
      </label>`;
    }).join('');
  }
  if(!WEB_SOURCES.length){
    webBox.innerHTML = '<div class="clear-empty">暂无网页搜索源</div>';
    const cnt = document.getElementById('clearWebCount'); if(cnt) cnt.textContent = '0 个';
  }else{
    const cnt = document.getElementById('clearWebCount'); if(cnt) cnt.textContent = WEB_SOURCES.length + ' 个';
    webBox.innerHTML = WEB_SOURCES.map((s) => {
      const isDefault = DEFAULT_WEB_SOURCES.some(d => d.id === s.id);
      const on = clearSelectedIds.web.has(s.id);
      return `<label class="clear-item">
        <input type="checkbox" data-type="web" data-id="${esc(s.id)}" ${on ? 'checked' : ''} onchange="onClearItemToggle(this)">
        <div class="clear-item-info">
          <div class="clear-item-name">${s.icon || '🔍'} ${esc(s.name)}</div>
          <div class="clear-item-desc" title="${esc(s.url)}">${esc(s.url)}</div>
        </div>
        <span class="clear-item-tag${isDefault ? ' default' : ''}">${isDefault ? '默认' : '自定义'}</span>
      </label>`;
    }).join('');
  }
}
function onClearItemToggle(cb){
  const type = cb.dataset.type, id = cb.dataset.id;
  if(!type || !id) return;
  const set = clearSelectedIds[type]; if(!set) return;
  if(cb.checked) set.add(id); else set.delete(id);
  updateClearSummary();
}
function clearSelectGroup(type, on){
  const set = clearSelectedIds[type]; if(!set) return;
  set.clear();
  if(on){ if(type === 'api') APIS.forEach(a => set.add(a.id)); else WEB_SOURCES.forEach(s => set.add(s.id)); }
  document.querySelectorAll(`#clearDialog input[data-type="${type}"]`).forEach(cb => { cb.checked = on; });
  updateClearSummary();
}
function updateClearSummary(){
  const p = document.getElementById('clrProgress')?.checked;
  const c = document.getElementById('clrCookie')?.checked;
  const apiN = clearSelectedIds.api.size, webN = clearSelectedIds.web.size;
  const total = (p?1:0) + (c?1:0) + apiN + webN;
  const btn = document.getElementById('clearExecBtn'); if(btn) btn.disabled = total === 0;
  const parts = [];
  if(p) parts.push('观看记录'); if(c) parts.push('Cookie');
  if(apiN) parts.push(`CMS接口 ${apiN} 个`); if(webN) parts.push(`网页搜索源 ${webN} 个`);
  const sum = document.getElementById('clearSummary');
  if(sum) sum.innerHTML = total === 0 ? '未选择任何内容' : `已选 <b>${total}</b> 项：${parts.join(' · ')}`;
}
function executeSelectiveClear(){
  const p = document.getElementById('clrProgress')?.checked;
  const c = document.getElementById('clrCookie')?.checked;
  const apiIds = [...clearSelectedIds.api], webIds = [...clearSelectedIds.web];
  const total = (p?1:0) + (c?1:0) + apiIds.length + webIds.length;
  if(total === 0){ toast('请至少选择一项要清理的数据'); return; }
  const parts = [];
  if(p) parts.push('全部观看记录'); if(c) parts.push('本站 Cookie');
  if(apiIds.length) parts.push(`${apiIds.length} 个苹果CMS接口`);
  if(webIds.length) parts.push(`${webIds.length} 个网页搜索源`);
  const ok = confirm('确定要清除以下数据吗？\n\n· ' + parts.join('\n· ') + '\n\n此操作不可恢复！');
  if(!ok) return;
  if(p){ try{ localStorage.removeItem(progressKey()); }catch(e){} mutateBucket(b => { b.history = []; }); }
  if(c) clearCookies();
  if(apiIds.length){
    const delSet = new Set(apiIds);
    APIS = APIS.filter(a => !delSet.has(a.id)); saveApis();
    if(editingApiIdx > -1 && !APIS[editingApiIdx]) cancelApiEdit();
    renderApiList(); updateApiCount();
  }
  if(webIds.length){
    const delSet = new Set(webIds);
    WEB_SOURCES = WEB_SOURCES.filter(s => !delSet.has(s.id)); saveWebSources();
    if(editingWebIdx > -1 && !WEB_SOURCES[editingWebIdx]) cancelWebEdit();
    renderWebSourceList(); updateWebCount();
  }
  clearSelectedIds.api.clear(); clearSelectedIds.web.clear();
  closeClearDialog();
  toast(`已清理 ${parts.length} 项数据`);
}
function clearCookies(){
  try{
    const list = String(document.cookie || '').split(';');
    const paths = ['/', location.pathname];
    list.forEach(c => {
      const name = c.split('=')[0].trim();
      if(!name) return;
      paths.forEach(p => { document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=' + p; });
    });
  }catch(e){}
}
function clearAllUserData(){
  const customApiCount = APIS.filter(a => String(a.id).startsWith(CUSTOM_PREFIX)).length;
  const customWebCount = WEB_SOURCES.filter(s => !DEFAULT_WEB_SOURCES.some(d => d.id === s.id)).length;
  const ok = confirm(
    '确定要清除以下本地数据吗？\n\n· 全部观看记录\n· 你自定义添加的 ' + customApiCount + ' 个 API 接口\n' +
    '· 你自定义添加的 ' + customWebCount + ' 个网页搜索源\n· 本站写入的 Cookie\n\n' +
    '数据源会还原为内置默认列表与默认勾选状态。\n此操作不可恢复！'
  );
  if(!ok) return;
  try{ localStorage.removeItem(progressKey()); }catch(e){}
  APIS = JSON.parse(JSON.stringify(DEFAULT_APIS)); saveApis();
  try{ localStorage.removeItem(WEB_LS_KEY); }catch(e){}
  WEB_SOURCES = JSON.parse(JSON.stringify(DEFAULT_WEB_SOURCES)); saveWebSources();
  clearCookies();
  stopVideo(); cancelApiEdit(); cancelWebEdit();
  renderApiList(); updateApiCount(); renderWebSourceList(); updateWebCount();
  toast('已清除观看记录、自定义接口、自定义搜索源与 Cookie');
}

function clearOutro(){
  if(state.outroTimer){ clearInterval(state.outroTimer); state.outroTimer = null; }
  state.outroRunning = false;
  const bar = $('#outroBar'); if(bar) bar.classList.remove('show');
}
let pseudoFs = false;
let fsRedirecting = false;
let vCtrlHideTimer = null;
let _suppressVideoClick = false;

function getFsEl(){
  return document.fullscreenElement ||
         document.webkitFullscreenElement ||
         document.msFullscreenElement || null;
}
function isFsActive(){
  const wrap = document.getElementById('playerWrap');
  return !!getFsEl() || !!(wrap && wrap.classList.contains('pseudo-fs'));
}
function enterPseudoFs(){
  const wrap = document.getElementById('playerWrap');
  if(!wrap || wrap.classList.contains('pseudo-fs')) return;
  wrap.classList.add('pseudo-fs');
  document.body.classList.add('pseudo-fs-lock');
  pseudoFs = true;
  updateFullBtn();
}
function exitPseudoFs(){
  const wrap = document.getElementById('playerWrap');
  if(wrap) wrap.classList.remove('pseudo-fs');
  document.body.classList.remove('pseudo-fs-lock');
  pseudoFs = false;
  updateFullBtn();
}
function requestWrapFs(){
  const wrap = document.getElementById('playerWrap');
  if(!wrap) return;
  const fn = wrap.requestFullscreen ||
             wrap.webkitRequestFullscreen ||
             wrap.msRequestFullscreen;
  if(fn){
    try{
      const p = fn.call(wrap);
      if(p && p.catch) p.catch(() => enterPseudoFs());
      return;
    }catch(e){}
  }
  enterPseudoFs();
}
function exitAnyFs(){
  const exit = document.exitFullscreen ||
               document.webkitExitFullscreen ||
               document.msExitFullscreen;
  if(getFsEl() && exit){
    try{
      const p = exit.call(document);
      if(p && p.catch) p.catch(() => {});
    }catch(e){}
  }
  if(pseudoFs) exitPseudoFs();
  setTimeout(syncFsUI, 100);
}
function toggleFullscreen(e){
  if(e){ e.stopPropagation(); e.preventDefault(); }
  if(isFsActive()) exitAnyFs();
  else requestWrapFs();
}
function updateFullBtn(){
  const b = document.getElementById('vFullBtn');
  if(!b) return;
  b.textContent = isFsActive() ? '⤡' : '⛶';
  b.title = isFsActive() ? '退出全屏' : '全屏';
}

function updateVideoTitle(){
  const t = document.getElementById('vTitle');
  if(!t) return;
  const m = state.current;
  if(!m){ t.textContent = '—'; return; }
  const ep = state.lines[state.lineIdx]?.episodes[state.epIdx];
  t.textContent = (m.vod_name || '未知影片') + (ep ? ' · ' + ep.name : '');
}
function syncFsUI(){
  updateFullBtn();
  updateVideoTitle();
}
function onFsChange(){
  const fsEl = getFsEl();
  const video = document.getElementById('video');
  if(fsEl && fsEl === video && !fsRedirecting){
    fsRedirecting = true;
    const exit = document.exitFullscreen ||
                 document.webkitExitFullscreen ||
                 document.msExitFullscreen;
    const go = () => {
      requestWrapFs();
      setTimeout(() => { fsRedirecting = false; }, 500);
    };
    try{
      const p = exit ? exit.call(document) : null;
      if(p && p.then) p.then(() => setTimeout(go, 30)).catch(() => { fsRedirecting = false; });
      else setTimeout(go, 30);
    }catch(err){ fsRedirecting = false; }
    return;
  }
  if(!fsEl && pseudoFs){ exitPseudoFs(); }
  syncFsUI();
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
document.addEventListener('msfullscreenchange', onFsChange);

function fmtClock(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  const pad = n => String(n).padStart(2,'0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function togglePlay(){
  const v = document.getElementById('video');
  if(!v) return;
  if(v.paused) v.play().catch(()=>{});
  else v.pause();
  showCtrlLayer();
}
function syncPlayIcon(){
  const v = document.getElementById('video');
  if(!v) return;
  const paused = v.paused;
  const btn = document.getElementById('vPlayBtn');
  if(btn) btn.textContent = paused ? '▶' : '❚❚';
  const center = document.getElementById('vCenter');
  if(center) center.classList.toggle('show', paused);
}
function syncTimeAndProgress(){
  const v = document.getElementById('video');
  if(!v) return;
  const d = isFinite(v.duration) ? v.duration : 0;
  const t = v.currentTime || 0;
  const pct = d > 0 ? (t / d * 100) : 0;
  const play = document.getElementById('vPlay');
  const thumb = document.getElementById('vThumb');
  if(play) play.style.width = pct + '%';
  if(thumb) thumb.style.left = pct + '%';
  const tc = document.getElementById('vTimeCur');
  const td = document.getElementById('vTimeDur');
  if(tc) tc.textContent = fmtClock(t);
  if(td) td.textContent = fmtClock(d);
}
function syncBuffered(){
  const v = document.getElementById('video');
  if(!v) return;
  const d = isFinite(v.duration) ? v.duration : 0;
  if(!d || !v.buffered || !v.buffered.length) return;
  const end = v.buffered.end(v.buffered.length - 1);
  const pct = Math.min(100, end / d * 100);
  const b = document.getElementById('vBuf');
  if(b) b.style.width = pct + '%';
}
function showCtrlLayer(){
  const layer = document.getElementById('vCtrlLayer');
  if(!layer) return;
  layer.classList.remove('hide');
  scheduleCtrlHide();
}
function scheduleCtrlHide(){
  clearTimeout(vCtrlHideTimer);
  vCtrlHideTimer = setTimeout(() => {
    const layer = document.getElementById('vCtrlLayer');
    const v = document.getElementById('video');
    if(!layer) return;
    if(v && !v.paused) layer.classList.add('hide');
  }, 3000);
}
function toggleCtrlLayer(){
  const layer = document.getElementById('vCtrlLayer');
  if(!layer) return;
  if(layer.classList.contains('hide')) showCtrlLayer();
  else layer.classList.add('hide');
}

function showVideoLoading(){
  const el = document.getElementById('vLoading');
  if(el) el.classList.add('show');
}
function hideVideoLoading(){
  const el = document.getElementById('vLoading');
  if(el) el.classList.remove('show');
}

function initProgressDrag(){
  const wrap = document.getElementById('vProgress');
  const v = document.getElementById('video');
  if(!wrap || !v || wrap.__bound) return;
  wrap.__bound = true;

  let dragging = false;
  function pctFrom(clientX){
    const r = wrap.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }
  function paint(p){
    const play = document.getElementById('vPlay');
    const thumb = document.getElementById('vThumb');
    if(play) play.style.width = (p*100) + '%';
    if(thumb) thumb.style.left = (p*100) + '%';
    if(isFinite(v.duration)){
      const tc = document.getElementById('vTimeCur');
      if(tc) tc.textContent = fmtClock(p * v.duration);
    }
  }
  function down(clientX){
    dragging = true;
    wrap.classList.add('dragging');
    state._lastSelfSeek = Date.now();
    paint(pctFrom(clientX));
    showCtrlLayer();
  }
  function move(clientX){
    if(!dragging) return;
    paint(pctFrom(clientX));
  }
  function up(clientX){
    if(!dragging) return;
    dragging = false;
    wrap.classList.remove('dragging');
    const p = pctFrom(clientX);
    if(isFinite(v.duration)){ try{ v.currentTime = p * v.duration; }catch(e){} }
    showCtrlLayer();
  }
  wrap.addEventListener('mousedown', e => { e.preventDefault(); down(e.clientX); });
  document.addEventListener('mousemove', e => { if(dragging) move(e.clientX); });
  document.addEventListener('mouseup',   e => { if(dragging) up(e.clientX); });
  wrap.addEventListener('touchstart', e => { if(e.touches.length===1) down(e.touches[0].clientX); }, {passive:true});
  wrap.addEventListener('touchmove',  e => { if(dragging && e.touches.length===1){ e.preventDefault(); move(e.touches[0].clientX); } }, {passive:false});
  wrap.addEventListener('touchend',   e => { if(dragging && e.changedTouches.length) up(e.changedTouches[0].clientX); });
}

const SPEED_OPTS = [
  {v:0.5,  n:'0.5×'},
  {v:0.75, n:'0.75×'},
  {v:1,    n:'1.0×（正常）'},
  {v:1.25, n:'1.25×'},
  {v:1.5,  n:'1.5×'},
  {v:2,    n:'2.0×'},
  {v:3,    n:'3.0×'}
];
const RATIO_OPTS = [
  {v:'contain', n:'适应'},
  {v:'cover',   n:'铺满'},
  {v:'fill',    n:'拉伸'}
];
function openVSheet(type){
  const sheet = document.getElementById('vSheet');
  const video = document.getElementById('video');
  if(!sheet || !video) return;

  if(sheet.classList.contains('open') && sheet.dataset.type === type){
    sheet.classList.remove('open');
    sheet.dataset.type = '';
    return;
  }
  sheet.dataset.type = type;

  let html = '';
  if(type === 'speed'){
    const cur = parseFloat(video.playbackRate) || 1;
    html = '<div class="v-sheet-title">播放倍速</div>' +
      SPEED_OPTS.map(o => `<button class="v-sheet-item${Math.abs(o.v-cur)<0.01?' on':''}" onclick="setSpeed(${o.v})">${o.n}</button>`).join('');
  } else if(type === 'ratio'){
    const cur = video.dataset.ratio || 'contain';
    html = '<div class="v-sheet-title">画面比例</div>' +
      RATIO_OPTS.map(o => `<button class="v-sheet-item${o.v===cur?' on':''}" onclick="setRatio('${o.v}')">${o.n}</button>`).join('');
  } else if(type === 'quality'){
    const levels = state.hlsLevels;
    if(!levels || levels.length <= 1){
      html = '<div class="v-sheet-title">清晰度</div><button class="v-sheet-item on">自动（单码率）</button>';
    } else {
      const sorted = levels.map((lv,i)=>({...lv,index:i})).sort((a,b)=>(b.height||b.bitrate||0)-(a.height||a.bitrate||0));
      html = '<div class="v-sheet-title">清晰度</div>' +
        `<button class="v-sheet-item${state.hlsLevel===-1?' on':''}" onclick="setQuality(-1)">自动</button>` +
        sorted.map(lv => `<button class="v-sheet-item${state.hlsLevel===lv.index?' on':''}" onclick="setQuality(${lv.index})">${levelName(lv)}</button>`).join('');
    }
  } else if(type === 'episode'){
    const eps = state.lines[state.lineIdx]?.episodes || [];
    if(!eps.length){
      html = '<div class="v-sheet-title">选集</div><button class="v-sheet-item">暂无剧集</button>';
    } else {
      html = '<div class="v-sheet-title">选集</div>' +
        eps.map((ep,j)=>`<button class="v-sheet-item${j===state.epIdx?' on':''}" onclick="playEpisode(${state.lineIdx},${j});closeVSheet();">${esc(ep.name||('第'+(j+1)+'集'))}</button>`).join('');
    }
  }
  sheet.innerHTML = html;
  sheet.classList.add('open');
  showCtrlLayer();
}
function closeVSheet(){
  const sheet = document.getElementById('vSheet');
  if(sheet){
    sheet.classList.remove('open');
    sheet.dataset.type = '';
  }
}
function setSpeed(v){
  const video = document.getElementById('video');
  if(video) video.playbackRate = v;
  const label = document.getElementById('vSpeedLabel');
  if(label) label.textContent = (Math.abs(v-1)<0.01) ? '倍速' : v + '×';
  closeVSheet();
}
function setRatio(v){
  const video = document.getElementById('video');
  if(!video) return;
  video.dataset.ratio = v;
  video.style.objectFit = v;
  closeVSheet();
}

function initVideoControls(){
  const v = document.getElementById('video');
  if(!v || v.__controlsBound) return;
  v.__controlsBound = true;

  v.addEventListener('play',            () => { syncPlayIcon(); scheduleCtrlHide(); });
  v.addEventListener('pause',           () => { syncPlayIcon(); showCtrlLayer(); });
  v.addEventListener('timeupdate',      () => { syncTimeAndProgress(); });
  v.addEventListener('progress',        syncBuffered);
  v.addEventListener('loadedmetadata',  syncTimeAndProgress);
  v.addEventListener('durationchange',  syncTimeAndProgress);

  v.addEventListener('waiting',         showVideoLoading);
  v.addEventListener('stalled',         showVideoLoading);
  v.addEventListener('playing',         hideVideoLoading);
  v.addEventListener('canplay',         hideVideoLoading);
  v.addEventListener('canplaythrough',  hideVideoLoading);
  v.addEventListener('error',           hideVideoLoading);
  v.addEventListener('seeked',          hideVideoLoading);
  v.addEventListener('emptied',         hideVideoLoading);

  let pcClickCount = 0;
  let pcClickTimer = null;
  v.addEventListener('click', () => {
    if(_suppressVideoClick){ _suppressVideoClick = false; return; }
    if(IS_TOUCH){
      toggleCtrlLayer();
      return;
    }
    pcClickCount++;
    if(pcClickCount === 1){
      pcClickTimer = setTimeout(() => {
        pcClickTimer = null;
        pcClickCount = 0;
        toggleCtrlLayer();
      }, 250);
    } else {
      clearTimeout(pcClickTimer);
      pcClickTimer = null;
      pcClickCount = 0;
      togglePlay();
    }
  });

  const layer = document.getElementById('vCtrlLayer');
  if(layer){
    layer.addEventListener('click', e => {
      if(!e.target.closest('.v-sheet')) showCtrlLayer();
    });
    layer.addEventListener('touchstart', e => {
      if(!e.target.closest('.v-sheet')) showCtrlLayer();
    }, {passive:true});
  }

  document.addEventListener('click', e => {
    const sheet = document.getElementById('vSheet');
    if(!sheet || !sheet.classList.contains('open')) return;
    if(e.target.closest('.v-sheet')) return;
    if(e.target.closest('.v-txt')) return;
    closeVSheet();
  });

  const sheet = document.getElementById('vSheet');
  if(sheet && !sheet.__scrollGuard){
    sheet.__scrollGuard = true;
    sheet.addEventListener('touchstart', function(e){
      e.stopPropagation();
    }, {passive:true});
    sheet.addEventListener('touchmove', function(e){
      e.stopPropagation();
      const atTop    = sheet.scrollTop <= 0;
      const atBottom = sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 1;
      if(!e.touches || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - (sheet.__lastY || e.touches[0].clientY);
      sheet.__lastY = e.touches[0].clientY;
      if((atTop && dy > 0) || (atBottom && dy < 0)){
        if(e.cancelable) e.preventDefault();
      }
    }, {passive:false});
    sheet.addEventListener('touchend', function(e){
      e.stopPropagation();
      sheet.__lastY = 0;
    }, {passive:true});
    sheet.addEventListener('touchcancel', function(e){
      e.stopPropagation();
      sheet.__lastY = 0;
    }, {passive:true});
  }

  initProgressDrag();
  syncPlayIcon();
  syncTimeAndProgress();
  syncFsUI();

  setTimeout(() => scheduleCtrlHide(), 2000);
}

function stopVideo(){
  saveCurrentProgress(); clearOutro();
  state.currentUrl = ''; state.resumeAt = 0; state.resumeReason = '';
  if(state._seekTimer){ clearTimeout(state._seekTimer); state._seekTimer = null; }
  if(document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
  if(pseudoFs) exitPseudoFs();
  if(hlsInstance){ try{ hlsInstance.destroy(); }catch(e){} hlsInstance = null; }
  const video = $('#video');
  if(video){ try{ video.pause(); }catch(e){} video.removeAttribute('src'); try{ video.load(); }catch(e){} }
  hideVideoLoading();
  document.querySelectorAll('#epGrid .ep.playing').forEach(el => el.classList.remove('playing'));
  resetQualityUI();
}
function showView(id, pushHistory = true){
  if(id !== 'view-detail') stopVideo();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  window.scrollTo({ top:0, behavior:'smooth' });

  if(pushHistory){
    const current = history.state;
    if(!current || current.view !== id){
      history.pushState({ view: id }, '', '#' + id);
    }
  }
}
function goHome(){
  stopVideo(); state.current=null; state.lines=[]; state.lineIdx=0; state.epIdx=0;
  $('#kw').value=''; hideSearchDrop(); showView('view-home');
}
function goBack(){
  if (history.length > 1) {
    history.back();
  } else {
    stopVideo(); state.current=null; state.lines=[]; state.lineIdx=0; state.epIdx=0;
    if(state.results.length) showView('view-results', false); else goHome();
  }
}
window.addEventListener('popstate', function(e){
  const viewId = (e.state && e.state.view) || 'view-home';

  const detailEl = document.getElementById('view-detail');
  const detailActive = detailEl && detailEl.classList.contains('active');
  if (detailActive && viewId !== 'view-detail') {
    stopVideo();
  }

  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === viewId));
  window.scrollTo({ top:0, behavior:'smooth' });

  if (viewId === 'view-detail') {
    if (state.current) {
      updateFavBtn();
      renderLines();
    }
  } else if (viewId === 'view-profile') {
    renderProfile();
  }
});

async function fetchOne(api, kw, timeout = 15000, signal){
  if(api.type === 'animegarden') return fetchAnimeGarden(api, kw, timeout, signal);

  const targetUrl = `${api.url}?ac=detail&wd=${encodeURIComponent(kw)}`;
  const urlsToTry = [
    targetUrl,
    `https://my-proxy.2169215579.workers.dev/?url=${encodeURIComponent(targetUrl)}`
  ];

  for (let url of urlsToTry) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;

      const text = await res.text();
      const cleanText = text.trim().replace(/^\uFEFF/, '');
      
      if (!cleanText.startsWith('{') && !cleanText.startsWith('[')) continue;

      const data = JSON.parse(cleanText);
      if (data && data.list && Array.isArray(data.list)) {
        return data.list.filter(it => it && it.vod_name).map(item => ({ ...item, _source: api.name, _sourceId: api.id }));
      }
    } catch (e) {
      clearTimeout(timer);
    }
  }
  return [];
}
async function fetchAnimeGarden(api, kw, timeout = 15000, signal){
  const baseUrl = api.url || 'https://api.animes.garden/resources';
  const url = new URL(baseUrl);
  url.searchParams.set('search', kw); 
  url.searchParams.set('page', '1'); 
  url.searchParams.set('pageSize', '50');

  const targetUrl = url.toString();
  const urlsToTry = [
    targetUrl,
    `https://my-proxy.2169215579.workers.dev/?url=${encodeURIComponent(targetUrl)}`
  ];

  for (const tryUrl of urlsToTry) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch(tryUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;

      const text = await res.text();
      const cleanText = text.trim().replace(/^\uFEFF/, '');
      if (!cleanText.startsWith('{') && !cleanText.startsWith('[')) continue;

      const data = JSON.parse(cleanText);
      if (data.status === 'OK' && Array.isArray(data.resources)) {
        return data.resources.map(item => {
          const title = item.title || '未知资源';
          const magnet = item.magnet || '';
          const size = item.size ? formatSize(item.size) : '';
          const fansub = item.fansub ? (item.fansub.name || item.fansub) : '';
          const publisher = item.publisher ? (item.publisher.name || item.publisher) : '';
          const type = item.type || '';
          const createdAt = item.createdAt ? new Date(item.createdAt).getFullYear() : '';
          return { 
            vod_name: title, vod_pic:'', vod_play_url: magnet, vod_play_from:'Magnet',
            vod_year: String(createdAt), type_name: type,
            vod_remarks: [fansub, size].filter(Boolean).join(' · '),
            _source: api.name, _sourceId: api.id, _magnet: magnet, _size: size,
            _fansub: fansub, _publisher: publisher, _href: item.href || '' 
          };
        });
      }
    } catch (e) {
      clearTimeout(timer);
    }
  }
  return [];
}
function formatSize(bytes){
  if(!bytes) return '';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, size = bytes;
  while(size >= 1024 && i < units.length - 1){ size /= 1024; i++; }
  return size.toFixed(i === 0 ? 0 : 1) + units[i];
}
let currentSearchController = null;

async function doSearch(kw){
  kw = (kw ?? $('#kw').value).trim();
  if(!kw){ toast('请输入搜索关键词'); return; }

  if (currentSearchController) {
    currentSearchController.abort();
  }
  currentSearchController = new AbortController();
  const searchSignal = currentSearchController.signal;

  $('#kw').value = kw; state.keyword = kw; state.results = [];
  hideSearchDrop(); addSearch(kw);

  if(SETTINGS.dataMode === 'web'){ stopVideo(); doWebSearch(kw); return; }

  const enabled = APIS.filter(a => a.enabled);
  if(!enabled.length){ toast('请先在设置里启用至少一个数据源'); return; }

  stopVideo(); showView('view-results');

  const total = enabled.length;
  let done = 0;
  const map = new Map();
  const sourceHits = new Set();
  let rafId = 0;
  let everPainted = false;

  function paint(){
    if(searchSignal.aborted) return;
    if(!state.keyword) return;
    state.results = [...map.values()];
    if(!state.results.length){
      $('#resultMeta').innerHTML = `<span>正在搜索 <b>${esc(kw)}</b> …（已扫描 ${done}/${total} 个源）</span>`;
      if(!everPainted){
        $('#resultBody').innerHTML = `<div class="loading"><div class="spinner"></div><span>正在从 ${total} 个资源站聚合搜索…</span></div>`;
      }
      return;
    }
    everPainted = true;
    const srcList = [...sourceHits];
    $('#resultMeta').innerHTML =
      `<span>共找到 <b>${state.results.length}</b> 部作品 · 已扫描 <b>${done}/${total}</b> 个源</span>
       <div class="src-badges">${srcList.map(s => `<span class="src-badge">${esc(s)}</span>`).join('')}</div>`;
    $('#resultBody').innerHTML = `<div class="grid">${state.results.map((m, i) => renderCard(m, i)).join('')}</div>`;
  }
  
  function schedulePaint(){
    if(searchSignal.aborted) return;
    if(rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; paint(); });
  }

  $('#resultMeta').innerHTML = `<span>正在搜索 <b>${esc(kw)}</b> …</span>`;
  $('#resultBody').innerHTML = `<div class="loading"><div class="spinner"></div><span>正在从 ${total} 个资源站聚合搜索…</span></div>`;

    function mergeItems(items){
    if(searchSignal.aborted) return;
    (items || []).forEach(item => {
      if(!item || !item.vod_name) return;

      const kwSeasonMatch = kw.match(/第([一二三四五六七八九十0-9]+)季/);
      if (kwSeasonMatch) {
        const targetSeason = kwSeasonMatch[0];
        const itemSeasonMatch = item.vod_name.match(/第([一二三四五六七八九十0-9]+)季/);
        if (itemSeasonMatch && itemSeasonMatch[0] !== targetSeason) {
          return; 
        }
      }

      sourceHits.add(item._source);
      const key = (item.vod_name.trim().replace(/\s+/g, ' ') + '|' + (item.vod_year || '')).toLowerCase();
      const old = map.get(key);
      
      if(!old){ 
        item._allSources = [item._source]; 
        map.set(key, item); 
      } else {
        if(!old._allSources.includes(item._source)) old._allSources.push(item._source);
        
        if(!old.vod_pic     && item.vod_pic)     old.vod_pic     = item.vod_pic;
        if(!old.vod_content && item.vod_content) old.vod_content = item.vod_content;
        if(!old.vod_score   && item.vod_score)   old.vod_score   = item.vod_score;
        if(!old.vod_remarks && item.vod_remarks) old.vod_remarks = item.vod_remarks;

        if (item.vod_play_url && item.vod_play_url.trim() !== '') {
          const itemFrom = item.vod_play_from || item._source || '未知线路';
          
          if (!old.vod_play_url) {
            old.vod_play_url = item.vod_play_url;
            old.vod_play_from = itemFrom;
          } else {
            if (!old.vod_play_url.includes(item.vod_play_url)) {
              old.vod_play_from += '$$$' + itemFrom;
              old.vod_play_url += '$$$' + item.vod_play_url;
            }
          }
        }
      }
    });
  }

  const tasks = enabled.map(api => {
    return (async () => {
      if (searchSignal.aborted) return;
      try {
        const items = await fetchOne(api, kw, 15000);
        if (searchSignal.aborted) return;
        mergeItems(items);
      } catch (e) {
      }
      done++;
      schedulePaint();
    })();
  });

  await Promise.allSettled(tasks);

  if(searchSignal.aborted) return;

  if(rafId){ cancelAnimationFrame(rafId); rafId = 0; }
  paint();

  if(!state.results.length){
    $('#resultMeta').innerHTML = '';
    $('#resultBody').innerHTML = `<div class="empty"><div class="big">🎬</div><h3>没有找到「${esc(kw)}」相关资源</h3><p>换个关键词试试，或者去设置里启用更多数据源</p></div>`;
    return;
  }
}



function doWebSearch(kw){
  showView('view-results');
  const list = WEB_SOURCES.filter(s => s.enabled);
  if(!list.length){
    $('#resultMeta').innerHTML = '';
    $('#resultBody').innerHTML = `<div class="empty"><div class="big">🔗</div><h3>还没有启用任何网页搜索源</h3><p>点右上角 ⚙ 设置 → 数据源，勾选或添加搜索源</p></div>`;
    return;
  }
  $('#resultMeta').innerHTML = `<span>关键词 <b>${esc(kw)}</b> · 已启用 <b>${list.length}</b> 个网页搜索源</span>
    <button class="mini-btn" style="flex:0 0 auto;width:auto;min-width:0;padding:8px 16px" onclick="openAllWeb()">⚡ 一键全源</button>`;
  $('#resultBody').innerHTML = `<div class="web-grid">${list.map(s => {
    const u = s.url.replace(/\{kw\}/g, encodeURIComponent(kw));
    return `<div class="web-card">
      <div class="ic">${s.icon || '🔍'}</div>
      <div style="min-width:0;flex:1">
        <div class="nm">${esc(s.name)}</div>
        <div class="u" title="${esc(u)}">${esc(u)}</div>
      </div>
      <div class="actions">
        <button class="act-btn preview" onclick="openWebView('${s.id}')">🔍 预览</button>
        <button class="act-btn direct" onclick="openWebSource('${s.id}')">↗ 直达</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}
function openWebSource(id){
  const s = WEB_SOURCES.find(x => x.id === id); if(!s) return;
  const kw = state.keyword || $('#kw').value.trim(); if(!kw) return toast('请先输入关键词');
  window.open(s.url.replace(/\{kw\}/g, encodeURIComponent(kw)), '_blank', 'noopener');
}
function openAllWeb(){
  const kw = state.keyword || $('#kw').value.trim(); if(!kw) return toast('请先输入关键词');
  const list = WEB_SOURCES.filter(s => s.enabled); if(!list.length) return toast('没有启用的搜索源');
  list.forEach((s, i) => {
    setTimeout(() => { window.open(s.url.replace(/\{kw\}/g, encodeURIComponent(kw)), '_blank', 'noopener'); }, i * 160);
  });
  toast(`已尝试打开 ${list.length} 个站点，若被拦截请允许本站弹出窗口`);
}

async function openWebView(id){
  const s = WEB_SOURCES.find(x => x.id === id); if(!s) return;
  const kw = state.keyword || $('#kw').value.trim(); if(!kw) return toast('请先输入关键词');
  const url = s.url.replace(/\{kw\}/g, encodeURIComponent(kw));
  wvState = { url, name: s.name, icon: s.icon || '🔍' };
  $('#wvIcon').textContent = wvState.icon;
  $('#wvName').textContent = wvState.name;
  $('#wvUrl').textContent  = url; $('#wvUrl').title = url;
  $('#webviewMask').classList.add('open');
  $('#webview').classList.add('open');
  await loadWebViewPreview(url);
}
function closeWebView(){
  $('#webviewMask').classList.remove('open');
  $('#webview').classList.remove('open');
  hideWvTip(); wvToken++;
  setTimeout(() => { const f = $('#wvFrame'); if(f){ f.srcdoc = ''; f.removeAttribute('src'); } }, 240);
}
function hideWvTip(){ const t = $('#wvTip'); if(t) t.classList.remove('show'); }
function loadWebViewPreview(url){
  const myToken = ++wvToken;
  const frame = $('#wvFrame'), loading = $('#wvLoading'), fail = $('#wvFail');
  loading.style.display = 'flex'; fail.style.display = 'none'; hideWvTip();
  frame.style.display = 'block'; frame.removeAttribute('srcdoc'); frame.removeAttribute('src');
  let settled = false;
  const finish = (showTip) => {
    if(settled || myToken !== wvToken) return;
    settled = true; loading.style.display = 'none';
    if(showTip){ setTimeout(() => { if(myToken === wvToken){ const t = $('#wvTip'); if(t) t.classList.add('show'); } }, 1000); }
  };
  frame.onload = () => finish(true);
  setTimeout(() => finish(true), 4500);
  frame.src = url;
}
function wvRefresh(){ if(!wvState.url) return; loadWebViewPreview(wvState.url); }
function copyWvUrl(){
  if(!wvState.url) return;
  navigator.clipboard.writeText(wvState.url).then(() => toast('✅ 链接已复制')).catch(() => prompt('手动复制链接：', wvState.url));
}
function openWvDirect(){
  if(!wvState.url) return;
  window.open(wvState.url, '_blank', 'noopener');
  hideWvTip(); toast('已在新窗口打开目标网址');
}

function renderCard(m, idx){
  const pic = m.vod_pic ? esc(m.vod_pic) : '';
  const score = m.vod_score && parseFloat(m.vod_score) > 0 ? parseFloat(m.vod_score).toFixed(1) : '';
  const year = m.vod_year || '';
  const type = (m.type_name || m.vod_class || '').split(',')[0] || '';
  const badge = m.vod_remarks ? esc(String(m.vod_remarks).slice(0, 20)) : '';
  return `<div class="card" onclick="openDetail(${idx})">
    <div class="poster">
      ${pic ? `<img loading="lazy" decoding="async" src="${pic}" alt="" onerror="this.remove()">` : ''}
      ${badge ? `<span class="badge">${badge}</span>` : ''}
      <div class="play-mask">▶</div>
    </div>
    <div class="card-title">${esc(m.vod_name)}</div>
    <div class="card-sub">${esc([year, type, score ? score + '分' : ''].filter(Boolean).join(' · '))}</div>
  </div>`;
}
function openDetail(idx){ const m = state.results[idx]; if(!m) return; openMovie(m, {}); }
function openMovie(m, opts){
  opts = opts || {};
  state.current = m;
  state.lines = parseLines(m);
  if(!state.lines.length){ toast('该资源没有可播放的线路'); }
  state.lineIdx = Math.max(0, Math.min(opts.lineIdx || 0, state.lines.length - 1));
  state.epIdx   = opts.epIdx || 0;
  $('#dTitle').textContent = m.vod_name || '未知影片';
  const poster = $('#dPoster');
  if(m.vod_pic){ poster.src = m.vod_pic; poster.style.display = ''; } else { poster.removeAttribute('src'); }
  const metaParts = [
    m.vod_score && parseFloat(m.vod_score) > 0 ? `<b>${parseFloat(m.vod_score).toFixed(1)}</b> 分` : '',
    m.vod_year || '', (m.type_name || '').split(',')[0], m.vod_area || '', m.vod_lang || '',
  ].filter(Boolean);
  const allSources = m._allSources || (m._source ? [m._source] : []);
  if(allSources.length){ metaParts.push(`<span style="color:var(--brand);font-size:13px">来自 ${allSources.map(esc).join('、')}</span>`); }
  $('#dMeta').innerHTML = metaParts.join(' &nbsp;·&nbsp; ');
  $('#dDesc').textContent = String(m.vod_content || m.vod_blurb || m.vod_remarks || '暂无简介').replace(/<[^>]+>/g, '').trim();
   updateFavBtn(); renderLines(); updateVideoTitle(); showView('view-detail');
  if(state.lines.length){
    const li = state.lineIdx;
    const eps = state.lines[li].episodes;
    const ei = Math.max(0, Math.min(state.epIdx, eps.length - 1));
    setTimeout(() => playEpisode(li, ei), 120);
  }
}
function parseLines(m){
  if(m._source === 'Anime Garden' && m._magnet){
    return [{ name: 'Magnet', episodes: [{ name: m.vod_name, url: m._magnet }] }];
  }
  const froms = String(m.vod_play_from || '').split('$$$').filter(Boolean);
  const urls  = String(m.vod_play_url  || '').split('$$$');
  const lines = [];
  froms.forEach((name, i) => {
    const raw = urls[i] || '';
    const episodes = raw.split('#').map(seg => {
      const p = seg.split('$');
      if(p.length >= 2) return { name: p[0].trim(), url: p.slice(1).join('$').trim() };
      if(p[0] && /^https?:|^magnet:/.test(p[0])) return { name: '第' + (i+1) + '集', url: p[0] };
      return null;
    }).filter(x => x && x.url);
    if(episodes.length) lines.push({ name, episodes });
  });
  if(!lines.length && m.vod_play_url && /^https?:|^magnet:/.test(m.vod_play_url)){
    lines.push({ name: '默认线路', episodes: [{ name: '正片', url: m.vod_play_url }] });
  }
  return lines;
}
function renderLines(){
  const tabs = $('#lineTabs');
  tabs.innerHTML = state.lines.map((l, i) => `
    <button class="line-tab${i === state.lineIdx ? ' active' : ''}" onclick="switchLine(${i})">
      ${esc(l.name || ('线路' + (i+1)))}
    </button>`).join('');
  const eps = state.lines[state.lineIdx]?.episodes || [];
  $('#epGrid').innerHTML = eps.map((ep, j) => `
    <button class="ep${j === state.epIdx ? ' playing' : ''}" data-ep="${j}" data-url="${esc(ep.url)}" onclick="playEpisode(${state.lineIdx}, ${j})">
      <span>${esc(ep.name)}</span>
      <span class="ep-download" title="下载本集">⬇</span>
    </button>`).join('');
}
function switchLine(i){ state.lineIdx = i; state.epIdx = 0; renderLines(); if(state.lines[i]?.episodes.length) playEpisode(i, 0); }
function playEpisode(lineIdx, epIdx){
  const line = state.lines[lineIdx]; if(!line) return;
  const ep = line.episodes[epIdx]; if(!ep) return;
  state.lineIdx = lineIdx; state.epIdx = epIdx;
  document.querySelectorAll('#epGrid .ep').forEach((el, k) => { el.classList.toggle('playing', k === epIdx); });
  document.querySelectorAll('.line-tab').forEach((el, k) => { el.classList.toggle('active', k === lineIdx); });
    updateVideoTitle(); playVideo(ep.url); recordHistory();
  $('.player-wrap').scrollIntoView({ behavior:'smooth', block:'start' });
}
function hasNextEpisode(){ const line = state.lines[state.lineIdx]; return !!(line && (state.epIdx + 1) < line.episodes.length); }
function playNextEpisode(){ if(!hasNextEpisode()){ toast('已经是最后一集了'); return; } playEpisode(state.lineIdx, state.epIdx + 1); }
function startOutroCountdown(){
  if(state.outroRunning || state.outroCancelled) return;
  if(!hasNextEpisode()) return;
  const total = Math.max(1, Math.min(600, parseInt(SETTINGS.outroSec) || 0));
  if(total <= 0) return;
  state.outroRunning = true;
  let left = total;
  updateOutroBar(left); $('#outroBar').classList.add('show');
  state.outroTimer = setInterval(() => {
    left--;
    if(left <= 0){ clearOutro(); if(SETTINGS.autoNext !== false) playNextEpisode(); }
    else{ updateOutroBar(left); }
  }, 1000);
}
function updateOutroBar(left){ const t = $('#outroText'); if(t) t.textContent = `片尾跳过中 · ${left}s 后播放下一集`; }
function cancelOutro(){ clearOutro(); state.outroCancelled = true; toast('已取消跳过片尾'); }

function playVideo(url){
  saveCurrentProgress(); clearOutro();
  state.currentUrl = ''; state.resumeAt = 0; state.resumeReason = '';
  if(state._seekTimer){ clearTimeout(state._seekTimer); state._seekTimer = null; }
  if(url && url.startsWith('magnet:')){
    const video = $('#video');
    if(hlsInstance){ hlsInstance.destroy(); hlsInstance = null; }
    video.removeAttribute('src'); video.load(); resetQualityUI();
    navigator.clipboard.writeText(url).then(() => toast('✅ 磁力链接已复制！请使用 qBittorrent / IDM 等工具下载'))
      .catch(() => prompt('手动复制磁力链接：', url));
    return;
  }
  const video = $('#video');
  if(hlsInstance){ hlsInstance.destroy(); hlsInstance = null; }
  video.removeAttribute('src'); video.load(); resetQualityUI();
  state.currentUrl = url || ''; state.outroCancelled = false; lastProgressSave = 0;
  showVideoLoading();
  const isM3u8 = /\.m3u8(\?|#|$)/i.test(url);
  if(isM3u8){
    if(window.Hls && Hls.isSupported()){
      hlsInstance = new Hls({
        maxBufferLength        : 60,
        maxMaxBufferLength     : 180,
        maxBufferSize          : 80 * 1000 * 1000,
        backBufferLength       : 30,
        manifestLoadingTimeOut : 20000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 800,
        levelLoadingTimeOut    : 20000,
        levelLoadingMaxRetry   : 4,
        levelLoadingRetryDelay : 800,
        fragLoadingTimeOut     : 30000,
        fragLoadingMaxRetry    : 6,
        fragLoadingRetryDelay  : 800,
        enableWorker          : true,
        lowLatencyMode        : false,
        startLevel            : -1,
        capLevelToPlayerSize  : true,
        abrEwmaDefaultEstimate: 800000
      });
      hlsInstance.loadSource(url); hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hlsInstance.levels || [];
        if(levels.length > 1){ state.hlsLevels = levels; state.hlsLevel = hlsInstance.currentLevel; renderQualityUI(); }
        else{ state.hlsLevels = null; hideQualityUI(); }
        if(state.resumeAt > 0) seekWithRetry(video, state.resumeAt, 0);
      });
      hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (e, data) => {
        if(state.hlsLevels){ state.hlsLevel = hlsInstance.autoLevelEnabled ? -1 : data.level; updateQualityUI(); }
      });
      hlsInstance.on(Hls.Events.ERROR, (e, data) => {
        if(data.fatal){
          console.warn('HLS error:', data);
          hideVideoLoading();
          toast('视频加载失败，可能是资源失效，请换其他线路');
        }
      });
    }else if(video.canPlayType('application/vnd.apple.mpegurl')){ video.src = url; hideQualityUI(); }
    else{ hideVideoLoading(); toast('当前浏览器不支持 HLS 播放'); return; }
  }else{ video.src = url; hideQualityUI(); }
  video.play().catch(() => {});
}
function seekWithRetry(video, t, attempt){
  if(!state.currentUrl) return;
  if(attempt >= 10) return;
  state._lastSelfSeek = Date.now();
  try{ video.currentTime = t; }catch(e){}
  if(state._seekTimer) clearTimeout(state._seekTimer);
  state._seekTimer = setTimeout(() => {
    if(!state.currentUrl || state.resumeAt !== t) return;
    if(Math.abs(video.currentTime - t) > 3) seekWithRetry(video, t, attempt + 1);
    else{
      if(state.resumeReason === 'resume') toast('⏱ 已从 ' + fmtTime(t) + ' 继续播放');
      else if(state.resumeReason === 'intro') toast('已跳过片头 ' + SETTINGS.introSec + ' 秒');
      state.resumeAt = 0; state.resumeReason = '';
    }
  }, 380);
}
function handleLoadedMetadata(){
  const video = $('#video'); const url = state.currentUrl; if(!url) return;
  const dur = isFinite(video.duration) ? video.duration : 0;
  const saved = SETTINGS.memoryPlay ? getProgress(url) : 0;
  let startAt = 0; let reason = '';
  if(saved > 5 && (!dur || saved < dur - 10)){ startAt = saved; reason = 'resume'; }
  else if(SETTINGS.skipIntro && (+SETTINGS.introSec) > 0){ startAt = +SETTINGS.introSec; reason = 'intro'; }
  if(startAt <= 0) return;
  state.resumeAt = startAt; state.resumeReason = reason;
  seekWithRetry(video, startAt, 0);
}
function handleTimeUpdate(){
  const v = $('#video'); if(!v || !state.currentUrl) return;
  const t = v.currentTime; const d = v.duration;
  if(!isFinite(d) || d <= 0) return;
  syncTimeAndProgress();
  if(Date.now() - lastProgressSave > 3000){ lastProgressSave = Date.now(); setProgress(state.currentUrl, t, d); }
  if(SETTINGS.skipOutro && (+SETTINGS.outroSec) > 0 && !state.outroCancelled && !state.outroRunning
     && d > (+SETTINGS.outroSec) + 5 && (d - t) <= (+SETTINGS.outroSec) && (d - t) > 0.3){
    startOutroCountdown();
  }
}
function handleEnded(){
  if(state.currentUrl) setProgress(state.currentUrl, 0, 0);
  clearOutro();
  if(SETTINGS.autoNext) playNextEpisode();
}
function levelName(lv){
  if(!lv) return '未知';
  if(lv.height) return lv.height + 'P';
  if(lv.bitrate) return Math.round(lv.bitrate / 1000) + 'Kbps';
  return '码率' + (lv.index ?? '');
}

function resetQualityUI(){
  state.hlsLevels = null;
  state.hlsLevel = -1;
  hideQualityUI();
}
function hideQualityUI(){
  const label = document.getElementById('vQualityLabel');
  if(label) label.style.display = 'none';
}
function renderQualityUI(){
  const label = document.getElementById('vQualityLabel');
  if(!label) return;
  const levels = state.hlsLevels;
  if(!levels || levels.length <= 1){ label.style.display = 'none'; return; }
  label.style.display = '';
  updateQualityUI();
}
function updateQualityUI(){
  const label = document.getElementById('vQualityLabel');
  const levels = state.hlsLevels;
  if(!label || !levels) return;
  if(state.hlsLevel === -1) label.textContent = '自动';
  else label.textContent = levelName(levels[state.hlsLevel]);
}
function setQuality(level){
  if(!hlsInstance) return;
  hlsInstance.currentLevel = level;
  state.hlsLevel = level;
  updateQualityUI();
  toast(level === -1 ? '清晰度：自动' : '清晰度：' + levelName(state.hlsLevels[level]));
  closeVSheet();
}

function downloadEpisode(url, event){
  if(event) event.stopPropagation();
  if(!url) return;
  if(url.startsWith('magnet:')){
    navigator.clipboard.writeText(url).then(() => toast('✅ 磁力链接已复制！请使用 qBittorrent / IDM 等工具下载'))
      .catch(() => prompt('手动复制磁力链接：', url));
    return;
  }
  if(url.includes('.mp4')){
    const a = document.createElement('a');
    a.href = url; a.download = ((state.current && state.current.vod_name) || 'video') + '.mp4';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('开始下载 MP4');
  }else if(url.includes('.m3u8')){ copyDownloadLink(url); }
  else{ window.open(url, '_blank'); }
}
function downloadCurrentEpisode(){
  const line = state.lines[state.lineIdx]; const ep = line && line.episodes[state.epIdx];
  if(!ep) return toast('请先播放一集');
  downloadEpisode(ep.url, null);
}
function copyDownloadLink(url){
  navigator.clipboard.writeText(url).then(() => toast('✅ M3U8链接已复制！请使用 IDM、N_m3u8DL 或 M3U8下载器下载'))
    .catch(() => prompt('手动复制 M3U8 链接：', url));
}
function quickSearch(kw){ $('#kw').value = kw; hideSearchDrop(); doSearch(kw); }

function renderSearchDrop(){
  const drop = $('#searchDrop'); if(!drop) return;
  const list = getSearches();
  if(!list.length){ drop.classList.remove('open'); drop.innerHTML = ''; return; }
  drop.innerHTML = `
    <div class="sd-head"><span>🕘 搜索记录</span><button type="button" data-act="clear">清空</button></div>
    ${list.map((s, i) => `<div class="sd-item" data-kw="${esc(s.kw)}">
        <span class="sd-ic">🔎</span>
        <span class="sd-txt">${esc(s.kw)}</span>
        <span class="sd-time" title="${esc(s.at ? fmtFull(s.at) : '')}">${esc(s.at ? fmtHM(s.at) : '')}</span>
        <span class="sd-del" data-del="${i}">✕</span>
      </div>`).join('')}`;
  drop.querySelectorAll('.sd-item').forEach(el => {
    el.addEventListener('mousedown', e => {
      if(e.target.closest('.sd-del')) return;
      e.preventDefault();
      const kw = el.dataset.kw;
      hideSearchDrop(); $('#kw').value = kw; doSearch(kw);
    });
  });
  drop.querySelectorAll('.sd-del').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      removeSearchAt(parseInt(el.dataset.del));
    });
  });
  const clr = drop.querySelector('[data-act="clear"]');
  if(clr) clr.addEventListener('mousedown', e => { e.preventDefault(); clearSearches(); });
  drop.classList.add('open');
}
function hideSearchDrop(){ const drop = $('#searchDrop'); if(drop) drop.classList.remove('open'); }

function openProfile(){ showView('view-profile'); renderProfile(); }
function profileBack(){
  if (history.length > 1) {
    history.back();
  } else {
    if(state.results.length) showView('view-results', false); else goHome();
  }
}
function renderProfile(){
  const logged = !!currentUser;
  const b = userBucket;
  $('#pfAvatar').innerHTML = logged ? avatarInner(userAvatar()) : '👤';
  $('#pfAvatar').title = logged ? '点击更换头像' : '登录后可自定义头像';
  $('#pfName').textContent = logged ? userName() : '游客';

  const modeText = !logged ? ''
    : (isLocalMode() || currentUser.__local)
      ? '本地账户 · 数据仅存本机'
      : (supabaseReady ? '数据已云端同步' : '云端未连接');
  $('#pfSub').textContent = logged
    ? `@${userName()} · ${modeText}`
    : '登录后收藏 / 历史 / 搜索记录会按账户分开保存';

  $('#pfBtns').innerHTML = logged
    ? `<button onclick="openAvatarDialog()">🎨 更换头像</button>
       <button onclick="generateRecoveryCode()">🔑 恢复码</button>
       <button onclick="doLogout()">退出登录</button>`
    : `<button style="background:linear-gradient(135deg,var(--brand),var(--brand2));color:#04140b;border:0" onclick="openAuth('login')">登录 / 注册</button>`;
  $('#pfFavCount').textContent    = b.favorites.length;
  $('#pfHisCount').textContent    = b.history.length;
  $('#pfSearchCount').textContent = normalizeSearches(b.searches).length;
  renderProfileBody();
  updateUserBtn();
}
function switchProfileTab(t){
  pfTab = t;
  document.querySelectorAll('.pf-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === t));
  renderProfileBody();
}
function profileEmpty(icon, title, desc){
  return `<div class="empty"><div class="big">${icon}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
}
function renderProfileBody(){
  const box = $('#pfBody'); if(!box) return;
  const b = userBucket;
  if(pfTab === 'fav'){
    if(!b.favorites.length){ box.innerHTML = profileEmpty('💔','还没有收藏任何影片','在影片详情页点「☆ 收藏」，就会出现在这里'); return; }
    box.innerHTML = `<div class="grid">${b.favorites.map((f, i) => favCardHTML(f, i)).join('')}</div>`;
    return;
  }
  if(pfTab === 'his'){
    if(!b.history.length){ box.innerHTML = profileEmpty('🕒','还没有观看记录','播放任意一集后会自动记录在这里'); return; }
    box.innerHTML = `
      <div class="pf-bar">
        <span class="pf-bar-t">共 <b>${b.history.length}</b> 条记录 · 按日期分组</span>
        <button class="mini-btn" style="flex:0 0 auto;width:auto;min-width:0;padding:8px 16px" onclick="clearHistory()">🗑 清空历史</button>
      </div>
      <div class="his-list">${groupedHistoryHTML(b.history)}</div>`;
    return;
  }
  if(pfTab === 'offline'){
    box.innerHTML = `<div class="loading"><div class="spinner"></div><span>正在读取离线缓存…</span></div>`;
    renderOfflineInProfile(box);
    return;
  }
  const searches = normalizeSearches(b.searches);
  if(!searches.length){ box.innerHTML = profileEmpty('🔍','还没有搜索记录','在顶部搜索框搜索过的关键词会记录在这里'); return; }
  box.innerHTML = `
    <div class="pf-bar">
      <span class="pf-bar-t">共 <b>${searches.length}</b> 条搜索记录 · 按日期分组</span>
      <button class="mini-btn" style="flex:0 0 auto;width:auto;min-width:0;padding:8px 16px" onclick="clearSearches()">🗑 清空</button>
    </div>
    <div>${groupedSearchHTML(searches)}</div>`;
  box.querySelectorAll('.sd-item').forEach(el => {
    el.addEventListener('click', e => { if(e.target.closest('.sd-del')) return; quickSearch(el.dataset.kw); });
  });
  box.querySelectorAll('.sd-del').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); removeSearchAt(parseInt(el.dataset.del)); });
  });
}

function groupedHistoryHTML(list){
  const groups = groupByDay(list, h => h.updatedAt);
  let html = '';
  groups.forEach((arr) => {
    const ts = arr[0].ts;
    html += dateSepHTML(ts, arr.length);
    html += arr.map(({ item, i }) => historyHTML(item, i)).join('');
  });
  return html;
}
function groupedSearchHTML(list){
  const groups = groupByDay(list, s => s.at);
  let html = '';
  groups.forEach((arr) => {
    const ts = arr[0].ts;
    html += dateSepHTML(ts, arr.length);
    html += arr.map(({ item, i }) => `
      <div class="sd-item" data-kw="${esc(item.kw)}" style="background:rgba(255,255,255,.03);border:1px solid var(--line);margin-bottom:7px;border-radius:10px;padding:11px 13px">
        <span class="sd-ic">🕘</span>
        <span class="sd-txt">${esc(item.kw)}</span>
        <span class="sd-time" title="${esc(item.at ? fmtFull(item.at) : '')}">${esc(item.at ? fmtHM(item.at) : '')}</span>
        <span class="sd-del" data-del="${i}">✕</span>
      </div>`).join('');
  });
  return html;
}

function favCardHTML(f, i){
  const pic = f.pic ? esc(f.pic) : '';
  const score = f.score && parseFloat(f.score) > 0 ? parseFloat(f.score).toFixed(1) + '分' : '';
  return `<div class="card" onclick="openFav(${i})">
    <div class="poster">
      ${pic ? `<img loading="lazy" decoding="async" src="${pic}" alt="" onerror="this.remove()">` : ''}
      ${f.remarks ? `<span class="badge">${esc(String(f.remarks).slice(0,20))}</span>` : ''}
      <div class="play-mask">▶</div>
    </div>
    <div class="card-title">${esc(f.name)}</div>
    <div class="card-sub">${esc([f.year, f.type, score].filter(Boolean).join(' · '))}</div>
  </div>`;
}
function historyHTML(h, i){
  const pic = h.pic ? esc(h.pic) : '';
  const pe = getProgressEntry(h.url);
  const prog = (pe && pe.d && pe.d > 0) ? Math.min(100, Math.round(pe.t / pe.d * 100)) : 0;
  return `<div class="his-item" onclick="openHistory(${i})">
    <div class="his-poster">${pic ? `<img loading="lazy" decoding="async" src="${pic}" alt="" onerror="this.remove()">` : ''}</div>
    <div class="his-info">
      <div class="his-name">${esc(h.name)}</div>
      <div class="his-meta">${esc(h.epName || '')}${h.epName ? ' · ' : ''}${prog > 0 ? prog + '%' : '未观看'}</div>
      <div class="his-time" title="${esc(fmtFull(h.updatedAt))}">🕒 ${esc(h.updatedAt ? fmtHM(h.updatedAt) : '')}</div>
      <div class="his-prog"><i style="width:${prog}%"></i></div>
    </div>
    <div class="his-acts">
      <button onclick="event.stopPropagation();openHistory(${i})">▶ 继续</button>
      <button class="danger" onclick="event.stopPropagation();removeHistoryAt(${i})">✕</button>
    </div>
  </div>`;
}
function openFav(i){
  const f = getFavorites()[i]; if(!f) return;
  if(!f.playUrl && !f.magnet){ toast('该收藏没有可播放信息'); return; }
  const movie = entryToMovie(f);
  openMovie(movie, {});
  if(!f.magnet){
    setTimeout(() => refreshFavoritePlaylist(movie, f), 400);
  }
}

async function refreshFavoritePlaylist(movie, f){
  if(state.current !== movie) return;

  const primaryApi = APIS.find(a => a.id === f.sourceId);
  const tryList = [];
  if(primaryApi) tryList.push(primaryApi);
  APIS.filter(a => a.enabled && a.id !== f.sourceId && a.type !== 'animegarden')
      .forEach(a => tryList.push(a));
  if(!tryList.length) return;

  let target = null;
  for(const api of tryList){
    if(state.current !== movie) return;
    try{
      const items = await fetchOne(api, f.name, 10000);
      if(!items || !items.length) continue;
      const found = items.find(it => movieKey(it) === f.key)
                 || items.find(it => String(it.vod_name || '').trim() === String(f.name || '').trim());
      if(found && found.vod_play_url){ target = found; break; }
    }catch(e){
      if(e.name === 'AbortError') return;
    }
  }

  if(!target || state.current !== movie) return;

  if(target.vod_play_url === f.playUrl &&
     (target.vod_play_from || '') === (f.playFrom || '')) return;

  const oldLineIdx = state.lineIdx;
  const oldEpIdx   = state.epIdx;
  const oldUrl     = state.lines[oldLineIdx]?.episodes[oldEpIdx]?.url;
  const oldTotal   = state.lines.reduce((s,l) => s + l.episodes.length, 0);

  const newLines = parseLines(target);
  if(!newLines.length) return;
  const newTotal = newLines.reduce((s,l) => s + l.episodes.length, 0);

  let li = Math.min(oldLineIdx, newLines.length - 1);
  let ei = 0, found = false;
  for(let a = 0; a < newLines.length && !found; a++){
    for(let b = 0; b < newLines[a].episodes.length; b++){
      if(oldUrl && newLines[a].episodes[b].url === oldUrl){ li = a; ei = b; found = true; break; }
    }
  }
  if(!found) ei = Math.min(oldEpIdx, (newLines[li]?.episodes.length || 1) - 1);

  state.lines   = newLines;
  state.lineIdx = li;
  state.epIdx   = ei;

  movie.vod_pic        = target.vod_pic        || movie.vod_pic;
  movie.vod_content    = target.vod_content    || movie.vod_content;
  movie.vod_score      = target.vod_score      || movie.vod_score;
  movie.vod_remarks    = target.vod_remarks    || movie.vod_remarks;
  movie.vod_play_from  = target.vod_play_from;
  movie.vod_play_url   = target.vod_play_url;
  if(target._sourceId) movie._sourceId = target._sourceId;
  if(target._source)   movie._source   = target._source;
  if(target._allSources && target._allSources.length) movie._allSources = target._allSources;

  const newFav = favEntryFrom(target);
  newFav.key     = f.key;
  newFav.addedAt = f.addedAt || Date.now();
  mutateBucket(b => {
    const idx = b.favorites.findIndex(x => x.key === f.key);
    if(idx >= 0) b.favorites[idx] = newFav;
  });

  renderLines();
  updateVideoTitle();
  const poster = $('#dPoster');
  if(movie.vod_pic) poster.src = movie.vod_pic;
  const metaParts = [
    movie.vod_score && parseFloat(movie.vod_score) > 0
      ? `<b>${parseFloat(movie.vod_score).toFixed(1)}</b> 分` : '',
    movie.vod_year || '', (movie.type_name || '').split(',')[0],
    movie.vod_area || '', movie.vod_lang || '',
  ].filter(Boolean);
  const allSources = movie._allSources || (movie._source ? [movie._source] : []);
  if(allSources.length){
    metaParts.push(`<span style="color:var(--brand);font-size:13px">来自 ${allSources.map(esc).join('、')}</span>`);
  }
  $('#dMeta').innerHTML = metaParts.join(' &nbsp;·&nbsp; ');
  $('#dDesc').textContent = String(movie.vod_content || movie.vod_blurb || movie.vod_remarks || '暂无简介')
    .replace(/<[^>]+>/g, '').trim();

  if(newTotal > oldTotal){
    toast('📺 已获取最新剧集，共 ' + newTotal + ' 集');
  } else if(newTotal !== oldTotal){
    toast('📺 播放列表已刷新（共 ' + newTotal + ' 集）');
  } else {
    toast('📺 播放列表已刷新');
  }
}
function openHistory(i){
  const h = getHistory()[i]; if(!h) return;
  openMovie(entryToMovie(h), { lineIdx: h.lineIdx || 0, epIdx: h.epIdx || 0 });
}

function togglePanel(){
  const p = $('#panel'), m = $('#panelMask');
  p.classList.toggle('open'); m.classList.toggle('open');
  if(p.classList.contains('open')){ renderApiList(); renderWebSourceList(); syncSettingsUI(); }
  else{ cancelApiEdit(); cancelWebEdit(); closeClearDialog(); }
}
function renderApiList(){
  const box = $('#apiList'); if(!box) return;
  if(!APIS.length){
    box.innerHTML = `<div style="padding:26px 8px;text-align:center;color:var(--muted);font-size:13px">还没有数据源，请在下方添加</div>`;
  }else{
    box.innerHTML = APIS.map((a, i) => `
      <div class="api-item${a.enabled ? ' on' : ''}${i === editingApiIdx ? ' editing' : ''}" onclick="toggleApi(${i})">
        <input type="checkbox" ${a.enabled ? 'checked' : ''} onclick="event.stopPropagation(); toggleApi(${i}, this.checked)">
        <div class="api-info">
          <div class="api-name">${esc(a.name)}</div>
          <div class="api-url" title="${esc(a.url)}">${esc(a.url)}</div>
        </div>
        <span class="edit" title="修改" onclick="event.stopPropagation(); editApi(${i})">✎</span>
        <span class="del" title="删除" onclick="event.stopPropagation(); delApi(${i})">✕</span>
      </div>`).join('');
  }
  updateApiCount();
}
function updateApiCount(){ const n = APIS.filter(a => a.enabled).length; const el = $('#apiCount'); if(el) el.textContent = n; }
function toggleApi(i, on){
  if(!APIS[i]) return;
  if(typeof on !== 'boolean') on = !APIS[i].enabled;
  APIS[i].enabled = on; saveApis();
  const row = $('#apiList')?.children[i];
  if(row){ row.classList.toggle('on', on); const cb = row.querySelector('input[type=checkbox]'); if(cb) cb.checked = on; }
  updateApiCount();
}
function selectAllApis(on){ APIS.forEach(a => a.enabled = on); saveApis(); renderApiList(); toast(on ? `已全选 ${APIS.length} 个数据源` : '已全部取消'); }
function resetDefaultApis(){
  if(!confirm('确定要恢复默认数据源吗？\n\n将丢弃你添加/修改的所有接口，并还原为内置默认列表与默认勾选状态。')) return;
  APIS = JSON.parse(JSON.stringify(DEFAULT_APIS)); saveApis(); cancelApiEdit(); renderApiList(); updateApiCount();
  toast('已恢复默认数据源');
}
function delApi(i){
  if(!APIS[i]) return;
  const name = APIS[i].name;
  APIS.splice(i, 1); saveApis();
  if(editingApiIdx === i) cancelApiEdit(); else if(editingApiIdx > i) editingApiIdx--;
  renderApiList(); toast('已删除：' + name);
}
function editApi(i){
  const a = APIS[i]; if(!a) return;
  editingApiIdx = i;
  $('#newName').value = a.name || '';
  $('#newUrl').value  = a.url  || '';
  if($('#newDetail')) $('#newDetail').value = a.detail || '';
  const form = $('#apiForm'); if(form) form.classList.add('editing');
  $('#addApiBtn').textContent = '✔ 保存修改';
  $('#cancelEditBtn').style.display = 'block';
  renderApiList();
  if(form) form.scrollIntoView({ behavior:'smooth', block:'nearest' });
  $('#newName').focus();
}
function cancelApiEdit(){
  editingApiIdx = -1;
  const n = $('#newName'), u = $('#newUrl'), d = $('#newDetail');
  if(n) n.value = ''; if(u) u.value = ''; if(d) d.value = '';
  const form = $('#apiForm'); if(form) form.classList.remove('editing');
  const btn = $('#addApiBtn'); if(btn) btn.textContent = '＋ 添加数据源';
  const cbtn = $('#cancelEditBtn'); if(cbtn) cbtn.style.display = 'none';
}
function addApi(){
  const name = $('#newName').value.trim();
  const rawUrl = $('#newUrl').value.trim();
  const rawDet = ($('#newDetail')?.value || '').trim();
  if(!name || !rawUrl) return toast('名称和地址都要填');
  const url = normalizeApiUrl(rawUrl);
  const detail = rawDet ? normalizeApiUrl(rawDet) : '';
  if(!url) return toast('接口地址无效');
  if(editingApiIdx > -1 && APIS[editingApiIdx]){
    if(APIS.some((a, idx) => idx !== editingApiIdx && a.url === url)) return toast('该数据源已存在');
    Object.assign(APIS[editingApiIdx], { name, url, detail }); saveApis(); cancelApiEdit(); renderApiList();
    toast('已保存修改：' + name); return;
  }
  if(APIS.some(a => a.url === url)) return toast('该数据源已存在');
  APIS.push({ id: CUSTOM_PREFIX + Date.now(), name, url, detail, enabled: true, type: '' });
  saveApis(); $('#newName').value = ''; $('#newUrl').value = ''; if($('#newDetail')) $('#newDetail').value = '';
  renderApiList(); toast('已添加：' + name);
}
function renderWebSourceList(){
  const box = $('#webList'); if(!box) return;
  if(!WEB_SOURCES.length){
    box.innerHTML = `<div style="padding:26px 8px;text-align:center;color:var(--muted);font-size:13px">还没有搜索源，请在下方添加</div>`;
  }else{
    box.innerHTML = WEB_SOURCES.map((s, i) => `
      <div class="api-item${s.enabled ? ' on' : ''}${i === editingWebIdx ? ' editing' : ''}" onclick="toggleWebSource(${i})">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} onclick="event.stopPropagation(); toggleWebSource(${i}, this.checked)">
        <div class="api-info">
          <div class="api-name">${s.icon || '🔍'} ${esc(s.name)}</div>
          <div class="api-url" title="${esc(s.url)}">${esc(s.url)}</div>
        </div>
        <span class="edit" title="修改" onclick="event.stopPropagation(); editWebSource(${i})">✎</span>
        <span class="del" title="删除" onclick="event.stopPropagation(); delWebSource(${i})">✕</span>
      </div>`).join('');
  }
  updateWebCount();
}
function updateWebCount(){ const n = WEB_SOURCES.filter(s => s.enabled).length; const el = $('#webCount'); if(el) el.textContent = n; }
function toggleWebSource(i, on){
  if(!WEB_SOURCES[i]) return;
  if(typeof on !== 'boolean') on = !WEB_SOURCES[i].enabled;
  WEB_SOURCES[i].enabled = on; saveWebSources();
  const row = $('#webList')?.children[i];
  if(row){ row.classList.toggle('on', on); const cb = row.querySelector('input[type=checkbox]'); if(cb) cb.checked = on; }
  updateWebCount();
}
function selectAllWebSources(on){ WEB_SOURCES.forEach(s => s.enabled = on); saveWebSources(); renderWebSourceList(); toast(on ? `已全选 ${WEB_SOURCES.length} 个搜索源` : '已全部取消'); }
function resetWebSources(){
  WEB_SOURCES = JSON.parse(JSON.stringify(DEFAULT_WEB_SOURCES)); saveWebSources(); cancelWebEdit(); renderWebSourceList();
  toast('已恢复默认搜索源');
}
function delWebSource(i){
  if(!WEB_SOURCES[i]) return;
  const name = WEB_SOURCES[i].name;
  WEB_SOURCES.splice(i, 1); saveWebSources();
  if(editingWebIdx === i) cancelWebEdit(); else if(editingWebIdx > i) editingWebIdx--;
  renderWebSourceList(); toast('已删除：' + name);
}
function editWebSource(i){
  const s = WEB_SOURCES[i]; if(!s) return;
  editingWebIdx = i;
  $('#newWebName').value = s.name || '';
  $('#newWebUrl').value  = s.url  || '';
  const form = $('#webForm'); if(form) form.classList.add('editing');
  $('#addWebBtn').textContent = '✔ 保存修改';
  $('#cancelWebEditBtn').style.display = 'block';
  renderWebSourceList();
  if(form) form.scrollIntoView({ behavior:'smooth', block:'nearest' });
  $('#newWebName').focus();
}
function cancelWebEdit(){
  editingWebIdx = -1;
  const n = $('#newWebName'), u = $('#newWebUrl');
  if(n) n.value = ''; if(u) u.value = '';
  const form = $('#webForm'); if(form) form.classList.remove('editing');
  const btn = $('#addWebBtn'); if(btn) btn.textContent = '＋ 添加搜索源';
  const cbtn = $('#cancelWebEditBtn'); if(cbtn) cbtn.style.display = 'none';
}
function addWebSource(){
  const name = $('#newWebName').value.trim();
  let url = $('#newWebUrl').value.trim();
  if(!name || !url) return toast('名称和地址模板都要填');
  if(!url.includes('{kw}')) return toast('模板必须包含 {kw} 占位符');
  if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if(editingWebIdx > -1 && WEB_SOURCES[editingWebIdx]){
    if(WEB_SOURCES.some((s, idx) => idx !== editingWebIdx && s.url === url)) return toast('该搜索源已存在');
    WEB_SOURCES[editingWebIdx].name = name;
    WEB_SOURCES[editingWebIdx].url  = url;
    saveWebSources(); cancelWebEdit(); renderWebSourceList();
    toast('已保存修改：' + name); return;
  }
  if(WEB_SOURCES.some(s => s.url === url)) return toast('该搜索源已存在');
  WEB_SOURCES.push({ id:'w_' + Date.now(), name, icon:'⭐', url, enabled:true, custom:true });
  saveWebSources(); $('#newWebName').value = ''; $('#newWebUrl').value = '';
  renderWebSourceList(); toast('已添加搜索源：' + name);
}

let gestureHudTimer = null;

function showGestureHud(html, autoHideMs){
  const hud = document.getElementById('gestureHud');
  if(!hud) return;
  hud.innerHTML = html;
  hud.classList.add('show');
  clearTimeout(gestureHudTimer);
  if(autoHideMs){
    gestureHudTimer = setTimeout(() => { hud.classList.remove('show'); }, autoHideMs);
  }
}
function hideGestureHudSoon(ms){
  clearTimeout(gestureHudTimer);
  gestureHudTimer = setTimeout(() => {
    const hud = document.getElementById('gestureHud');
    if(hud) hud.classList.remove('show');
  }, ms || 500);
}

function initMobileGestures(){
  const v = document.getElementById('video');
  if(!v) return;
  if(v.__gesturesBound) return;
  v.__gesturesBound = true;

  v.style.touchAction = 'none';
  v.style.webkitUserSelect = 'none';
  v.style.userSelect = 'none';
  v.style.webkitTouchCallout = 'none';

  let gs = {
    active:false, mode:'', sx:0, sy:0, st:0, half:'left',
    startTime:0, startVol:1, startBright:1, startDur:0,
    target:0, lastTap:0, tapTimer:null
  };

  function onStart(e){
    if(e.touches.length !== 1){ gs.active = false; return; }
    const t = e.touches[0], rect = v.getBoundingClientRect();
    const ty = t.clientY - rect.top;
    if(ty > rect.height * 0.78){ gs.active = false; return; }

    gs.active = true; gs.mode = '';
    gs.sx = t.clientX; gs.sy = t.clientY; gs.st = Date.now();
    gs.startTime = v.currentTime || 0;
    gs.startVol = (typeof v.volume === 'number') ? v.volume : 1;
    gs.startBright = parseFloat(v.dataset.__bright || '1') || 1;
    gs.startDur = isFinite(v.duration) ? v.duration : 0;
    gs.target = gs.startTime;
    gs.half = (t.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
  }
  function onMove(e){
    if(!gs.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - gs.sx, dy = t.clientY - gs.sy;

    if(!gs.mode){
      if(Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      gs.mode = Math.abs(dx) > Math.abs(dy) ? 'seek' : 'vert';
    }
    if(e.cancelable) e.preventDefault();

    const rect = v.getBoundingClientRect();

    if(gs.mode === 'seek'){
      if(gs.startDur <= 0){
        showGestureHud('<span class="gh-ic">⏳</span><span class="gh-txt">视频未就绪</span>');
        return;
      }
      const span = Math.min(gs.startDur, 600);
      let target = gs.startTime + (dx / Math.max(1, rect.width)) * span;
      target = Math.max(0, Math.min(gs.startDur, target));
      gs.target = target;

      const dir = target >= gs.startTime ? '⏩' : '⏪';
      const pct = Math.round(target / gs.startDur * 100);
      showGestureHud(
        '<span class="gh-ic">' + dir + '</span>' +
        '<span class="gh-txt">进度</span>' +
        '<span class="gh-val">' + fmtTime(target) + ' / ' + fmtTime(gs.startDur) + '</span>' +
        '<span class="gh-pct">' + pct + '%</span>'
      );
    }else{
      const ratio = -(dy / Math.max(1, rect.height));
      if(gs.half === 'left'){
        let b = gs.startBright + ratio * 1.5;
        b = Math.max(0.15, Math.min(2, b));
        v.dataset.__bright = String(b);
        v.style.filter = Math.abs(b - 1) < 0.01 ? '' : 'brightness(' + b.toFixed(2) + ')';
        showGestureHud(
          '<span class="gh-ic">☀</span>' +
          '<span class="gh-txt">亮度</span>' +
          '<span class="gh-val">' + Math.round(b * 100) + '%</span>'
        );
      }else{
        let vol = gs.startVol + ratio * 1.4;
        vol = Math.max(0, Math.min(1, vol));
        try{ v.volume = vol; v.muted = (vol <= 0.001); }catch(err){}
        showGestureHud(
          '<span class="gh-ic">' + (vol <= 0.001 ? '🔇' : '🔊') + '</span>' +
          '<span class="gh-txt">音量</span>' +
          '<span class="gh-val">' + Math.round(vol * 100) + '%</span>'
        );
      }
    }
  }

  function onEnd(e){
    if(!gs.active) return;
    gs.active = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - gs.sx, dy = t.clientY - gs.sy;
    const dist = Math.sqrt(dx*dx + dy*dy), dt = Date.now() - gs.st;
    const mode = gs.mode; gs.mode = '';

    if(dist > 14 || dt > 320){
      clearTimeout(gs.tapTimer);
      gs.tapTimer = null;
      gs.lastTap = 0;
    }

    if(mode === 'seek'){
      if(gs.startDur > 0 && Math.abs(gs.target - gs.startTime) > 0.5){
        try{ v.currentTime = gs.target; }catch(err){}
        state.resumeAt = 0;
      }
      hideGestureHudSoon(450); return;
    }
    if(mode === 'vert'){
      hideGestureHudSoon(650); return;
    }

    if(dist < 14 && dt < 320){
      const now = Date.now();
      if(now - gs.lastTap < 320){
        clearTimeout(gs.tapTimer);
        gs.tapTimer = null;
        gs.lastTap = 0;
        try{
          if(v.paused){
            v.play().catch(()=>{});
            showGestureHud('<span class="gh-ic">▶</span><span class="gh-val">播放中</span>', 700);
          }else{
            v.pause();
            showGestureHud('<span class="gh-ic">❚❚</span><span class="gh-val">已暂停</span>', 700);
          }
        }catch(err){}
        _suppressVideoClick = true;
        setTimeout(() => { _suppressVideoClick = false; }, 350);
      }else{
        gs.lastTap = now;
        clearTimeout(gs.tapTimer);
        gs.tapTimer = setTimeout(() => { gs.tapTimer = null; gs.lastTap = 0; }, 320);
      }
    }
  }

  v.addEventListener('touchstart', onStart, { passive: true });
  v.addEventListener('touchmove',  onMove,  { passive: false });
  v.addEventListener('touchend',   onEnd,   { passive: false });
  v.addEventListener('touchcancel', () => { gs.active = false; gs.mode = ''; });
}
const IS_TOUCH = (() => {
  try{ return ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches; }
  catch(e){ return 'ontouchstart' in window; }
})();

$('#kw').addEventListener('keydown', e => { if(e.key === 'Enter'){ hideSearchDrop(); doSearch(); } });
$('#kw').addEventListener('focus', renderSearchDrop);
$('#kw').addEventListener('input', renderSearchDrop);
$('#kw').addEventListener('blur', () => setTimeout(hideSearchDrop, 200));

const _doSearch = doSearch;
window.doSearch = async function(kw){
  const btn = $('#btnSearch');
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '搜索中…';
  try{ await _doSearch(kw); }
  finally{ btn.disabled = false; btn.textContent = oldText; }
};

document.addEventListener('click', function(e){
  const dl = e.target.closest('.ep-download');
  if(dl){
    e.stopPropagation();
    const epBtn = dl.closest('.ep');
    const url = epBtn && epBtn.getAttribute('data-url');
    if(url) downloadEpisode(url, null);
  }
  if(!e.target.closest('.search-wrap')) hideSearchDrop();
});

document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    if($('#rcvCodeDialog')?.classList.contains('open')){ closeRecoveryCodeDialog(); return; }
    if($('#sqlDialog')?.classList.contains('open')){ closeSqlDialog(); return; }
    if($('#authDialog')?.classList.contains('open')){ closeAuth(); return; }
    if($('#avatarDialog')?.classList.contains('open')){ closeAvatarDialog(); return; }
    if($('#clearDialog')?.classList.contains('open')){ closeClearDialog(); return; }
    if($('#webview')?.classList.contains('open')){ closeWebView(); return; }
    hideSearchDrop();
  }
});

(function bindVideoEvents(){
  const v = document.getElementById('video'); if(!v) return;
  v.addEventListener('loadedmetadata', handleLoadedMetadata);
  v.addEventListener('timeupdate', handleTimeUpdate);
  v.addEventListener('ended', handleEnded);
  v.addEventListener('pause', saveCurrentProgress);
  v.addEventListener('seeking', () => { if(Date.now() - (state._lastSelfSeek || 0) > 900){ state.resumeAt = 0; } });
})();
document.addEventListener('keydown', function(e){
  if(!document.getElementById('view-detail')?.classList.contains('active')) return;
  const v = document.getElementById('video');
  if(!v || !v.src) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  switch(e.key){
    case ' ':
    case 'k':
    case 'K':
      e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':
      e.preventDefault();
      try{ v.currentTime = Math.max(0, v.currentTime - 5); }catch(err){}
      showGestureHud('<span class="gh-ic">⏪</span><span class="gh-txt">后退</span><span class="gh-val">5s</span>', 700);
      break;
    case 'ArrowRight':
      e.preventDefault();
      try{ v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); }catch(err){}
      showGestureHud('<span class="gh-ic">⏩</span><span class="gh-txt">快进</span><span class="gh-val">5s</span>', 700);
      break;
    case 'ArrowUp':
      e.preventDefault();
      try{ v.volume = Math.min(1, v.volume + 0.1); v.muted = false; }catch(err){}
      showGestureHud('<span class="gh-ic">🔊</span><span class="gh-txt">音量</span><span class="gh-val">' + Math.round(v.volume*100) + '%</span>', 700);
      break;
    case 'ArrowDown':
      e.preventDefault();
      try{ v.volume = Math.max(0, v.volume - 0.1); }catch(err){}
      showGestureHud('<span class="gh-ic">🔉</span><span class="gh-txt">音量</span><span class="gh-val">' + Math.round(v.volume*100) + '%</span>', 700);
      break;
    case 'f':
    case 'F':
      e.preventDefault(); toggleFullscreen(); break;
    case 'm':
    case 'M':
      e.preventDefault();
      v.muted = !v.muted;
      showGestureHud('<span class="gh-ic">' + (v.muted ? '🔇' : '🔊') + '</span><span class="gh-val">' + (v.muted ? '静音' : '取消静音') + '</span>', 700);
      break;
    case 'n':
    case 'N':
      e.preventDefault(); playNextEpisode(); break;
    case 'Escape':
      if(isFsActive()){ e.preventDefault(); exitAnyFs(); }
      break;
  }
});
document.addEventListener('visibilitychange', () => {
  if(document.hidden && $('#view-detail').classList.contains('active')){
    const v = $('#video'); if(v && !v.paused){ try{ v.pause(); }catch(e){} }
    saveCurrentProgress();
  }
});
window.addEventListener('pagehide', stopVideo);
window.addEventListener('beforeunload', stopVideo);

document.addEventListener('keydown', e => {
  if(e.key !== 'Enter') return;
  if(!$('#authDialog')?.classList.contains('open')) return;
  if(authMode === 'recover') submitRecover(); else submitAuth();
});

(async function init(){
  if (!history.state) {
    history.replaceState({ view: 'view-home' }, '', '#view-home');
  }
  applyBackground();
  applyAutoStart();
  applyCloseAction();
  bindSettingsEvents();
  syncSettingsUI();
  applyDataMode();
  renderApiList();
  renderWebSourceList();
  updateUserBtn();
  updateAuthModeUI();
  initMobileGestures();
  initVideoControls();
  initCustomBg();

  try{
    await Promise.race([
      window.__libReady || Promise.resolve(),
      new Promise(r => setTimeout(r, 8000))
    ]);
  }catch(e){}
  initSupabaseClient();

  if(!supabaseReady && window.__libReady && typeof window.__libReady.then === 'function'){
    window.__libReady.then(() => {
      initSupabaseClient();
      if(supabaseReady && !currentUser && !isLocalMode()){
        restoreSession().then(updateUserBtn);
      }
    }).catch(()=>{});
  }

  const pref = loadAuthModePref();
  setAuthMode(pref === 'local' ? 'local' : 'cloud');
  console.log('[澪鸢] 认证模式:', AUTH_MODE);

  await restoreSession();
  updateAuthModeUI();
  updateUserBtn();
  if(currentUser && $('#view-profile')?.classList.contains('active')){
    renderProfile();
  }

  if(supabaseReady && !isLocalMode()){
    pingSupabase(6000).then(ok => {
      if(ok){
        console.log('[澪鸢] 云端连接正常');
      }else{
        console.warn('[澪鸢] 云端探测未通过（网络/代理/CORS 均可能），已保留登录态，15 秒后自动重试');
        setTimeout(() => {
          pingSupabase(6000).then(ok2 => {
            if(ok2) console.log('[澪鸢] 云端重试连接成功');
          });
        }, 15000);
      }
    });
  }
})();