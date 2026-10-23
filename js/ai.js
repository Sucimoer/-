/* =========================================
 *  澪鸢 AI 助手逻辑 (全能指令管家版)
 * ========================================= */
(function () {
  'use strict';

  const fab = document.getElementById('aiFab');
  const panel = document.getElementById('aiPanel');
  const closeBtn = document.getElementById('aiCloseBtn');
  const cfgBtn = document.getElementById('aiCfgBtn');
  const cfg = document.getElementById('aiCfg');
  const cfgClose = document.getElementById('aiCfgClose');
  const msgs = document.getElementById('aiMsgs');
  const chips = document.getElementById('aiChips');
  const input = document.getElementById('aiInput');
  const sendBtn = document.getElementById('aiSend');
  const dot = document.getElementById('aiFabDot');
  const headSub = document.getElementById('aiHeadSub');

  let history = [];
  let currentAbortController = null;
  let currentRequestSeq = 0;
  let activePlayTimer = null;

  /* ═══════════ 云端大模型配置持久化（本地 + 云端）═══════════ */
  const LLM_CFG_KEY    = 'lingyuan_ai_llm_cfg_v1';
  const LLM_PRESET_KEY = 'lingyuan_ai_llm_presets_v1';

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function newPresetId() {
    return 'p_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  const _savedCfg = readJson(LLM_CFG_KEY, {});
  let llmEnabled = !!_savedCfg.enabled;
  let llmConfig = {
    url:   typeof _savedCfg.url   === 'string' ? _savedCfg.url   : '',
    key:   typeof _savedCfg.key   === 'string' ? _savedCfg.key   : '',
    model: typeof _savedCfg.model === 'string' ? _savedCfg.model : ''
  };

  let llmPresets = readJson(LLM_PRESET_KEY, []);
  if (!Array.isArray(llmPresets)) llmPresets = [];
  llmPresets = llmPresets.filter(p => p && typeof p.url === 'string' && p.url);

  (function normalizePresets() {
    let dirty = false;
    llmPresets.forEach(p => {
      if (!p.id) { p.id = newPresetId(); dirty = true; }
      if (typeof p.enabled !== 'boolean') { p.enabled = true; dirty = true; }
    });
    if (dirty) writeJson(LLM_PRESET_KEY, llmPresets);
  })();

  let editingPresetId = null;
  let lastSyncedUserId = null;

  const QUICK_CHIPS = [
    '播放游戏人生第四集',
    '推荐类似游戏人生的动漫',
    '快进15秒',
    '1.5倍速',
    '音量调到60'
  ];

  function renderChips() {
    chips.innerHTML = QUICK_CHIPS.map(t =>
      `<button class="ai-chip" data-chip="${t}">${t}</button>`
    ).join('');
    
    chips.querySelectorAll('.ai-chip').forEach(el => {
      el.addEventListener('click', () => sendText(el.dataset.chip));
    });
  }

  function addMsg(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.textContent = text;
    const time = document.createElement('div');
    time.className = 'ai-msg-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    wrap.appendChild(bubble);
    wrap.appendChild(time);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    history.push({ role: role === 'user' ? 'user' : 'bot', text, time: Date.now() });
  }

  function addBot(text) {
    addMsg('bot', text);
  }

  function presetKeyOf(p) {
    return String(p.url || '').trim() + '::' + String(p.model || '').trim();
  }
  function shortHost(u) {
    try { return new URL(u).host; } catch (e) { return String(u).slice(0, 30); }
  }
  function findPreset(id) { return llmPresets.find(p => p.id === id) || null; }

  function persistLlmCfg() {
    writeJson(LLM_CFG_KEY, {
      enabled: llmEnabled,
      url: llmConfig.url,
      key: llmConfig.key,
      model: llmConfig.model
    });
  }
  function persistLlmPresets() {
    writeJson(LLM_PRESET_KEY, llmPresets);
  }

  function updateHeadSub() {
    if (!headSub) return;
    if (!llmEnabled) {
      headSub.textContent = '本地智能引擎 · 无需联网';
      return;
    }
    const n = llmPresets.filter(p => p.enabled && p.url && p.model).length;
    if (n > 1)       headSub.textContent = '多模型并行 · ' + n + ' 个';
    else if (n === 1) headSub.textContent = '云端大模型已启用';
    else             headSub.textContent = '云端已开（未勾选模型）';
  }

  function upsertPreset(cfg) {
    if (!cfg.url || !cfg.model) return false;

    if (editingPresetId) {
      const p = findPreset(editingPresetId);
      if (p) {
        p.url = cfg.url; p.key = cfg.key || ''; p.model = cfg.model;
        persistLlmPresets();
        return true;
      }
    }

    const k = presetKeyOf(cfg);
    const same = llmPresets.find(p => presetKeyOf(p) === k);
    if (same) {
      same.key = cfg.key || '';
      same.enabled = true;
      persistLlmPresets();
      return true;
    }

    llmPresets.unshift({
      id: newPresetId(),
      url: cfg.url,
      key: cfg.key || '',
      model: cfg.model,
      enabled: true,
      savedAt: Date.now()
    });
    if (llmPresets.length > 20) llmPresets.length = 20;
    persistLlmPresets();
    return true;
  }

  function renderSavedModels() {
    const box = document.getElementById('aiSavedModels');
    if (!box) return;

    if (!llmPresets.length) {
      box.innerHTML = '<div class="ai-saved-empty">还没有保存的模型配置<br>填好上方三项后点「保存设置」，会自动记录到这里</div>';
      return;
    }

    const enabledCount = llmPresets.filter(p => p.enabled && p.url && p.model).length;
    const curKey = llmConfig.url && llmConfig.model ? presetKeyOf(llmConfig) : '';

    box.innerHTML =
      '<div class="ai-saved-title">' +
        '<span>📚 已保存的模型配置（' + llmPresets.length + '）</span>' +
        (enabledCount > 1 ? '<span class="ai-multi-badge">并行 ×' + enabledCount + '</span>' : '') +
        '<span class="ai-saved-tools">' +
          '<button type="button" data-act="all-on">全选</button>' +
          '<button type="button" data-act="all-off">全不选</button>' +
        '</span>' +
      '</div>' +
      llmPresets.map(p => {
        const isCurrent = curKey && presetKeyOf(p) === curKey && editingPresetId === p.id;
        return '<div class="ai-saved-item' +
          (p.enabled ? ' on' : '') + (isCurrent ? ' current' : '') + '">' +
          '<input type="checkbox" class="ai-saved-chk" ' + (p.enabled ? 'checked' : '') +
            ' data-act="toggle" data-id="' + escapeHtml(p.id) + '" title="勾选后参与并行调用">' +
          '<div class="ai-saved-main" data-act="fill" data-id="' + escapeHtml(p.id) + '" title="点击填入表单以修改">' +
            '<div class="ai-saved-name">' + escapeHtml(p.model) + '</div>' +
            '<div class="ai-saved-sub" title="' + escapeHtml(p.url) + '">' +
              escapeHtml(shortHost(p.url)) + ' · ' + (p.key ? '已存 Key' : '⚠ 无 Key') +
            '</div>' +
          '</div>' +
          '<button class="ai-saved-btn" type="button" data-act="del" data-id="' + escapeHtml(p.id) + '" title="删除">✕</button>' +
        '</div>';
      }).join('');
  }

  function fillFormFromPreset(id) {
    const p = findPreset(id);
    if (!p) return;
    editingPresetId = id;
    llmConfig.url   = p.url;
    llmConfig.key   = p.key || '';
    llmConfig.model = p.model;
    persistLlmCfg();
    const urlEl   = document.getElementById('aiLlmUrl');
    const keyEl   = document.getElementById('aiLlmKey');
    const modelEl = document.getElementById('aiLlmModel');
    if (urlEl)   urlEl.value = p.url;
    if (keyEl)   keyEl.value = p.key || '';
    if (modelEl) modelEl.value = p.model;
    renderSavedModels();
    if (urlEl) { urlEl.focus(); urlEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    addBot('✎ 已填入表单：' + p.model + '\n修改后点「保存设置」会更新这条记录（不会新增）。');
  }

  function togglePresetEnabled(id, on) {
    const p = findPreset(id);
    if (!p) return;
    p.enabled = (typeof on === 'boolean') ? on : !p.enabled;
    persistLlmPresets();
    renderSavedModels();
    updateHeadSub();
    syncAiConfigToCloud(true);
  }

  function selectAllPresets(on) {
    llmPresets.forEach(p => p.enabled = on);
    persistLlmPresets();
    renderSavedModels();
    updateHeadSub();
    syncAiConfigToCloud(true);
    addBot(on ? '已勾选全部 ' + llmPresets.length + ' 个模型（下次提问将并行调用）'
              : '已取消全部勾选');
  }

  function deletePresetById(id) {
    const idx = llmPresets.findIndex(p => p.id === id);
    if (idx < 0) return;
    const name = llmPresets[idx].model;
    llmPresets.splice(idx, 1);
    if (editingPresetId === id) editingPresetId = null;
    persistLlmPresets();
    renderSavedModels();
    updateHeadSub();
    syncAiConfigToCloud(true);
    addBot('已移除模型配置：' + name);
  }

  (function bindSavedModels() {
    const box = document.getElementById('aiSavedModels');
    if (!box || box.__bound) return;
    box.__bound = true;
    box.addEventListener('click', function (e) {
      const el = e.target.closest('[data-act]');
      if (!el || !box.contains(el)) return;
      const act = el.dataset.act;
      const id  = el.dataset.id;

      if (act === 'all-on')  { selectAllPresets(true);  return; }
      if (act === 'all-off') { selectAllPresets(false); return; }

      if (act === 'toggle')  { togglePresetEnabled(id, el.checked); return; }
      if (act === 'fill')    { fillFormFromPreset(id); return; }
      if (act === 'del')     { deletePresetById(id); return; }
    });
  })();

  /* ═══════════ 云端同步 ═══════════ */
  function canUseCloud() {
    try {
      if (typeof currentUser === 'undefined' || !currentUser) return false;
      if (typeof isLocalMode === 'function' && isLocalMode()) return false;
      if (currentUser.__local) return false;
      if (typeof supabaseReady !== 'undefined' && !supabaseReady) return false;
      if (typeof sb === 'undefined' || !sb) return false;
      return true;
    } catch (e) { return false; }
  }

  function updateSyncHint(text, kind) {
    const el = document.getElementById('aiSyncHint');
    if (!el) return;
    if (!text) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = text;
    el.className = 'ai-sync-hint' + (kind ? ' ' + kind : '');
  }

  async function syncAiConfigToCloud(silent) {
    if (!canUseCloud()) return false;
    try {
      const payload = {
        enabled: llmEnabled,
        url:     llmConfig.url,
        key:     llmConfig.key,
        model:   llmConfig.model,
        presets: llmPresets.map(p => ({
          id: p.id,
          url: p.url,
          key: p.key || '',
          model: p.model,
          enabled: p.enabled !== false,
          savedAt: p.savedAt || Date.now()
        })),
        updated_at: new Date().toISOString()
      };
      const { data, error } = await sb.from('user_data')
        .update({ ai_config: payload })
        .eq('user_id', currentUser.id)
        .select('user_id');

      if (error) {
        if (/column.*does not exist|ai_config/i.test(error.message || '')) {
          if (!silent) {
            addBot('⚠️ 云端表缺少 ai_config 字段，配置仅保存在本机。\n请在 Supabase SQL Editor 执行：\nALTER TABLE public.user_data ADD COLUMN IF NOT EXISTS ai_config jsonb;');
          }
          return false;
        }
        if (!silent) addBot('⚠️ 云端同步失败：' + (error.message || '未知错误') + '（配置仍在本地）');
        return false;
      }
      if (!data || !data.length) {
        const { error: insErr } = await sb.from('user_data')
          .insert({ user_id: currentUser.id, ai_config: payload });
        if (insErr) {
          if (!silent) addBot('⚠️ 云端写入失败：' + insErr.message);
          return false;
        }
      }
      lastSyncedUserId = currentUser.id;
      return true;
    } catch (e) {
      console.warn('[澪鸢 AI] 云端同步异常:', e);
      if (!silent) addBot('⚠️ 云端同步异常：' + (e.message || '未知'));
      return false;
    }
  }

  async function loadAiConfigFromCloud(silent) {
    if (!canUseCloud()) return false;
    try {
      const { data, error } = await sb.from('user_data')
        .select('ai_config')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (error) {
        if (!silent) console.warn('[澪鸢 AI] 读取云端配置失败:', error);
        return false;
      }
      if (!data || !data.ai_config) {
        if ((llmConfig.url && llmConfig.model) || llmPresets.length) {
          syncAiConfigToCloud(true);
        }
        return false;
      }

      const c = data.ai_config;
      if (typeof c.enabled === 'boolean') llmEnabled = c.enabled;
      if (typeof c.url === 'string')     llmConfig.url   = c.url;
      if (typeof c.key === 'string')     llmConfig.key   = c.key;
      if (typeof c.model === 'string')   llmConfig.model = c.model;

      if (Array.isArray(c.presets)) {
        const merged = [];
        const seen = new Set();
        c.presets.forEach(p => {
          if (!p || !p.url) return;
          const k = presetKeyOf(p);
          if (seen.has(k)) return;
          seen.add(k);
          merged.push({
            id: p.id || newPresetId(),
            url: p.url,
            key: p.key || '',
            model: p.model || '',
            enabled: p.enabled !== false,
            savedAt: p.savedAt || Date.now()
          });
        });
        llmPresets.forEach(p => {
          const k = presetKeyOf(p);
          if (!seen.has(k)) { seen.add(k); merged.push(p); }
        });
        llmPresets = merged.slice(0, 20);
      }

      persistLlmCfg();
      persistLlmPresets();
      lastSyncedUserId = currentUser.id;

      const onEl    = document.getElementById('aiLlmOn');
      const urlEl   = document.getElementById('aiLlmUrl');
      const keyEl   = document.getElementById('aiLlmKey');
      const modelEl = document.getElementById('aiLlmModel');
      const fieldsEl = document.getElementById('aiLlmFields');
      if (onEl)     onEl.checked = llmEnabled;
      if (urlEl)    urlEl.value = llmConfig.url;
      if (keyEl)    keyEl.value = llmConfig.key;
      if (modelEl)  modelEl.value = llmConfig.model;
      if (fieldsEl) fieldsEl.style.display = llmEnabled ? 'block' : 'none';
      updateHeadSub();
      renderSavedModels();

      if (!silent) {
        const n = llmPresets.filter(p => p.enabled).length;
        addBot('☁️ 已从云端加载 AI 配置：共 ' + llmPresets.length + ' 条记录' +
               (n ? '，其中 ' + n + ' 个已勾选启用' : ''));
      }
      return true;
    } catch (e) {
      console.warn('[澪鸢 AI] 云端读取异常:', e);
      return false;
    }
  }

  async function ensureCloudInSync() {
    if (!canUseCloud()) {
      updateSyncHint('当前未登录或为本地账户，模型配置仅保存在本机', 'warn');
      lastSyncedUserId = null;
      return;
    }
    if (lastSyncedUserId !== currentUser.id) {
      updateSyncHint('正在从云端账户加载配置…', '');
      const ok = await loadAiConfigFromCloud(true);
      updateSyncHint(
        ok ? '已登录「' + (currentUser.email || currentUser.id) + '」，配置已同步云端'
           : '已登录，但云端暂无 AI 配置（保存后会自动创建）',
        ok ? 'ok' : ''
      );
    } else {
      updateSyncHint('已登录，配置已同步云端', 'ok');
    }
  }


  function cleanSearchKeyword(kw) {
    if (!kw) return '';
    return kw
      .replace(/类似|类似于|像|差不多的|推荐|好看的|关于|一部|有什么|来点|想看/g, '')
      .replace(/的(动漫|电影|电视剧|作品|资源|片子|剧)/g, '')
      .replace(/《|》|「|」|\[|\]|“|”|\(|\)/g, '')
      .replace(/第[一二三四五六七八九十百千万\d]+[集话期]/g, '') 
      .replace(/[\d]+集/g, '').replace(/[\d]+话/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function aiAutoPlay(keyword, episode) {
    if (typeof quickSearch !== 'function') return;
    if (activePlayTimer) clearInterval(activePlayTimer);
    
    addBot('正在为你搜索《' + keyword + '》' + (episode ? '，并准备播放第 ' + episode + ' 集…' : '…'));
    quickSearch(keyword);
    
    let attempts = 0;
    activePlayTimer = setInterval(() => {
      attempts++;
      if (typeof state !== 'undefined' && state.results && state.results.length > 0) {
        clearInterval(activePlayTimer);
        
        const firstMovie = state.results[0];
        const lines = typeof parseLines === 'function' ? parseLines(firstMovie) : [];
        let targetLine = 0, targetEp = 0;
        
        if (episode && lines.length > 0) {
          let epNum = parseInt(episode);
          if (isNaN(epNum)) {
            const numMap = {'一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10};
            for (let k in numMap) {
              if (String(episode).includes(k)) { epNum = numMap[k]; break; }
            }
          }
          
          let found = false;
          if (epNum && !isNaN(epNum)) {
            if (lines[0] && lines[0].episodes[epNum - 1]) {
              targetLine = 0; targetEp = epNum - 1; found = true;
            } else {
              for (let l = 0; l < lines.length; l++) {
                for (let e = 0; e < lines[l].episodes.length; e++) {
                  const name = lines[l].episodes[e].name;
                  if (name.includes(String(epNum)) || name.includes('0' + epNum) || name.includes(`第${epNum}集`)) {
                    targetLine = l; targetEp = e; found = true; break;
                  }
                }
                if (found) break;
              }
            }
          }
          if (!found) addBot('⚠️ 未精确找到第 ' + episode + ' 集，默认从第一集开始播放。');
        }
        
        if (typeof openMovie === 'function') {
          openMovie(firstMovie, { lineIdx: targetLine, epIdx: targetEp });
          addBot('✅ 已为你打开《' + firstMovie.vod_name + '》并开始播放。');
        }
      } else if (attempts > 50) {
        clearInterval(activePlayTimer);
        addBot('❌ 搜索超时或未找到相关资源，请检查网络或数据源是否正常。');
      }
    }, 200);
  }

  const SIMILAR_MAP = {
    '游戏人生': ['Re:从零开始的异世界生活', 'Overlord', '刀剑神域'],
    '葬送的芙莉莲': ['无职转生', '关于我转生变成史莱姆这档事', '迷宫饭'],
    '进击的巨人': ['东京喰种', '寄生兽', '甲铁城的卡巴内瑞'],
    '鬼灭之刃': ['咒术回战', '地狱乐', '电锯人'],
    '恐怖': ['咒怨', '午夜凶铃', '招魂'],
    '喜剧': ['夏洛特烦恼', '西虹市首富', '让子弹飞'],
    '科幻': ['星际穿越', '盗梦空间', '流浪地球']
  };

  function localRespond(text) {
    const t = text.trim();

    if (/^(帮助|怎么用|能做什么|help|\?|？)/i.test(t)) {
      return {
        type: 'text',
        text: '我支持全自动执行以下指令：\n▶ 播放：“播放游戏人生第4集”\n⏩ 快进：“快进15秒” / “后退1分钟”\n🔊 音量：“音量调到60” / “静音”\n⚡ 倍速：“1.5倍速” / “正常速度”\n⛶ 屏幕：“全屏” / “退出全屏”\n📺 集数：“下一集” / “上一集”'
      };
    }

    const playMatch = t.match(/(?:播放|看|打开)\s*《?([^》]+?)》?(?:\s*第([一二三四五六七八九十百千万\d]+)季)?(?:\s*第([一二三四五六七八九十百千万\d]+)[集话])?$/);
    if (playMatch) {
      let rawName = playMatch[1].trim();
      const season = playMatch[2] ? `第${playMatch[2]}季` : '';
      const episode = playMatch[3];
      
      if (rawName && rawName !== '继续' && !/^(继续|暂停|停止)/.test(rawName) && rawName !== '播放') {
        let keyword = cleanSearchKeyword(rawName);
        if (season && !keyword.includes(season)) {
          keyword += season;
        }
        
        let finalEpisode = episode;
        if (!finalEpisode && season) finalEpisode = '1';
        
        return { type: 'play_episode', keyword: keyword, episode: finalEpisode };
      }
    }

    const seekMatch = t.match(/(快进|后退|快退|前进)\s*(\d+(?:\.\d+)?)?\s*(秒|分钟)?/);
    if (seekMatch) {
      let num = parseFloat(seekMatch[2] || 10);
      if (seekMatch[3] === '分钟') num *= 60;
      const dir = (seekMatch[1] === '后退' || seekMatch[1] === '快退') ? -1 : 1;
      return { type: 'action', action: 'seek', value: num * dir, reply: `已为你${seekMatch[1]} ${num} 秒` };
    }

    const volMatch = t.match(/(?:音量|声音)\s*(?:调到|设为|改为|调整为)?\s*(\d+)/);
    if (volMatch) return { type: 'action', action: 'setVolume', value: parseInt(volMatch[1]) / 100, reply: '已将音量调整至 ' + volMatch[1] + '%' };
    if (/调大音量|声音大点|声音大一点/i.test(t)) return { type: 'action', action: 'volumeUp', reply: '已调大音量' };
    if (/调小音量|声音小点|声音小一点/i.test(t)) return { type: 'action', action: 'volumeDown', reply: '已调小音量' };

    const speedMatch = t.match(/(\d+(?:\.\d+)?)\s*倍速/);
    if (speedMatch) return { type: 'action', action: 'setSpeed', value: parseFloat(speedMatch[1]), reply: '已切换至 ' + speedMatch[1] + ' 倍速' };
    if (/正常速度|恢复倍速/i.test(t)) return { type: 'action', action: 'setSpeed', value: 1, reply: '已恢复正常播放速度' };
    if (/加速|快放/i.test(t)) return { type: 'action', action: 'speedUp', reply: '已加快播放速度' };
    if (/减速|慢放/i.test(t)) return { type: 'action', action: 'speedDown', reply: '已减慢播放速度' };

    const similarMatch = t.match(/(?:类似|像)\s*《?([^》]+?)》?(?:的|$)/);
    if (similarMatch) {
      const target = cleanSearchKeyword(similarMatch[1]);
      const recs = SIMILAR_MAP[target] || [target];
      return { type: 'list_search', keywords: recs, reply: '为你推荐：\n• ' + recs.join('\n• ') + '\n\n正在为你搜索《' + recs[0] + '》...' };
    }
    const recMatch = t.match(/(推荐|有什么|来点|想看).*(喜剧|搞笑|科幻|悬疑|恐怖|爱情|动作|动画|治愈|纪录片|犯罪|奇幻|冒险)/);
    if (recMatch) {
      const genre = recMatch[2];
      const recs = SIMILAR_MAP[genre] || [genre];
      return { type: 'list_search', keywords: recs, reply: '为你推荐「' + genre + '」类高分作品：\n• ' + recs.join('\n• ') + '\n\n正在为你搜索《' + recs[0] + '》...' };
    }

    const searchMatch = t.match(/(?:搜|查找|找一下|搜索)\s*[:：]?\s*(.+)/);
    if (searchMatch) return { type: 'search', keyword: cleanSearchKeyword(searchMatch[1].trim()), reply: '正在为你搜索《' + cleanSearchKeyword(searchMatch[1]) + '》...' };

    if (/下一集|下集|next/i.test(t)) return { type: 'action', action: 'next', reply: '正在为你播放下一集' };
    if (/上一集|上集|prev/i.test(t)) return { type: 'action', action: 'prev', reply: '正在为你播放上一集' };
    if (/全屏|满屏|fullscreen/i.test(t)) return { type: 'action', action: 'fullscreen', reply: '已为你切换全屏' };
    if (/退出全屏|取消全屏|exit/i.test(t)) return { type: 'action', action: 'exitFullscreen', reply: '已退出全屏' };
    if (/静音|mute/i.test(t)) return { type: 'action', action: 'mute', reply: '已为你切换静音状态' };
    if (/暂停|pause/i.test(t)) return { type: 'action', action: 'pause', reply: '已暂停播放' };
    if (/^(播放|继续|play|resume)$/i.test(t) || /继续播放/i.test(t)) {
      return { type: 'action', action: 'play', reply: '继续播放' };
    }
    if (/设置|config|选项/i.test(t)) return { type: 'action', action: 'settings', reply: '为你打开设置面板' };

    return { type: 'text', text: '没听懂这句指令。你可以试试：“播放进击的巨人第4集”、“快进10秒”、“音量调到60” 或者 “1.5倍速”。' };
  }

  async function deepseekSearchWithKey(query, preset, count, signal) {
    if (!preset || !preset.key) return [];
    try {
      const res = await fetch('https://api.deepseek.com/v1/tools/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + preset.key
        },
        body: JSON.stringify({ query: query, count: count || 5, need_content: false }),
        signal: signal
      });
      if (!res.ok) throw new Error('Search API ' + res.status);
      return (await res.json()).results || [];
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return [];
    }
  }

  async function callOneModel(preset, text, signal, seq) {
    let searchContext = '';
    
    if (/deepseek\.com/i.test(preset.url) && preset.key) {
      try {
        const results = await deepseekSearchWithKey(text, preset, 5, signal);
        if (results && results.length) {
          searchContext = '参考以下你搜索到的实时网页结果，然后再给出最终回答：\n' +
            results.map((r, i) => '[' + (i + 1) + '] ' + r.title + '\n摘要：' + (r.summary || '')).join('\n\n');
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
    }

    const sysPrompt =
      '你是智能影视助手。严格返回合法JSON。注意：JSON内部如果需要换行请用 \\n 代替，严禁使用真实换行，键和值必须使用双引号：\n' +
      '1. 播放某集 → {"action":"play_episode","keyword":"片名","episode":"4"}\n' +
      '2. 推荐类似/类型 → {"action":"search","keyword":"片名1|片名2","reply":"推荐..."}\n' +
      '3. 控制指令 → {"action":"setVolume|setSpeed|seek|next|prev|play|pause|fullscreen|exitFullscreen|mute","value":数值}\n' +
      '4. 闲聊 → {"action":"chat","reply":"..."}\n\n' +
      '【要求】：推荐时提取2-3个真实作品名用"|"拼接；只返回纯JSON，无```标记。\n' +
      (searchContext ? searchContext : '');

    const res = await fetch(preset.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (preset.key || '')
      },
      body: JSON.stringify({
        model: preset.model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user',   content: text }
        ],
        temperature: 0.2
      }),
      signal: signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (seq !== currentRequestSeq) return null;

    let raw = data.choices?.[0]?.message?.content || '';
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) raw = raw.substring(start, end + 1);
    
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[AI] 模型 ' + preset.model + ' 返回了非标 JSON，尝试修复...', raw);
      
      try {
        let fixedRaw = raw
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '')
          .replace(/:\s*'/g, ':"')
          .replace(/'\s*([,}])/g, '"$1');
        return JSON.parse(fixedRaw);
      } catch (e2) {
        return { 
          action: 'chat', 
          reply: '⚠️ ' + preset.model + ' 格式解析失败，以下是它的原始回复：\n' + raw 
        };
      }
    }
  }

  function aggregateResponses(results, presets) {
    const valid = [];
    const failed = [];
    results.forEach((r, i) => {
      if (!r) return;
      if (r.__error) { failed.push({ preset: presets[i], error: r.__error }); return; }
      if (r.action)  valid.push({ preset: presets[i], data: r });
    });

    if (failed.length && valid.length) {
      addBot('⚠️ ' + failed.length + ' 个模型调用失败：' +
        failed.map(f => f.preset.model + '（' + f.error + '）').join('、'));
    }
    if (!valid.length) return null;

    if (valid.length === 1) {
      const d = Object.assign({}, valid[0].data);
      if (d.reply) d.reply += '\n\n（来源：' + valid[0].preset.model + '）';
      return d;
    }

    const playVote = valid.filter(v => v.data.action === 'play_episode' && v.data.keyword);
    if (playVote.length) {
      const counts = {};
      playVote.forEach(v => {
        const k = String(v.data.keyword).trim();
        counts[k] = (counts[k] || 0) + 1;
      });
      const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const winnerData = playVote.find(v => String(v.data.keyword).trim() === winner)?.data || {};
      return {
        action: 'play_episode',
        keyword: winner,
        episode: winnerData.episode,
        _multi: true, _models: valid.length,
        reply: '🎬 ' + valid.length + ' 个模型共同推荐播放《' + winner + '》' +
               (winnerData.episode ? ' 第 ' + winnerData.episode + ' 集' : '')
      };
    }

    const searchVote = valid.filter(v => v.data.action === 'search' && v.data.keyword);
    if (searchVote.length) {
      const allKw = [];
      const seen = new Set();
      const perModel = [];
      searchVote.forEach(v => {
        const list = String(v.data.keyword).split(/[|｜,，\s]+/).map(s => s.trim()).filter(Boolean);
        perModel.push({ model: v.preset.model, kws: list });
        list.forEach(k => { if (!seen.has(k)) { seen.add(k); allKw.push(k); } });
      });
      const reply =
        '🎯 ' + valid.length + ' 个模型推荐合集（去重后 ' + allKw.length + ' 部）：\n' +
        perModel.map(p => '· ' + p.model + '：' + p.kws.join('、')).join('\n') +
        '\n\n自动搜索第一部：《' + allKw[0] + '》';
      return {
        action: 'search',
        keyword: allKw.join('|'),
        reply: reply,
        _multi: true, _models: valid.length
      };
    }

    const ctrlVote = valid.filter(v =>
      v.data.action && ['chat', 'search', 'play_episode'].indexOf(v.data.action) < 0
    );
    if (ctrlVote.length) {
      const counts = {};
      ctrlVote.forEach(v => { counts[v.data.action] = (counts[v.data.action] || 0) + 1; });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const winner = sorted[0][0];
      const entry  = ctrlVote.find(v => v.data.action === winner);
      const d = Object.assign({}, entry.data);
      d.reply = (d.reply || '') + '　（' + sorted[0][1] + '/' + ctrlVote.length + ' 个模型一致）';
      d._multi = true;
      return d;
    }

    const chats = valid.filter(v => v.data.reply);
    if (chats.length) {
      return {
        action: 'chat',
        reply: chats.map(v => '【' + v.preset.model + '】\n' + v.data.reply).join('\n\n———\n\n'),
        _multi: true, _models: valid.length
      };
    }

    return valid[0].data;
  }

  async function llmRespond(text, seq) {
    if (!llmEnabled) return null;

    let activePresets = llmPresets.filter(p => p.enabled && p.url && p.model);
    if (!activePresets.length && llmConfig.url && llmConfig.model) {
      activePresets = [{
        id: '__form__',
        url: llmConfig.url,
        key: llmConfig.key,
        model: llmConfig.model
      }];
    }
    if (!activePresets.length) return null;

    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    if (activePresets.length > 1) {
      addBot('⚡ ' + activePresets.length + ' 个模型正在各自独立搜索并分析中…');
    }
    
    const tasks = activePresets.map(p =>
      callOneModel(p, text, signal, seq).catch(err => {
        if (err.name === 'AbortError') throw err;
        return { __error: err.message || '调用失败', __model: p.model };
      })
    );

    let settled;
    try {
      settled = await Promise.all(tasks);
    } catch (e) {
      if (e.name === 'AbortError') return null;
      return null;
    }
    if (seq !== currentRequestSeq) return null;

    return aggregateResponses(settled, activePresets);
  }

  async function sendText(raw) {
    const text = String(raw || '').trim();
    if (!text) return;

    if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
    const mySeq = ++currentRequestSeq;
    addMsg('user', text);
    input.value = '';
    input.style.height = 'auto';

    if (llmEnabled) {
      const cloud = await llmRespond(text, mySeq);
      if (mySeq !== currentRequestSeq) return;

      if (cloud) {
        if (cloud._multi && cloud.reply && cloud.action !== 'chat') {
          addBot(cloud.reply);
        }
        if (cloud.action === 'play_episode' && cloud.keyword) {
          aiAutoPlay(cleanSearchKeyword(cloud.keyword), cloud.episode);
          return;
        }
        if (cloud.action === 'search' && cloud.keyword) {
          const kwList = String(cloud.keyword).split(/[|｜\s]+/).filter(Boolean);
          if (kwList.length > 0) {
            if (!cloud._multi) addBot(cloud.reply || ('为你推荐：\n• ' + kwList.join('\n• ')));
            quickSearch(cleanSearchKeyword(kwList[0]));
          }
          return;
        }
        if (cloud.action === 'chat' && cloud.reply) { addBot(cloud.reply); return; }
        if (cloud.action) { executeAction(cloud.action, cloud.reply, cloud.value); return; }
      }
    }

    if (mySeq !== currentRequestSeq) return;

    const local = localRespond(text);
    if (local.type === 'text') addBot(local.text);
    else if (local.type === 'play_episode') aiAutoPlay(local.keyword, local.episode);
    else if (local.type === 'search') { addBot(local.reply); if (typeof quickSearch === 'function') quickSearch(local.keyword); }
    else if (local.type === 'list_search') { addBot(local.reply); if (typeof quickSearch === 'function') quickSearch(local.keywords[0]); }
    else if (local.type === 'action') executeAction(local.action, local.reply, local.value);
  }

  function executeAction(action, replyText, value) {
    const v = document.getElementById('video');
    if (replyText) addBot(replyText);
    
    switch(action) {
      case 'next': if (typeof playNextEpisode === 'function') playNextEpisode(); break;
      case 'prev': if (typeof state !== 'undefined' && typeof playEpisode === 'function') playEpisode(state.lineIdx, Math.max(0, state.epIdx - 1)); break;
      case 'fullscreen': if (typeof toggleFullscreen === 'function') toggleFullscreen(); break;
      case 'exitFullscreen': if (typeof exitAnyFs === 'function') exitAnyFs(); break;
      case 'mute': if (v) v.muted = !v.muted; break;
      case 'pause': if (v && !v.paused) v.pause(); break;
      case 'play': if (v && v.paused) v.play().catch(()=>{}); break;
      case 'settings': if (typeof togglePanel === 'function') togglePanel(); break;
      
      case 'setVolume': 
        if (v && typeof value === 'number') v.volume = Math.max(0, Math.min(1, value)); 
        break;
      case 'volumeUp': 
        if (v) v.volume = Math.min(1, v.volume + 0.1); 
        break;
      case 'volumeDown': 
        if (v) v.volume = Math.max(0, v.volume - 0.1); 
        break;
        
      case 'seek':
        if (v && typeof value === 'number') v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + value));
        break;
        
      case 'setSpeed':
        if (v && typeof value === 'number') v.playbackRate = value;
        break;
      case 'speedUp':
        if (v) v.playbackRate = Math.min(3, v.playbackRate + 0.25);
        break;
      case 'speedDown':
        if (v) v.playbackRate = Math.max(0.5, v.playbackRate - 0.25);
        break;
    }
  }

  fab.addEventListener('click', () => {
    panel.classList.toggle('open');
    dot.style.display = 'none';
    if (panel.classList.contains('open')) setTimeout(() => input.focus(), 120);
  });

  closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  sendBtn.addEventListener('click', () => sendText(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText(input.value);
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  cfgBtn.addEventListener('click', async () => {
    cfg.classList.add('open');
    document.getElementById('aiLlmOn').checked = llmEnabled;
    document.getElementById('aiLlmUrl').value = llmConfig.url;
    document.getElementById('aiLlmKey').value = llmConfig.key;
    document.getElementById('aiLlmModel').value = llmConfig.model;
    document.getElementById('aiLlmFields').style.display = llmEnabled ? 'block' : 'none';
    renderSavedModels();
    await ensureCloudInSync();
  });

  cfgClose.addEventListener('click', () => cfg.classList.remove('open'));

  document.getElementById('aiLlmOn').addEventListener('change', e => {
    document.getElementById('aiLlmFields').style.display = e.target.checked ? 'block' : 'none';
  });

  document.getElementById('aiCfgSave').addEventListener('click', async () => {
    llmEnabled      = document.getElementById('aiLlmOn').checked;
    llmConfig.url   = document.getElementById('aiLlmUrl').value.trim();
    llmConfig.key   = document.getElementById('aiLlmKey').value.trim();
    llmConfig.model = document.getElementById('aiLlmModel').value.trim();

    persistLlmCfg();

    let extra = '';
    if (llmConfig.url && llmConfig.model) {
      const wasEditing = !!editingPresetId;
      if (upsertPreset(llmConfig)) {
        extra = wasEditing
          ? '\n✎ 已更新已有配置。'
          : '\n📚 已记录到列表并自动勾选（下次提问将参与并行）。';
      }
      editingPresetId = null;
    }

    updateHeadSub();
    renderSavedModels();

    let cloudMsg = '';
    if (canUseCloud()) {
      const ok = await syncAiConfigToCloud(true);
      cloudMsg = ok ? '\n☁️ 已同步到云端账户（换设备登录可恢复）'
                    : '\n（云端同步失败，配置仍保存在本机）';
    }

    const activeCount = llmPresets.filter(p => p.enabled && p.url && p.model).length;
    let modeMsg;
    if (!llmEnabled)         modeMsg = '已切换回本地引擎。';
    else if (activeCount > 1) modeMsg = '已启用云端大模型 · ' + activeCount + ' 个模型将并行调用。';
    else if (activeCount === 1) modeMsg = '已启用云端大模型（1 个模型）。';
    else                     modeMsg = '已启用云端大模型，但列表里还没有勾选任何模型。';

    cfg.classList.remove('open');
    addBot(modeMsg + extra + cloudMsg);
  });

  document.getElementById('aiCfgClear').addEventListener('click', () => {
    history = []; msgs.innerHTML = '';
    addBot('对话已清空。有什么可以帮你的？');
  });

  renderChips();
  renderSavedModels();
  updateHeadSub();

  setTimeout(() => {
    if (canUseCloud()) loadAiConfigFromCloud(true);
  }, 2500);

  addBot('你好，我是澪鸢 AI 助手');
  dot.style.display = 'block';

  window.LingYuanAI = {
    open: () => { panel.classList.add('open'); dot.style.display = 'none'; },
    close: () => panel.classList.remove('open'),
    send: sendText
  };
})();