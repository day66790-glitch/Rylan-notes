/* =========================================================
 * EchoNote · 公共脚本（app.js）
 * ---------------------------------------------------------
 * 1. 主题切换（暗黑 / 白天），偏好写入 localStorage: theme
 * 2. 顶部导航当前页面高亮 + 移动端菜单
 * 3. 同声传译：Web Speech API，默认语言 en-MY（马来西亚英语）
 * 4. 笔记读写（localStorage: notes），传译页与笔记页共用
 * 5. 个人设置：保存 DeepSeek API Key（localStorage: api_key）
 * 6. 大模型 API：真实 fetch 调用（DeepSeek / OpenAI / Claude / Gemini / Qwen）
 *    术语表注入 System Prompt，支持翻译、对话翻译与笔记 AI 总结
 * 7. 笔记导出 PDF（html2pdf.js）与系统分享（navigator.share / 剪贴板）
 * ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const STORAGE = {
    THEME: 'theme',               // 'dark' | 'light'
    API_KEY: 'api_key',           // 个人设置页保存的 API Key
    API_PROVIDER: 'api_provider', // 大模型提供商：deepseek | openai | anthropic | google | qwen
    SPEECH_LANG: 'speech_lang',   // 上次选择的识别语言，例如 en-MY
    ASR_ENGINE: 'asr_engine',     // 语音识别引擎：browser | whisper
    NOTES: 'notes',               // 笔记数组（JSON）
    USER_NAME: 'user_name',       // 用户昵称
    USER_AVATAR: 'user_avatar',   // 用户头像（Base64 dataURL）
    WELCOME_DONE: 'welcome_done', // 首次引导是否已完成 / 已跳过
    LEGACY_NOTES: 'lingua-notes', // 旧版单页应用的笔记，做一次性迁移
    GLOSSARY: 'custom_glossary',  // 自定义传媒术语：[{ term, translation }]
    TARGET_LANG: 'translate_target', // 上次选择的翻译目标语言
    TRANSLATE_MODE: 'translate_mode', // 上次使用的翻译模式：normal | dialog
    AUTO_TRANSLATE: 'auto_translate', // 边录边译开关：on | off
    AUDIO_SOURCE: 'audio_source'      // 音频来源：mic | system
  };

  const DEFAULT_SPEECH_LANG = 'en-MY'; // 默认识别语言：马来西亚英语

  const PROVIDERS = {
    deepseek: 'DeepSeek',
    openai: 'OpenAI (ChatGPT)',
    anthropic: 'Anthropic (Claude)',
    google: 'Google Gemini',
    qwen: '阿里通义千问 (Qwen)'
  };

  /* 内置传媒术语：英文 → 中文标准译法（不可删除） */
  const BUILTIN_GLOSSARY = {
    'B-roll': '空镜',
    'Stand-up': '出镜报道',
    'Voiceover': '画外音',
    'Montage': '蒙太奇',
    'Lower Third': '字幕条',
    'Soundbite': '同期声',
    'Cutaway': '切出镜头',
    'Anchor': '主播',
    'Lead': '导语',
    'Package': '成套报道',
    'Bumper': '转场片花',
    'Cold Open': '冷开场'
  };

  /* 各家大模型接口配置（浏览器直连） */
  const API_CONFIG = {
    deepseek: {
      label: 'DeepSeek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-chat',
      style: 'openai'
    },
    openai: {
      label: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      style: 'openai'
    },
    anthropic: {
      label: 'Anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-3-5-haiku-latest',
      style: 'anthropic'
    },
    google: {
      label: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      model: 'gemini-1.5-flash',
      style: 'google'
    },
    qwen: {
      label: '通义千问',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-plus',
      style: 'openai'
    }
  };

  const ICONS = {
    speech: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    manual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  };

  /* ---------------- 基础工具 ---------------- */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      console.warn('[EchoNote] 读取 localStorage 失败：', error);
      return null;
    }
  }

  function setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('[EchoNote] 写入 localStorage 失败：', error);
      showToast('保存失败：浏览器本地存储不可用', 'error');
      return false;
    }
  }

  function removeItem(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('[EchoNote] 删除 localStorage 失败：', error);
      return false;
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function maskKey(key) {
    const value = String(key || '');
    if (!value) return '';
    if (value.length <= 10) return value.slice(0, 2) + '••••';
    return value.slice(0, 6) + '••••••' + value.slice(-4);
  }

  function toIsoString(value) {
    if (value === undefined || value === null || value === '') {
      return new Date().toISOString();
    }
    if (typeof value === 'number') return new Date(value).toISOString();
    const text = String(value).trim();
    const parsed = new Date(text.indexOf('T') > -1 ? text : text.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  function formatDateTime(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '时间未知';

    const now = new Date();
    const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

    if (date.toDateString() === now.toDateString()) return '今天 ' + time;

    const yesterday = new Date(now.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return '昨天 ' + time;

    const day = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    return day + ' ' + time;
  }

  /* ---------------- 剪贴板 / 语言名称 ---------------- */
  function legacyCopy(value) {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);

    let ok = false;
    try {
      area.select();
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }

    area.remove();
    return ok;
  }

  function copyText(text, successMessage) {
    const value = String(text || '');
    if (!value.trim()) {
      showToast('没有可复制的内容', 'error');
      return;
    }

    const done = function () {
      showToast(successMessage || '已复制到剪贴板', 'success');
    };

    const fail = function () {
      showToast('复制失败，请手动选择文本复制', 'error');
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(done).catch(function () {
        if (legacyCopy(value)) done();
        else fail();
      });
      return;
    }

    if (legacyCopy(value)) done();
    else fail();
  }

  // 读取下拉框当前项对应的语言名称（优先 data-name）
  function getSelectedLanguage(select, fallback) {
    if (!select) return fallback || '';
    const option = select.options[select.selectedIndex];
    if (!option) return fallback || select.value || '';

    const name = option.getAttribute('data-name');
    if (name) return name;

    const text = String(option.textContent || '').trim();
    const parts = text.split('·');
    return (parts.length > 1 ? parts[1] : text).trim() || fallback || select.value;
  }

  /* ---------------------------------------------------------
   * 语音识别引擎：浏览器 Web Speech API / OpenAI Whisper API
   * ---------------------------------------------------------
   * asr_engine = 'browser'（默认，免费）
   * asr_engine = 'whisper'（MediaRecorder 录音 → Whisper 转写）
   * Whisper 直接使用 api_key，请把「模型提供商」设为 OpenAI。
   * ------------------------------------------------------- */
  const ASR_ENGINES = {
    browser: '浏览器内置引擎 (Web Speech API)',
    whisper: 'OpenAI Whisper API'
  };
  const DEFAULT_ASR_ENGINE = 'browser';
  const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
  const WHISPER_MODEL = 'whisper-1';
  const WHISPER_MAX_SECONDS = 180; // 单次录音上限：3 分钟（约 2.8MB opus）

  function readAsrEngine() {
    const value = String(getItem(STORAGE.ASR_ENGINE) || DEFAULT_ASR_ENGINE).trim();
    return Object.prototype.hasOwnProperty.call(ASR_ENGINES, value) ? value : DEFAULT_ASR_ENGINE;
  }

  function saveAsrEngine(value) {
    const engine = Object.prototype.hasOwnProperty.call(ASR_ENGINES, value) ? value : DEFAULT_ASR_ENGINE;
    if (!setItem(STORAGE.ASR_ENGINE, engine)) return false;

    // 通知所有页面（同声传译 / 语音翻译）立即切换引擎
    document.dispatchEvent(new CustomEvent('echonote:asr-engine-changed', {
      detail: { engine: engine }
    }));
    return true;
  }

  function getAsrEngineLabel(engine) {
    return ASR_ENGINES[engine] || ASR_ENGINES[DEFAULT_ASR_ENGINE];
  }

  function isMediaRecordingSupported() {
    return Boolean(
      window.MediaRecorder &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  // BCP-47（en-MY）→ Whisper 需要的 ISO-639-1（en）
  function toWhisperLanguage(lang) {
    const base = String(lang || '').toLowerCase().split('-')[0];
    const supported = ['zh', 'en', 'ms', 'ja', 'ko', 'fr', 'de', 'es', 'ar', 'id', 'th', 'vi', 'pt', 'ru', 'it', 'hi'];
    return supported.indexOf(base) > -1 ? base : '';
  }

  // 把术语表里的英文专有名词写进 prompt，帮助 Whisper 正确拼写（prompt 上限 224 tokens）
  function buildWhisperPrompt() {
    const terms = getAllGlossary().map(function (item) {
      return item.term;
    }).filter(function (term) {
      return /[A-Za-z]/.test(term);
    });

    if (!terms.length) return '';
    return ('Media production terms: ' + terms.join(', ') + '.').slice(0, 500);
  }

  // 选一个当前浏览器支持、Whisper 也接受的录音格式
  function pickAudioMimeType() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return '';

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4'
    ];

    for (let i = 0; i < candidates.length; i += 1) {
      try {
        if (window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (error) {
        /* 忽略不支持的类型 */
      }
    }

    return '';
  }

  function buildWhisperFile(blob) {
    const type = String((blob && blob.type) || '');
    const ext = /ogg/.test(type) ? 'ogg' : (/mp4|m4a/.test(type) ? 'm4a' : 'webm');
    return 'echonote-' + Date.now() + '.' + ext;
  }

  /* 把录音上传到 OpenAI，返回纯文本 */
  async function transcribeWithWhisper(audioBlob, options) {
    if (!audioBlob || !audioBlob.size) {
      throw new Error('没有录到声音，请靠近麦克风再录一次。');
    }

    const settings = readApiSettings();
    if (!settings.key) {
      const error = new Error('还没有保存 API Key，请先到「个人设置」填写 OpenAI API Key 并保存。');
      error.code = 'NO_KEY';
      throw error;
    }

    const opts = options || {};
    const form = new FormData();

    form.append('file', audioBlob, buildWhisperFile(audioBlob));
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const language = toWhisperLanguage(opts.lang || getItem(STORAGE.SPEECH_LANG) || DEFAULT_SPEECH_LANG);
    if (language) form.append('language', language);

    const prompt = buildWhisperPrompt();
    if (prompt) form.append('prompt', prompt);

    let response;
    try {
      response = await fetch(WHISPER_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + settings.key },
        body: form
      });
    } catch (error) {
      throw new Error('Whisper 请求失败：网络不可用或被浏览器拦截。' +
        (error && error.message ? '（' + error.message + '）' : ''));
    }

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const detail = data && data.error
        ? (data.error.message || data.error.code || '')
        : raw.slice(0, 160);

      let hint = '';
      if (response.status === 401 || response.status === 403) {
        hint = '请确认保存的是 OpenAI 的 API Key（在下方把「模型提供商」切换为 OpenAI 后重新保存）。';
      } else if (response.status === 413) {
        hint = '录音文件过大，请缩短单次录音时长。';
      } else if (response.status === 429) {
        hint = '请求过于频繁或额度不足，请稍后再试。';
      }

      const error = new Error('Whisper 转写失败：HTTP ' + response.status +
        (detail ? ' · ' + detail : '') + (hint ? ' ' + hint : ''));
      if (response.status === 401 || response.status === 403) error.code = 'BAD_KEY';
      throw error;
    }

    const text = data && typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) throw new Error('Whisper 没有识别到语音，请靠近麦克风再试一次。');
    return text;
  }

  /* ---------------------------------------------------------
   * MediaRecorder 录音器：开始 / 停止 / 取消
   * onStop(blob) 只在正常停止时回调；cancel() 会丢弃本次录音
   * ------------------------------------------------------- */
  function createWhisperRecorder(options) {
    const opts = options || {};
    let recorder = null;
    let stream = null;
    let chunks = [];
    let cancelled = false;
    let active = false;

    function releaseStream() {
      if (!stream) return;
      stream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (error) { /* 忽略 */ }
      });
      stream = null;
    }

    function start() {
      if (!isMediaRecordingSupported()) {
        return Promise.reject(new Error('当前浏览器不支持录音（MediaRecorder），请使用最新版 Chrome / Edge。'));
      }

      cancelled = false;
      chunks = [];

      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      }).then(function (mediaStream) {
        // 等待麦克风授权期间用户已取消：立即释放，不开始录音
        if (cancelled) {
          stream = mediaStream;
          releaseStream();
          return;
        }

        stream = mediaStream;
        const mimeType = pickAudioMimeType();

        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType: mimeType, audioBitsPerSecond: 128000 })
            : new MediaRecorder(stream);
        } catch (error) {
          try {
            recorder = new MediaRecorder(stream);
          } catch (fallbackError) {
            releaseStream();
            throw fallbackError;
          }
        }

        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = function (event) {
          active = false;
          cancelled = true;
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch (error) {
            /* 忽略 */
          }
          releaseStream();
          if (opts.onError) opts.onError((event && event.error) || new Error('录音失败'));
        };

        recorder.onstop = function () {
          const type = (recorder && recorder.mimeType) || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: type });
          chunks = [];
          active = false;
          releaseStream();

          if (cancelled) return;
          if (opts.onStop) opts.onStop(blob);
        };

        try {
          recorder.start(1000); // 每秒产出一次数据，避免长录音占用过多内存
          active = true;
        } catch (error) {
          releaseStream();
          throw error;
        }
        if (opts.onStart) opts.onStart(recorder.mimeType || mimeType);
      });
    }

    function stop() {
      if (!recorder || recorder.state === 'inactive') {
        // 可能仍在等待麦克风授权：标记取消，避免授权后自动开始录音
        if (!active) cancelled = true;
        return false;
      }

      try {
        recorder.stop();
      } catch (error) {
        active = false;
        releaseStream();
        return false;
      }
      return true;
    }

    function cancel() {
      cancelled = true;
      if (!stop()) releaseStream();
    }

    return {
      start: start,
      stop: stop,
      cancel: cancel,
      isActive: function () { return active; }
    };
  }

  /* ---------------- 轻提示 Toast ---------------- */
  function showToast(message, type) {
    let container = $('#toastContainer');

    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast toast--' + (type === 'success' || type === 'error' ? type : 'info');

    const dot = document.createElement('span');
    dot.className = 'toast__dot';

    const text = document.createElement('span');
    text.textContent = message;

    toast.appendChild(dot);
    toast.appendChild(text);
    container.appendChild(toast);

    window.requestAnimationFrame(function () {
      toast.classList.add('is-visible');
    });

    window.setTimeout(function () {
      toast.classList.remove('is-visible');
      window.setTimeout(function () { toast.remove(); }, 400);
    }, 2600);
  }

  /* ---------------- 主题切换 ---------------- */
  function getPreferredTheme() {
    const saved = getItem(STORAGE.THEME);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme, persist) {
    const isDark = theme === 'dark';

    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = theme;

    const toggle = $('#themeToggle');
    if (toggle) {
      const label = isDark ? '切换到白天模式' : '切换到暗黑模式';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
      toggle.setAttribute('aria-checked', String(isDark));
    }

    if (persist) setItem(STORAGE.THEME, theme);
  }

  function initTheme() {
    applyTheme(getPreferredTheme(), false);

    const toggle = $('#themeToggle');
    if (!toggle) return;

    toggle.addEventListener('click', function () {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next, true);
    });
  }

  /* ---------------- Hash 路由 + 导航栏 ---------------- */
  const ROUTES = ['transcribe', 'translate', 'notes', 'profile'];

  function getRouteFromHash() {
    const raw = String(window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
    return ROUTES.indexOf(raw) > -1 ? raw : 'transcribe';
  }

  function applyRoute(route, options) {
    const next = ROUTES.indexOf(route) > -1 ? route : 'transcribe';

    // 只切换 section 的显隐，不销毁 DOM：录音实例得以保留，切页不中断
    ROUTES.forEach(function (name) {
      const view = document.getElementById('view-' + name);
      if (view) view.classList.toggle('is-active', name === next);
    });

    $$('a[data-route]').forEach(function (link) {
      const active = link.getAttribute('data-route') === next;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    document.body.setAttribute('data-view', next);

    const titles = {
      transcribe: '同声传译',
      translate: '语音翻译',
      notes: '我的笔记',
      profile: '个人设置'
    };
    document.title = (titles[next] || '同声传译') + " · Rylan's note";

    // 进入笔记页时刷新列表（其他页面可能刚保存了新笔记）
    if (next === 'notes' && typeof refreshNotesView === 'function') refreshNotesView();

    // 进入设置页时刷新 API Key 状态（引导弹窗可能刚写入）
    if (next === 'profile') {
      document.dispatchEvent(new CustomEvent('echonote:profile-changed'));
    }

    if (!options || options.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function initNav() {
    window.addEventListener('hashchange', function () {
      applyRoute(getRouteFromHash());
    });

    applyRoute(getRouteFromHash(), { scroll: false });

    const menuBtn = $('#mobileMenuBtn');
    const menu = $('#mobileMenu');
    if (!menuBtn || !menu) return;

    function setMenu(open) {
      menu.classList.toggle('hidden', !open);
      menuBtn.setAttribute('aria-expanded', String(open));
    }

    menuBtn.addEventListener('click', function () {
      setMenu(menu.classList.contains('hidden'));
    });

    menu.addEventListener('click', function (event) {
      if (event.target.closest('a')) setMenu(false);
    });
  }

  /* ---------------- 笔记数据（localStorage: notes） ---------------- */
  let refreshNotesView = null;

  /* 笔记数据结构：
   * { id, text, originalText, translatedText, createdAt, source }
   * text 为展示用正文（有译文时取译文）；originalText / translatedText 供时间线对照。
   */
  function normalizeNote(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const text = typeof raw.text === 'string' ? raw.text : '';
    const originalText = typeof raw.originalText === 'string' ? raw.originalText : '';
    const translatedText = typeof raw.translatedText === 'string' ? raw.translatedText : '';

    if (!text && !originalText && !translatedText) return null;

    return {
      id: raw.id ? String(raw.id) : createId(),
      text: text || translatedText || originalText,
      originalText: originalText,
      translatedText: translatedText,
      createdAt: toIsoString(raw.createdAt || raw.timestamp || raw.time),
      source: raw.source === 'speech' ? 'speech' : 'manual'
    };
  }

  function loadNotes() {
    const raw = getItem(STORAGE.NOTES);

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(normalizeNote).filter(Boolean);
      } catch (error) {
        console.warn('[EchoNote] 笔记数据解析失败：', error);
      }
    }

    // 兼容旧版单页应用的笔记（lingua-notes）：读取成功后迁移到新键 notes
    const legacyRaw = getItem(STORAGE.LEGACY_NOTES);
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (Array.isArray(legacy) && legacy.length) {
          const migrated = legacy.map(normalizeNote).filter(Boolean);
          setItem(STORAGE.NOTES, JSON.stringify(migrated));
          return migrated;
        }
      } catch (error) {
        console.warn('[EchoNote] 旧笔记迁移失败：', error);
      }
    }

    return [];
  }

  function saveNotes(notes) {
    const ok = setItem(STORAGE.NOTES, JSON.stringify(notes));
    if (ok) {
      document.dispatchEvent(new CustomEvent('echonote:notes-changed'));
    }
    return ok;
  }

  function addNote(text, source, extra) {
    const content = String(text || '').trim();
    const meta = extra || {};
    const originalText = String(meta.originalText || '').trim();
    const translatedText = String(meta.translatedText || '').trim();
    if (!content && !originalText && !translatedText) return null;

    const notes = loadNotes();
    const note = {
      id: createId(),
      text: content || translatedText || originalText,
      originalText: originalText,
      translatedText: translatedText,
      createdAt: meta.createdAt ? toIsoString(meta.createdAt) : new Date().toISOString(),
      source: source === 'speech' ? 'speech' : 'manual'
    };

    notes.unshift(note);
    return saveNotes(notes) ? note : null;
  }

  function deleteNoteById(id) {
    const notes = loadNotes();
    const next = notes.filter(function (note) { return note.id !== String(id); });
    if (next.length === notes.length) return false;
    return saveNotes(next);
  }

  /* ---------------- 笔记富文本：Markdown + 公式 + 图片 ---------------- */
  const NOTE_MATH_TOKEN = '@@ECHONOTE-MATH-';
  const NOTE_MATH_RETRY_LIMIT = 40;
  const NOTE_IMAGE_MAX_EDGE = 1800;
  const NOTE_IMAGE_SKIP_COMPRESS_BYTES = 720 * 1024;
  const NOTE_BLOCKED_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];

  let noteMathTimer = null;
  let noteMathRetries = 0;
  let noteMathLoadHooked = false;

  function escapeNoteHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function plainTextToHtml(text) {
    return escapeNoteHtml(text).replace(/\r?\n/g, '<br />');
  }

  /* 先把公式替换成占位符：避免 Markdown 把 _ * 等符号当成强调语法，导致公式被拆开 */
  function protectNoteMath(source, store) {
    let text = String(source === undefined || source === null ? '' : source);

    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (match, formula) {
      store.push({ display: true, formula: formula });
      return '\n\n' + NOTE_MATH_TOKEN + (store.length - 1) + '@@\n\n';
    });

    text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (match, formula) {
      store.push({ display: true, formula: formula });
      return '\n\n' + NOTE_MATH_TOKEN + (store.length - 1) + '@@\n\n';
    });

    // 行内公式：开头不能是空格 / $，结尾不能是空格，且后面不能紧跟数字（减少 $5 这类货币误判）
    text = text.replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*[^\s$])?)\$(?![\d$])/g, function (match, prefix, formula) {
      store.push({ display: false, formula: formula });
      return prefix + NOTE_MATH_TOKEN + (store.length - 1) + '@@';
    });

    text = text.replace(/\\\(([\s\S]+?)\\\)/g, function (match, formula) {
      store.push({ display: false, formula: formula });
      return NOTE_MATH_TOKEN + (store.length - 1) + '@@';
    });

    return text;
  }

  function restoreNoteMath(html, store) {
    if (!store.length) return html;

    return String(html).replace(/@@ECHONOTE-MATH-(\d+)@@/g, function (match, index) {
      const item = store[Number(index)];
      if (!item) return '';
      const formula = escapeNoteHtml(String(item.formula).trim());
      return item.display ? '$$' + formula + '$$' : '$' + formula + '$';
    });
  }

  /* 笔记内容可能来自语音识别 / 大模型，插入 DOM 前统一做一次安全清理 */
  function sanitizeNoteHtml(html) {
    try {
      const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
      const body = doc.body;
      if (!body) return '';

      const blocked = body.querySelectorAll(NOTE_BLOCKED_TAGS.join(','));
      for (let i = 0; i < blocked.length; i += 1) blocked[i].remove();

      const nodes = body.querySelectorAll('*');
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const attrs = Array.prototype.slice.call(node.attributes);

        for (let j = 0; j < attrs.length; j += 1) {
          const name = String(attrs[j].name || '').toLowerCase();
          const value = String(attrs[j].value || '').replace(/[\s\u0000]+/g, '').toLowerCase();

          if (
            name.indexOf('on') === 0 ||
            name === 'srcdoc' ||
            ((name === 'href' || name === 'src' || name === 'xlink:href') && value.indexOf('javascript:') === 0)
          ) {
            node.removeAttribute(attrs[j].name);
          }
        }

        if (node.tagName === 'A' && node.getAttribute('href')) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }

      return body.innerHTML;
    } catch (error) {
      console.warn('[EchoNote] 笔记 HTML 安全清理失败：', error);
      return '';
    }
  }

  function renderNoteMarkdown(text) {
    const source = String(text === undefined || text === null ? '' : text);
    const markedLib = window.marked;

    // marked CDN 未加载时回退为纯文本，保证笔记依旧可读
    if (!markedLib || typeof markedLib.parse !== 'function') {
      return '<p>' + plainTextToHtml(source) + '</p>';
    }

    const mathStore = [];
    let prepared = source;

    try {
      prepared = protectNoteMath(source, mathStore);
    } catch (error) {
      mathStore.length = 0;
      prepared = source;
    }

    let html = '';
    try {
      html = markedLib.parse(prepared, { gfm: true, breaks: true, async: false });
    } catch (error) {
      console.warn('[EchoNote] Markdown 解析失败，已回退为纯文本：', error);
      return '<p>' + plainTextToHtml(source) + '</p>';
    }

    return restoreNoteMath(sanitizeNoteHtml(html), mathStore);
  }

  function hookNoteMathLoad() {
    if (noteMathLoadHooked) return;

    const script = document.getElementById('MathJax-script');
    if (!script) return;

    noteMathLoadHooked = true;
    script.addEventListener('load', function () {
      noteMathRetries = 0;
      typesetNoteMath();
    });
  }

  /* 把笔记卡片里的公式交给 MathJax；CDN 未就绪时自动重试，笔记页不可见时跳过 */
  function typesetNoteMath(container) {
    const view = document.getElementById('view-notes');
    if (view && !view.classList.contains('is-active')) return;

    const mathJax = window.MathJax;

    if (!mathJax || typeof mathJax.typesetPromise !== 'function') {
      hookNoteMathLoad();
      if (noteMathRetries >= NOTE_MATH_RETRY_LIMIT) return;
      noteMathRetries += 1;
      window.clearTimeout(noteMathTimer);
      noteMathTimer = window.setTimeout(function () { typesetNoteMath(container); }, 400);
      return;
    }

    noteMathRetries = 0;

    const targets = container
      ? [container]
      : Array.prototype.slice.call(document.querySelectorAll('[data-note-text]'));
    if (!targets.length) return;

    window.clearTimeout(noteMathTimer);
    noteMathTimer = window.setTimeout(function () {
      const runTypeset = function () {
        mathJax.typesetPromise(targets).catch(function (error) {
          console.warn('[EchoNote] 公式渲染失败：', error);
        });
      };

      if (mathJax.startup && mathJax.startup.promise) {
        mathJax.startup.promise.then(runTypeset, runTypeset);
      } else {
        runTypeset();
      }
    }, 60);
  }

  /* ---------- 图片上传：FileReader → Base64（大图先压缩，避免撑爆 localStorage） ---------- */
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('图片读取失败，请重试')); };
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片解析失败，请换一张试试')); };
      img.src = src;
    });
  }

  function prepareNoteImage(file) {
    return readFileAsDataUrl(file).then(function (dataUrl) {
      if (!dataUrl) throw new Error('图片读取失败，请重试');

      // 小图 / GIF 动图保持原样，避免画质与动画损失
      if (file.size <= NOTE_IMAGE_SKIP_COMPRESS_BYTES || /^image\/gif$/i.test(file.type)) {
        return dataUrl;
      }

      return loadImageElement(dataUrl).then(function (img) {
        const sourceWidth = img.naturalWidth || img.width;
        const sourceHeight = img.naturalHeight || img.height;
        const longest = Math.max(sourceWidth, sourceHeight);
        const scale = longest > NOTE_IMAGE_MAX_EDGE ? NOTE_IMAGE_MAX_EDGE / longest : 1;
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return dataUrl;

        // 透明 PNG 转 JPEG 时先铺白底，避免出现黑底
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL('image/jpeg', 0.86);
        return compressed && compressed.length < dataUrl.length ? compressed : dataUrl;
      }).catch(function () {
        return dataUrl;
      });
    });
  }

  function insertNoteMarkdown(input, markdown) {
    const value = input.value || '';
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;

    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before && !/\n$/.test(before) ? '\n\n' : '';
    const suffix = after ? (/\n/.test(after.charAt(0)) ? '\n' : '\n\n') : '\n';
    const inserted = prefix + markdown + suffix;

    input.value = before + inserted + after;

    const caret = (before + inserted).length;
    input.focus();
    try {
      input.setSelectionRange(caret, caret);
    } catch (error) { /* 忽略旧浏览器不支持的情况 */ }
  }

  /* ---------------- 同声传译页（Web Speech API / Whisper） ---------------- */
  function initSpeechPage() {
    const micBtn = $('#micBtn');
    if (!micBtn) return;

    const micWrap = $('#micWrap');
    const micStatus = $('#micStatus');
    const micHint = $('#micHint');
    const statusDot = $('#statusDot');
    const transcriptText = $('#transcriptText');
    const transcriptInterim = $('#transcriptInterim');
    const transcriptPlaceholder = $('#transcriptPlaceholder');
    const charCount = $('#charCount');
    const saveBtn = $('#saveNoteBtn');
    const translateBtn = $('#translateBtn');
    const clearBtn = $('#clearBtn');
    const aiPanel = $('#aiPanel');
    const aiContent = $('#aiContent');
    const aiPanelTitle = $('#aiPanelTitle');
    const copyTranscriptBtn = $('#copyTranscriptBtn');
    const copyTranslationBtn = $('#copyTranslationBtn');
    const targetSelect = $('#transcribeTargetSelect');
    const asrEngineBadge = $('#asrEngineBadge');

    /* 字幕流（边录边译） */
    const subtitleStream = $('#subtitleStream');
    const subtitleEmpty = $('#subtitleEmpty');
    const subtitleInterimEl = $('#subtitleInterim');
    const subtitleTemplate = $('#subtitleLineTemplate');
    const subtitleCount = $('#subtitleCount');
    const autoTranslateToggle = $('#autoTranslateToggle');
    const autoScrollToggle = $('#autoScrollToggle');

    /* 音频来源：麦克风 / 系统音频 */
    const sourceMicBtn = $('#sourceMicBtn');
    const sourceSystemBtn = $('#sourceSystemBtn');
    const audioSourceBadge = $('#audioSourceBadge');
    const sourceHint = $('#sourceHint');

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const speechSupported = Boolean(SpeechRecognitionCtor);
    const mediaSupported = isMediaRecordingSupported();

    let recognition = null;
    let listening = false;        // 用户期望的录音状态
    let recognitionRunning = false;
    let restartTimer = null;
    let restartAttempts = 0;
    let networkErrorCount = 0;
    let lastAsrError = '';
    let saveLabelTimer = null;
    let finalText = '';
    let interimText = '';
    let currentLang = getItem(STORAGE.SPEECH_LANG) || DEFAULT_SPEECH_LANG;

    /* Whisper（MediaRecorder）状态 */
    let asrEngine = readAsrEngine();
    let whisperRecorder = null;
    let whisperDurationTimer = null;
    let whisperStartedAt = 0;
    let whisperBusy = false;      // 正在上传转写，避免重复点击
    let whisperSession = 0;       // 录音会话编号，丢弃过期回调
    let translateInFlight = false;
    let micTipShown = false;

    /* 边录边译 · 字幕流状态 */
    let subtitleLines = [];
    let autoTranslateEnabled = getItem(STORAGE.AUTO_TRANSLATE) !== 'off';
    let autoScrollEnabled = true;

    /* 系统音频内录状态 */
    const SYSTEM_CHUNK_SECONDS = 8; // 每 8 秒切一段上传，接近实时
    let audioSource = getItem(STORAGE.AUDIO_SOURCE) === 'system' ? 'system' : 'mic';
    let systemStream = null;
    let systemRecorder = null;
    let systemTimer = null;
    let systemSession = 0;
    let systemActive = false;
    let systemRequesting = false;
    let systemStartedAt = 0;
    let systemQueue = Promise.resolve();
    let systemPending = 0;

    function setStatus(text, recording) {
      if (micStatus) micStatus.textContent = text;
      if (statusDot) {
        statusDot.className = recording
          ? 'h-2 w-2 rounded-full status-dot--recording'
          : 'h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500';
      }
    }

    function setRecordingUI(recording) {
      micBtn.classList.toggle('is-recording', recording);
      if (micWrap) micWrap.classList.toggle('is-recording', recording);
      micBtn.setAttribute('aria-pressed', String(recording));
    }

    function renderTranscript() {
      if (transcriptText) transcriptText.textContent = finalText;
      if (transcriptInterim) {
        const interim = interimText.trim();
        transcriptInterim.textContent = interim ? (finalText ? ' ' + interim : interim) : '';
      }

      if (subtitleInterimEl) {
        const liveInterim = interimText.trim();
        subtitleInterimEl.textContent = liveInterim;
        subtitleInterimEl.classList.toggle('hidden', !liveInterim);
      }

      const hasFinal = finalText.trim().length > 0;
      if (transcriptPlaceholder) {
        transcriptPlaceholder.classList.toggle('hidden', hasFinal || interimText.trim().length > 0);
      }
      if (charCount) charCount.textContent = finalText.length + ' 字符';

      if (saveBtn) saveBtn.disabled = !hasFinal;
      if (translateBtn) translateBtn.disabled = !hasFinal;
      if (clearBtn) clearBtn.disabled = !hasFinal && !interimText.trim();
      if (copyTranscriptBtn) copyTranscriptBtn.disabled = !hasFinal;
    }

    function appendChunk(base, chunk) {
      const piece = chunk.trim();
      if (!piece) return base;
      if (!base) return piece;
      return /[\s]$/.test(base) ? base + piece : base + ' ' + piece;
    }

    /* =========================================================
     * 边录边译 · 字幕流（时间戳 + 原文 + 译文 + 单句保存为笔记）
     * 每收到一条 isFinal 的识别结果，就用它自动调用大模型翻译。
     * ======================================================= */
    function zeroPad(value) {
      return ('0' + value).slice(-2);
    }

    function nowClock(date) {
      const d = date instanceof Date ? date : new Date();
      return zeroPad(d.getHours()) + ':' + zeroPad(d.getMinutes()) + ':' + zeroPad(d.getSeconds());
    }

    function updateSubtitleCount() {
      if (subtitleCount) subtitleCount.textContent = subtitleLines.length + ' 条';
      if (subtitleEmpty) subtitleEmpty.classList.toggle('hidden', subtitleLines.length > 0);
    }

    function scrollSubtitleToEnd() {
      if (!autoScrollEnabled || !subtitleStream) return;
      subtitleStream.scrollTop = subtitleStream.scrollHeight;
    }

    function buildSubtitleRow(line) {
      let row = null;

      if (subtitleTemplate && subtitleTemplate.content && subtitleTemplate.content.firstElementChild) {
        row = subtitleTemplate.content.firstElementChild.cloneNode(true);
      } else {
        row = document.createElement('div');
        row.className = 'subtitle-line flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-900/70';
        row.innerHTML = '<span class="mt-0.5 shrink-0 rounded-lg bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400" data-line-time></span>' +
          '<div class="min-w-0 flex-1"><p class="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400" data-line-original></p>' +
          '<p class="mt-1 hidden text-[15px] font-medium leading-relaxed text-slate-800 dark:text-slate-100" data-line-translated></p>' +
          '<p class="mt-1 hidden text-[11px] text-indigo-500 dark:text-indigo-300" data-line-status></p></div>' +
          '<button type="button" class="note-action shrink-0" data-line-save aria-label="保存这句为笔记">＋</button>';
      }

      row.dataset.lineId = line.id;

      const timeEl = row.querySelector('[data-line-time]');
      if (timeEl) {
        timeEl.textContent = line.clock;
        timeEl.setAttribute('title', line.at.toLocaleString('zh-CN'));
      }

      const originalEl = row.querySelector('[data-line-original]');
      if (originalEl) originalEl.textContent = line.original;

      const saveLineBtn = row.querySelector('[data-line-save]');
      if (saveLineBtn) {
        saveLineBtn.addEventListener('click', function () {
          saveSubtitleLine(line);
        });
      }

      return row;
    }

    function updateSubtitleLine(line) {
      if (!line || !line.el) return;

      const translatedEl = line.el.querySelector('[data-line-translated]');
      if (translatedEl) {
        translatedEl.textContent = line.translated;
        translatedEl.classList.toggle('hidden', !line.translated);
      }

      const statusEl = line.el.querySelector('[data-line-status]');
      if (statusEl) {
        statusEl.textContent = line.statusText;
        statusEl.classList.toggle('hidden', !line.statusText);
      }
    }

    /* 单句自动翻译：复用与大模型翻译相同的 requestTranslation 通道。
     * 用串行队列发送，避免一次涌入多句时并发请求触发限流。 */
    let subtitleTranslateChain = Promise.resolve();

    function translateSubtitleLine(line) {
      if (!line || line.translating || !line.original) return Promise.resolve(null);

      if (!readApiSettings().key) {
        line.statusText = '未保存 API Key，无法自动翻译';
        updateSubtitleLine(line);
        return Promise.resolve(null);
      }

      line.translating = true;
      line.statusText = '排队翻译…';
      updateSubtitleLine(line);

      subtitleTranslateChain = subtitleTranslateChain.then(function () {
        return requestSubtitleTranslation(line);
      }).catch(function () {
        return null;
      }).then(function (result) {
        line.translating = false;
        return result;
      });

      return subtitleTranslateChain;
    }

    function requestSubtitleTranslation(line) {
      if (!line || !line.original) return Promise.resolve(null);

      line.statusText = '翻译中…';
      updateSubtitleLine(line);

      const targetLang = getSelectedLanguage(targetSelect, '简体中文');
      const sourceLang = getSelectedLanguage(langSelect, currentLang);

      return requestTranslation(line.original, { targetLang: targetLang, sourceLang: sourceLang })
        .then(function (result) {
          line.translated = result && result.content ? String(result.content).trim() : '';
          line.statusText = '';
          updateSubtitleLine(line);
          scrollSubtitleToEnd();
          return result;
        })
        .catch(function (error) {
          line.statusText = '翻译失败：' + ((error && error.message) || '请稍后重试');
          updateSubtitleLine(line);
          return null;
        });
    }

    function pushSubtitleLine(original) {
      const text = String(original || '').trim();
      if (!text) return null;

      const line = {
        id: createId(),
        at: new Date(),
        clock: nowClock(),
        original: text,
        translated: '',
        statusText: '',
        translating: false,
        el: null
      };

      line.el = buildSubtitleRow(line);
      subtitleLines.push(line);

      if (subtitleStream) {
        if (subtitleEmpty && subtitleEmpty.parentNode === subtitleStream) {
          subtitleStream.removeChild(subtitleEmpty);
        }
        subtitleStream.appendChild(line.el);
      }

      // 超长会话时只保留最近 300 条，避免 DOM 无限增长
      while (subtitleLines.length > 300) {
        const dropped = subtitleLines.shift();
        if (dropped && dropped.el && dropped.el.parentNode) {
          dropped.el.parentNode.removeChild(dropped.el);
        }
      }

      updateSubtitleCount();
      scrollSubtitleToEnd();

      if (autoTranslateEnabled) translateSubtitleLine(line);
      return line;
    }

    /* 单句保存：{ timestamp, originalText, translatedText } */
    function saveSubtitleLine(line) {
      if (!line) return;

      const note = addNote(line.translated || line.original, 'speech', {
        originalText: line.original,
        translatedText: line.translated,
        createdAt: line.at.toISOString()
      });

      if (!note) {
        showToast('保存失败，请稍后重试', 'error');
        return;
      }

      showToast('已保存为笔记（含时间戳）', 'success');

      const btn = line.el ? line.el.querySelector('[data-line-save]') : null;
      if (btn) {
        btn.classList.add('text-emerald-500', 'dark:text-emerald-400');
        btn.setAttribute('title', '已保存');
      }
    }

    function clearSubtitleLines() {
      subtitleLines = [];
      if (subtitleStream) {
        subtitleStream.textContent = '';
        if (subtitleEmpty) subtitleStream.appendChild(subtitleEmpty);
      }
      updateSubtitleCount();
    }

    /* =========================================================
     * 系统音频内录：getDisplayMedia 抓标签页 / 窗口声音
     * → MediaRecorder 每 8 秒切一段 → Whisper 转写 → 字幕流
     * ======================================================= */
    function isSystemAudioSupported() {
      return Boolean(
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
        window.MediaRecorder
      );
    }

    function updateSourceUI() {
      const system = audioSource === 'system';

      if (sourceMicBtn) {
        sourceMicBtn.classList.toggle('is-active', !system);
        sourceMicBtn.setAttribute('aria-selected', String(!system));
      }
      if (sourceSystemBtn) {
        sourceSystemBtn.classList.toggle('is-active', system);
        sourceSystemBtn.setAttribute('aria-selected', String(system));
      }
      if (audioSourceBadge) audioSourceBadge.textContent = system ? '系统音频' : '麦克风';
      if (sourceHint) {
        sourceHint.textContent = system
          ? '系统音频：点击麦克风后选择要分享的标签页 / 窗口，并勾选「分享音频」。每 ' +
            SYSTEM_CHUNK_SECONDS + ' 秒自动转写一次（需 OpenAI Whisper API）。'
          : '麦克风：说一句识别一句，边录边译会实时给出译文。系统音频：捕获标签页 / 窗口的声音，需要 OpenAI Whisper。';
      }
      micBtn.classList.toggle('is-system-source', system);
    }

    function setAudioSource(next, announce) {
      const source = next === 'system' ? 'system' : 'mic';
      if (source === audioSource) return;

      if (source === 'system') {
        if (!isSystemAudioSupported()) {
          showToast('当前浏览器不支持系统音频内录，请使用最新版 Chrome / Edge 桌面端。', 'error');
          updateSourceUI();
          return;
        }
        if (asrEngine !== 'whisper') {
          showToast('系统音频需配合 Whisper API 使用：请先在「个人设置」把识别引擎切换为 OpenAI Whisper API。', 'error');
          updateSourceUI();
          return;
        }
        if (!readApiSettings().key) {
          showToast('系统音频转写需要 OpenAI API Key，请先在「个人设置」保存。', 'error');
          updateSourceUI();
          return;
        }
      }

      if (listening) {
        if (audioSource === 'system') stopSystemCapture();
        else stopListening();
      }

      audioSource = source;
      setItem(STORAGE.AUDIO_SOURCE, source);
      updateSourceUI();
      refreshMicAvailability();

      if (announce) {
        showToast(source === 'system' ? '已切换到系统音频内录' : '已切换到麦克风', 'success');
      }
    }

    function systemClock() {
      const seconds = Math.floor((Date.now() - systemStartedAt) / 1000);
      return zeroPad(Math.floor(seconds / 60)) + ':' + zeroPad(seconds % 60);
    }

    function stopSystemTimer() {
      if (systemTimer) {
        window.clearInterval(systemTimer);
        systemTimer = null;
      }
    }

    function startSystemTimer() {
      stopSystemTimer();
      systemTimer = window.setInterval(function () {
        if (!systemActive) return;
        setStatus('正在录制系统音频 · ' + systemClock() + ' · 每 ' + SYSTEM_CHUNK_SECONDS + ' 秒转写一次', true);
      }, 1000);
    }

    function releaseSystemStream() {
      if (!systemStream) return;
      systemStream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (error) { /* 忽略 */ }
      });
      systemStream = null;
    }

    function startSystemCapture() {
      if (systemActive || systemRequesting) return;

      if (!isSystemAudioSupported()) {
        showToast('当前浏览器不支持系统音频内录，请使用最新版 Chrome / Edge。', 'error');
        return;
      }

      if (asrEngine !== 'whisper') {
        showToast('系统音频需配合 Whisper API 使用：请先在「个人设置」把识别引擎切换为 OpenAI Whisper API。', 'error');
        return;
      }

      if (!readApiSettings().key) {
        showToast('系统音频转写需要 OpenAI API Key，请先在「个人设置」保存。', 'error');
        window.location.hash = '#profile';
        return;
      }

      // 通知其他视图的麦克风先停止
      document.dispatchEvent(new CustomEvent('echonote:stop-mic'));
      setStatus('请选择要分享的标签页 / 窗口，并勾选「分享音频」…', false);

      systemRequesting = true;

      navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        }
      }).then(function (stream) {
        systemRequesting = false;

        // 授权期间用户已切回麦克风：丢弃这次分享
        if (audioSource !== 'system') {
          stream.getTracks().forEach(function (track) {
            try { track.stop(); } catch (error) { /* 忽略 */ }
          });
          setStatus('已切换到麦克风，未开始录制系统音频', false);
          return;
        }

        const audioTracks = stream.getAudioTracks();

        if (!audioTracks.length) {
          stream.getTracks().forEach(function (track) {
            try { track.stop(); } catch (error) { /* 忽略 */ }
          });
          showToast('没有捕获到音频：请在分享弹窗选择「标签页」并勾选「分享标签页音频」，或选择整个屏幕并勾选「分享系统音频」。', 'error');
          setStatus('未捕获到系统音频，点击可重试', false);
          return;
        }

        // 用户点击浏览器底部的「停止共享」
        audioTracks.forEach(function (track) {
          track.addEventListener('ended', function () {
            if (!systemActive) return;
            showToast('系统音频共享已结束，正在停止录制。', 'info');
            stopSystemCapture();
          });
        });

        systemStream = stream;
        systemSession += 1;
        systemActive = true;
        listening = true;
        systemStartedAt = Date.now();
        systemPending = 0;
        systemQueue = Promise.resolve();

        setRecordingUI(true);
        setStatus('正在录制系统音频 · 00:00 · 再次点击结束', true);
        startSystemTimer();

        recordSystemChunk(systemSession);
      }).catch(function (error) {
        systemRequesting = false;
        const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        showToast(denied
          ? '已取消分享，未开始录制系统音频。'
          : '无法捕获系统音频：' + ((error && error.message) || '未知错误'), 'error');
        setStatus('系统音频不可用，点击可重试', false);
      });
    }

    /* 分段录音：每段独立 MediaRecorder（各自带完整容器头，Whisper 可解码） */
    function recordSystemChunk(session) {
      if (!systemActive || session !== systemSession || !systemStream) return;

      const liveTracks = systemStream.getAudioTracks().filter(function (track) {
        return track.readyState === 'live';
      });

      if (!liveTracks.length) {
        stopSystemCapture();
        return;
      }

      let recorder = null;
      const chunkStream = new MediaStream(liveTracks);
      const mimeType = pickAudioMimeType();

      try {
        recorder = mimeType
          ? new MediaRecorder(chunkStream, { mimeType: mimeType, audioBitsPerSecond: 128000 })
          : new MediaRecorder(chunkStream);
      } catch (error) {
        try {
          recorder = new MediaRecorder(chunkStream);
        } catch (fallbackError) {
          showToast('无法创建录音器（MediaRecorder），请更换 Chrome / Edge 重试。', 'error');
          stopSystemCapture();
          return;
        }
      }

      systemRecorder = recorder;
      const chunks = [];

      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = function () {
        if (systemRecorder === recorder) systemRecorder = null;

        if (chunks.length) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size > 4000) queueSystemChunk(blob);
        }

        // 继续下一段；用户停止时不再重启
        if (systemActive && session === systemSession) {
          window.setTimeout(function () {
            recordSystemChunk(session);
          }, 80);
        }
      };

      try {
        recorder.start();
      } catch (error) {
        showToast('录音启动失败，请重试。', 'error');
        stopSystemCapture();
        return;
      }

      window.setTimeout(function () {
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (error) { /* 忽略 */ }
        }
      }, SYSTEM_CHUNK_SECONDS * 1000);
    }

    /* 排队上传，避免同时打多个 Whisper 请求 */
    function queueSystemChunk(blob) {
      if (systemPending >= 3) return; // 积压过多时丢弃，保证「实时」
      systemPending += 1;

      systemQueue = systemQueue.then(function () {
        return transcribeSystemChunk(blob);
      }).catch(function () {
        /* 单段失败不影响后续 */
      }).then(function () {
        systemPending = Math.max(0, systemPending - 1);
      });
    }

    function transcribeSystemChunk(blob) {
      return transcribeWithWhisper(blob, { lang: currentLang }).then(function (text) {
        const piece = String(text || '').trim();
        if (!piece) return null;

        finalText = appendChunk(finalText, piece);
        renderTranscript();
        pushSubtitleLine(piece);
        return piece;
      }).catch(function (error) {
        if (error && error.code === 'NO_KEY') {
          showToast('Whisper 需要 OpenAI API Key，请先在「个人设置」保存。', 'error');
          stopSystemCapture();
        }
        return null;
      });
    }

    function stopSystemCapture() {
      if (!systemActive && !systemStream) return;

      systemActive = false;
      listening = false;
      systemSession += 1;
      stopSystemTimer();
      setRecordingUI(false);

      const recorder = systemRecorder;
      systemRecorder = null;
      if (recorder) {
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch (error) {
          /* 忽略 */
        }
      }

      releaseSystemStream();
      setStatus('系统音频已停止 · 正在完成最后一段转写…', false);
      refreshMicAvailability();

      systemQueue.then(function () {
        if (listening) return;
        setStatus('已停止，点击可继续', false);
      });
    }

    /* ---- 音频来源 / 边录边译 / 自动滚动 ---- */
    if (sourceMicBtn) {
      sourceMicBtn.addEventListener('click', function () {
        setAudioSource('mic', true);
      });
    }

    if (sourceSystemBtn) {
      sourceSystemBtn.addEventListener('click', function () {
        setAudioSource('system', true);
      });
    }

    if (autoTranslateToggle) {
      autoTranslateToggle.checked = autoTranslateEnabled;
      autoTranslateToggle.addEventListener('change', function () {
        autoTranslateEnabled = autoTranslateToggle.checked;
        setItem(STORAGE.AUTO_TRANSLATE, autoTranslateEnabled ? 'on' : 'off');
        showToast(autoTranslateEnabled ? '边录边译已开启' : '边录边译已关闭', 'success');

        if (!autoTranslateEnabled) return;
        // 关闭期间产生的字幕：打开后补翻
        subtitleLines.forEach(function (line) {
          if (!line.translated) translateSubtitleLine(line);
        });
      });
    }

    if (autoScrollToggle) {
      autoScrollToggle.checked = autoScrollEnabled;
      autoScrollToggle.addEventListener('change', function () {
        autoScrollEnabled = autoScrollToggle.checked;
      });
    }

    // 上次用的是系统音频，但引擎 / 浏览器已不支持：自动退回麦克风
    if (audioSource === 'system' && (!isSystemAudioSupported() || asrEngine !== 'whisper')) {
      audioSource = 'mic';
      setItem(STORAGE.AUDIO_SOURCE, 'mic');
    }

    updateSourceUI();
    updateSubtitleCount();

    function stopWhisperTimer() {
      if (whisperDurationTimer) {
        window.clearInterval(whisperDurationTimer);
        whisperDurationTimer = null;
      }
    }

    function stopListening() {
      if (audioSource === 'system') {
        stopSystemCapture();
        return;
      }

      listening = false;
      networkErrorCount = 0;
      if (restartTimer) {
        window.clearTimeout(restartTimer);
        restartTimer = null;
      }
      setRecordingUI(false);

      // Whisper 模式：停止录音后由 onstop 自动上传转写
      if (asrEngine === 'whisper') {
        stopWhisperTimer();
        const stopped = whisperRecorder ? whisperRecorder.stop() : false;
        if (stopped) {
          setStatus('录音结束，正在上传 Whisper 转写…', false);
        } else {
          setStatus('已停止，点击可继续', false);
        }
        return;
      }

      setStatus('已停止，点击可继续', false);
      if (recognition) {
        try {
          recognition.stop();
        } catch (error) {
          /* 忽略重复停止 */
        }
      }

      // 兜底：极端情况下 onend 不触发，避免一直判定为「正在识别」
      window.setTimeout(function () { recognitionRunning = false; }, 800);
    }

    function startListening() {
      if (micTipShown === false) {
        micTipShown = true;
        showToast(audioSource === 'system'
          ? '点击后会弹出分享窗口，请选择标签页 / 窗口并勾选「分享音频」。'
          : '请靠近麦克风说话，并保持环境安静。', 'info');
      }

      if (audioSource === 'system') {
        startSystemCapture();
        return;
      }

      if (asrEngine === 'whisper') {
        startWhisperRecording();
        return;
      }

      if (!speechSupported) {
        showToast('当前浏览器不支持 Web Speech，请在「个人设置」切换到 OpenAI Whisper API。', 'error');
        return;
      }

      if (!recognition) recognition = createRecognition();
      // 通知其他视图的麦克风先停止，保证同一时间只有一个识别实例
      document.dispatchEvent(new CustomEvent('echonote:stop-mic'));
      listening = true;
      lastAsrError = '';
      setRecordingUI(true);
      setStatus('正在聆听…（再次点击停止）', true);
      attemptRecognitionStart(true);
    }

    function attemptRecognitionStart(isFirst) {
      if (!recognition || !listening || asrEngine !== 'browser') return;

      if (recognitionRunning) {
        // 上一个实例还没结束（例如网络错误后尚未触发 onend）：必要时强制收尾后重连
        if (lastAsrError) {
          try { recognition.abort(); } catch (error) { /* 忽略 */ }
          recognitionRunning = false;
        }
        scheduleRestart(300);
        return;
      }

      try {
        recognition.start();
      } catch (error) {
        // InvalidStateError：识别已在进行中，标记状态即可
        if (error && error.name === 'InvalidStateError') {
          recognitionRunning = true;
          return;
        }

        console.warn('[EchoNote] 启动识别失败：', error);
        if (isFirst) showToast('语音识别启动失败，正在自动重试…', 'error');
        scheduleRestart(900);
      }
    }

    // 静默 / 网络异常后延迟重启，间隔逐次加大，避免疯狂重连
    function scheduleRestart(delay) {
      if (restartTimer || !listening || asrEngine !== 'browser') return;
      const wait = typeof delay === 'number' ? delay : Math.min(300 + restartAttempts * 400, 4000);
      restartAttempts += 1;

      restartTimer = window.setTimeout(function () {
        restartTimer = null;
        if (!listening || asrEngine !== 'browser') return;
        attemptRecognitionStart(false);
      }, wait);
    }

    /* ---- 引擎 UI / 麦克风可用性 ---- */
    function updateEngineUI() {
      const whisper = asrEngine === 'whisper';

      if (asrEngineBadge) {
        asrEngineBadge.textContent = whisper ? 'Whisper 转写' : '浏览器识别';
        asrEngineBadge.className = whisper
          ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
          : 'rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300';
      }

      if (micHint) {
        micHint.textContent = whisper
          ? 'Whisper 模式：点击开始录音，再次点击结束并上传转写。请靠近麦克风说话，并保持环境安静；单次最长 ' +
            Math.round(WHISPER_MAX_SECONDS / 60) + ' 分钟。'
          : '请靠近麦克风说话，并保持环境安静。需要麦克风权限，且只能在 HTTPS 或 localhost 环境下使用（推荐 Chrome / Edge）。';
      }
    }

    function refreshMicAvailability() {
      const system = audioSource === 'system';
      const whisper = asrEngine === 'whisper';
      const supported = system
        ? isSystemAudioSupported()
        : (whisper ? mediaSupported : speechSupported);

      micBtn.disabled = !supported || whisperBusy;

      if (!supported) {
        setStatus(system
          ? '当前浏览器不支持系统音频内录'
          : (whisper ? '当前浏览器不支持录音（MediaRecorder）' : '当前浏览器不支持语音识别'), false);
        return;
      }

      if (!listening && !whisperBusy) {
        setStatus('准备就绪，点击开始录音', false);
      }
    }

    /* ---- Whisper：录音 → 上传转写 → 自动翻译 ---- */
    function startWhisperTimer() {
      stopWhisperTimer();

      whisperDurationTimer = window.setInterval(function () {
        const seconds = Math.floor((Date.now() - whisperStartedAt) / 1000);
        const mm = ('0' + Math.floor(seconds / 60)).slice(-2);
        const ss = ('0' + (seconds % 60)).slice(-2);

        setStatus('正在录音（Whisper）· ' + mm + ':' + ss + ' · 再次点击结束', true);

        if (seconds >= WHISPER_MAX_SECONDS) {
          showToast('已达到单次 ' + Math.round(WHISPER_MAX_SECONDS / 60) + ' 分钟上限，自动结束并转写。', 'info');
          stopListening();
        }
      }, 500);
    }

    function startWhisperRecording() {
      if (whisperBusy) return;

      if (!mediaSupported) {
        showToast('当前浏览器不支持录音，请使用最新版 Chrome / Edge。', 'error');
        return;
      }

      if (!readApiSettings().key) {
        showToast('Whisper 需要 OpenAI API Key，请先在「个人设置」保存', 'error');
        window.location.hash = '#profile';
        return;
      }

      // 通知其他视图的麦克风先停止
      document.dispatchEvent(new CustomEvent('echonote:stop-mic'));

      const session = whisperSession + 1;
      whisperSession = session;

      listening = true;
      interimText = '';
      setRecordingUI(true);
      setStatus('正在录音（Whisper）…再次点击结束并转写', true);
      renderTranscript();

      whisperRecorder = createWhisperRecorder({
        onStart: function () {
          if (session !== whisperSession) return;
          whisperStartedAt = Date.now();
          startWhisperTimer();
        },
        onStop: function (blob) {
          if (session !== whisperSession) return;
          stopWhisperTimer();
          listening = false;
          setRecordingUI(false);
          handleWhisperAudio(blob);
        },
        onError: function (error) {
          if (session !== whisperSession) return;
          stopWhisperTimer();
          listening = false;
          setRecordingUI(false);
          whisperBusy = false;
          showToast('录音失败：' + (error && error.message ? error.message : '请检查麦克风'), 'error');
          refreshMicAvailability();
          setStatus('录音失败，点击可重试', false);
        }
      });

      whisperRecorder.start().catch(function (error) {
        if (session !== whisperSession) return;
        listening = false;
        whisperBusy = false;
        stopWhisperTimer();
        setRecordingUI(false);

        const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        showToast(denied
          ? '麦克风权限被拒绝，请在浏览器地址栏的权限设置中允许使用麦克风。'
          : '无法启动录音：' + (error && error.message ? error.message : '未知错误'), 'error');
        refreshMicAvailability();
        setStatus('麦克风不可用，点击可重试', false);
      });
    }

    function cancelWhisperRecording() {
      whisperSession += 1;
      listening = false;
      stopWhisperTimer();
      if (whisperRecorder) whisperRecorder.cancel();
      whisperRecorder = null;
      setRecordingUI(false);
      setStatus('已停止，点击可继续', false);
    }

    async function handleWhisperAudio(blob) {
      whisperBusy = true;
      micBtn.disabled = true;
      setStatus('Whisper 正在转写…（通常 2-5 秒）', false);

      let ok = false;

      try {
        const text = await transcribeWithWhisper(blob, { lang: currentLang });
        finalText = appendChunk(finalText, text);
        interimText = '';
        renderTranscript();
        ok = true;
        showToast('Whisper 转写完成，正在自动翻译…', 'success');
        await runTranslation({ auto: true });
      } catch (error) {
        interimText = '';
        renderTranscript();

        if (error && error.code === 'NO_KEY') {
          showToast('Whisper 需要 OpenAI API Key，请先在「个人设置」保存。', 'error');
        } else {
          showToast((error && error.message) || 'Whisper 转写失败，请稍后重试', 'error');
        }
      } finally {
        whisperBusy = false;
        refreshMicAvailability();
        if (!listening) {
          setStatus(ok ? '转写完成，点击可继续录音' : '转写失败，点击可重新录音', false);
        }
      }
    }

    function createRecognition() {
      const rec = new SpeechRecognitionCtor();
      rec.lang = currentLang;       // 跟随下拉框选择的语言 / 口音
      rec.continuous = true;        // 连续识别
      rec.interimResults = true;    // 实时返回临时结果
      rec.maxAlternatives = 3;      // 多给几个候选，挑置信度最高的一个

      rec.onstart = function () {
        recognitionRunning = true;
        restartAttempts = 0;
        lastAsrError = '';
        setRecordingUI(true);
        setStatus('正在聆听…（再次点击停止）', true);
      };

      rec.onresult = function (event) {
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];

          // 最终结果在多候选中选置信度最高的，减少同音词错误
          let best = result[0];
          if (result.isFinal && result.length > 1) {
            for (let j = 1; j < result.length; j += 1) {
              const alt = result[j];
              if (!alt) continue;
              if (!best || (alt.confidence || 0) > (best.confidence || 0)) best = alt;
            }
          }

          const piece = best ? best.transcript : '';

          if (result.isFinal) {
            finalText = appendChunk(finalText, piece);
            // 边录边译：每收到一条最终结果就写入字幕流并自动翻译
            pushSubtitleLine(piece);
            // 成功收到文字：重置重连计数与网络错误计数
            restartAttempts = 0;
            networkErrorCount = 0;
            lastAsrError = '';
          } else {
            interim += piece;
          }
        }

        interimText = interim;
        renderTranscript();
      };

      rec.onerror = function (event) {
        const code = (event && event.error) || 'unknown';
        if (code === 'aborted') return;

        // 可恢复错误：不终止录音，交给 onend / scheduleRestart 自动重连
        if (code === 'no-speech' || code === 'network') {
          lastAsrError = code;

          if (code === 'network') {
            networkErrorCount += 1;
            if (networkErrorCount >= 6) {
              showToast('语音识别服务连续网络异常，已暂停。请检查网络后重新开始。', 'error');
              stopListening();
              return;
            }
            setStatus('网络波动，正在自动重连…（第 ' + networkErrorCount + ' 次）', true);
            scheduleRestart(Math.min(600 * networkErrorCount, 4000));
          } else {
            setStatus('等待语音…（保持麦克风开启，会自动继续）', true);
            scheduleRestart(300);
          }
          return;
        }

        const tips = {
          'not-allowed': '麦克风权限被拒绝，请在浏览器的权限设置中允许使用麦克风。',
          'service-not-allowed': '当前环境不允许语音识别，请使用 HTTPS 或 localhost 打开页面。',
          'audio-capture': '没有检测到可用的麦克风设备。',
          language: '浏览器不支持当前识别语言（' + currentLang + '），请更换语言或使用 Chrome / Edge。',
          'language-not-supported': '浏览器不支持当前识别语言（' + currentLang + '），请更换语言或使用 Chrome / Edge。'
        };

        showToast(tips[code] || ('识别出错：' + code), 'error');
        stopListening();
      };

      rec.onend = function () {
        recognitionRunning = false;
        interimText = '';
        renderTranscript();

        if (!listening || asrEngine !== 'browser') {
          setRecordingUI(false);
          if (asrEngine === 'browser') setStatus('已停止，点击可继续', false);
          return;
        }

        // 浏览器在静默 / 网络抖动后会自动结束识别：自动重启以保持连续识别
        if (lastAsrError === 'network') {
          setStatus('网络波动，正在自动重连…', true);
        } else {
          setStatus('正在聆听…（再次点击停止）', true);
        }
        scheduleRestart();
      };

      return rec;
    }

    /* ---- 同传多语种 / 多口音：实时切换识别语言 ---- */
    const langSelect = $('#languageSelect');
    const langBadge = $('#langBadge');
    const transcriptLang = $('#transcriptLang');

    function findLanguageOption(value) {
      if (!langSelect) return null;
      const options = langSelect.options;
      for (let i = 0; i < options.length; i += 1) {
        if (options[i].value === value) return options[i];
      }
      return null;
    }

    function getLanguageLabel(value) {
      const option = findLanguageOption(value);
      return option ? option.textContent : value;
    }

    function syncLanguageUI() {
      if (langSelect) langSelect.value = currentLang;
      if (langBadge) langBadge.textContent = currentLang;
      if (transcriptLang) transcriptLang.textContent = currentLang;
    }

    function applyLanguage(value, announce) {
      currentLang = value || DEFAULT_SPEECH_LANG;

      // 动态赋值给 SpeechRecognition.lang
      if (recognition) recognition.lang = currentLang;
      setItem(STORAGE.SPEECH_LANG, currentLang);

      if (asrEngine === 'whisper') {
        // 录音中切换语言：丢弃当前录音，避免整段音频用错语言
        if (listening) cancelWhisperRecording();
        syncLanguageUI();
        if (announce) showToast('识别语言已切换：' + getLanguageLabel(currentLang), 'success');
        return;
      }

      // 正在识别时先停止：onend 里会用新语言自动重启，实现实时切换
      if (listening && recognition) {
        try {
          recognition.stop();
        } catch (error) {
          /* 忽略重复停止 */
        }
      }

      syncLanguageUI();

      if (announce) {
        showToast('识别语言已切换：' + getLanguageLabel(currentLang), 'success');
      }
    }

    if (langSelect) {
      const savedLang = getItem(STORAGE.SPEECH_LANG);
      if (savedLang && findLanguageOption(savedLang)) currentLang = savedLang;

      if (!findLanguageOption(currentLang)) {
        currentLang = DEFAULT_SPEECH_LANG;
      }

      syncLanguageUI();

      langSelect.addEventListener('change', function () {
        applyLanguage(langSelect.value, true);
      });
    }

    updateEngineUI();
    refreshMicAvailability();

    if (!speechSupported && !mediaSupported) {
      micBtn.disabled = true;
      setStatus('当前浏览器不支持语音识别', false);
      if (micHint) {
        micHint.textContent = '请使用最新版 Chrome / Edge 桌面端，并确保页面运行在 HTTPS 或 localhost 下。';
      }
      renderTranscript();
      showToast('当前浏览器既不支持 Web Speech 也不支持 MediaRecorder，请更换 Chrome / Edge。', 'error');
      return;
    }

    micBtn.addEventListener('click', function () {
      if (listening) stopListening();
      else startListening();
    });

    // 其他页面（语音翻译 / 对话模式）开始录音时，自动停止本页麦克风
    document.addEventListener('echonote:stop-mic', function () {
      if (!listening) return;
      // Whisper 模式下也会正常结束并转写，避免丢失已经说过的内容
      stopListening();
    });

    // 「个人设置」切换识别引擎后立即生效
    document.addEventListener('echonote:asr-engine-changed', function () {
      const next = readAsrEngine();
      if (next === asrEngine) {
        updateEngineUI();
        return;
      }

      if (listening) {
        if (audioSource === 'system') stopSystemCapture();
        else if (asrEngine === 'whisper') cancelWhisperRecording();
        else stopListening();
      }

      asrEngine = next;
      updateEngineUI();

      // 系统音频依赖 Whisper，引擎切走后自动退回麦克风
      if (next !== 'whisper' && audioSource === 'system') {
        if (systemActive) stopSystemCapture();
        audioSource = 'mic';
        setItem(STORAGE.AUDIO_SOURCE, 'mic');
        updateSourceUI();
        showToast('系统音频需要 Whisper 转写，已自动切回麦克风。', 'info');
      }

      refreshMicAvailability();

      if (!listening && !whisperBusy) {
        setStatus('已切换识别引擎，点击开始录音', false);
      }
      renderTranscript();
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        const text = finalText.trim();
        if (!text) {
          showToast('还没有可保存的内容', 'error');
          return;
        }
        if (!addNote(text, 'speech')) return;

        showToast('已保存到笔记', 'success');

        const saveLabel = $('#saveNoteLabel');
        if (!saveLabel) return;
        saveLabel.textContent = '已保存 ✓';
        if (saveLabelTimer) window.clearTimeout(saveLabelTimer);
        saveLabelTimer = window.setTimeout(function () {
          saveLabel.textContent = '保存到笔记';
        }, 1600);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (listening) {
          if (audioSource === 'system') stopSystemCapture();
          else if (asrEngine === 'whisper') cancelWhisperRecording();
        }

        finalText = '';
        interimText = '';
        clearSubtitleLines();
        renderTranscript();
        if (aiPanel) aiPanel.classList.add('hidden');
        if (aiContent) aiContent.textContent = '';
        if (copyTranslationBtn) copyTranslationBtn.disabled = true;
        showToast('已清空识别结果', 'success');
      });
    }

    /* ---- 一键复制：识别结果 / 译文 ---- */
    if (copyTranscriptBtn) {
      copyTranscriptBtn.addEventListener('click', function () {
        copyText(finalText, '识别结果已复制');
      });
    }

    if (copyTranslationBtn) {
      copyTranslationBtn.addEventListener('click', function () {
        copyText(aiContent ? aiContent.textContent : '', '译文已复制');
      });
    }

    /* 统一翻译入口：手动点击 / Whisper 转写完成后自动调用 */
    function runTranslation(options) {
      const opts = options || {};
      const auto = Boolean(opts.auto);
      const text = finalText.trim();

      if (!text) {
        if (!auto) showToast('还没有可翻译的内容', 'error');
        return Promise.resolve(null);
      }

      if (translateInFlight) return Promise.resolve(null);

      if (!readApiSettings().key) {
        if (auto) {
          showToast('内容已转写，但还没有 API Key，暂时无法自动翻译', 'error');
        } else {
          showToast('请先在「个人设置」保存 API Key', 'error');
          window.location.hash = '#profile';
        }
        return Promise.resolve(null);
      }

      const translateLabel = $('#translateLabel');
      const originalLabel = translateLabel ? translateLabel.textContent : 'AI 翻译 · 术语润色';
      const targetLang = getSelectedLanguage(targetSelect, '简体中文');
      const sourceLang = getSelectedLanguage(langSelect, currentLang);

      translateInFlight = true;
      if (translateBtn) {
        translateBtn.disabled = true;
        translateBtn.classList.add('is-loading');
      }
      if (translateLabel) translateLabel.textContent = '翻译中…';

      return requestTranslation(text, { targetLang: targetLang, sourceLang: sourceLang })
        .then(function (result) {
          if (aiContent) aiContent.textContent = result.content;
          if (aiPanelTitle) {
            aiPanelTitle.textContent = 'AI 翻译结果 · ' + result.providerLabel + ' · ' + targetLang;
          }
          if (aiPanel) aiPanel.classList.remove('hidden');
          if (copyTranslationBtn) copyTranslationBtn.disabled = false;
          showToast('翻译完成', 'success');
          return result;
        })
        .catch(function (error) {
          if (aiPanel) aiPanel.classList.add('hidden');
          if (error && error.code === 'NO_KEY') {
            showToast('请先在「个人设置」保存 API Key', 'error');
            if (!auto) window.location.hash = '#profile';
          } else {
            showToast((error && error.message) || '请求失败，请稍后重试', 'error');
          }
          return null;
        })
        .then(function (result) {
          translateInFlight = false;
          if (translateLabel) translateLabel.textContent = originalLabel;
          if (translateBtn) {
            translateBtn.classList.remove('is-loading');
            translateBtn.disabled = finalText.trim().length === 0;
          }
          return result;
        });
    }

    if (translateBtn) {
      translateBtn.addEventListener('click', function () {
        runTranslation();
      });
    }

    renderTranscript();

  }

  /* =========================================================
   * 笔记导出 / 分享
   * ---------------------------------------------------------
   * 1. shareNotes()        ：拼接全部笔记 → 原生分享面板 / 剪贴板
   * 2. exportNotesToPdf()  ：克隆 #noteList → html2pdf.js 导出 PDF
   * 两个按钮都在笔记页顶部工具栏（#shareNotesBtn / #exportPdfBtn）
   * ======================================================= */

  const NOTES_PDF_STAGE_ID = 'notesPdfStage';
  const NOTES_PDF_OVERLAY_ID = 'notesPdfOverlay';
  const NOTES_PDF_STYLE_ID = 'notesPdfStyle';
  let notesPdfExporting = false;

  /* 分享用的纯文本：去掉 Base64 图片的冗长数据，只保留 [图片] 占位 */
  function noteTextToPlain(text) {
    return String(text || '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, function (match, alt) {
        const label = String(alt || '').trim();
        return label ? '[图片：' + label + ']' : '[图片]';
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1（$2）')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  /* 把所有笔记拼成格式清晰的纯文本（系统分享面板 / 微信粘贴都能直接读） */
  function notesToShareText(notes) {
    const list = Array.isArray(notes) ? notes : [];
    const now = new Date();
    const pad2 = function (value) { return ('0' + value).slice(-2); };
    const stamp = now.getFullYear() + '/' + pad2(now.getMonth() + 1) + '/' + pad2(now.getDate()) +
      ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());

    const lines = [];
    lines.push("Rylan's note · 我的笔记");
    lines.push(stamp + ' · 共 ' + list.length + ' 条笔记');
    lines.push('————————————');

    list.forEach(function (note, index) {
      const source = note.source === 'speech' ? '语音传译' : '手动输入';
      const original = note.originalText && note.originalText !== note.text ? note.originalText : '';

      lines.push('');
      lines.push('【' + (index + 1) + '】' + formatDateTime(note.createdAt) + ' · ' + source);

      if (original) {
        lines.push('原文：' + noteTextToPlain(original));
        lines.push('译文：' + noteTextToPlain(note.text));
      } else {
        lines.push(noteTextToPlain(note.text));
      }
    });

    lines.push('');
    lines.push('————————————');
    lines.push("来自 Rylan's note · 笔记只保存在本机浏览器");
    return lines.join('\n');
  }

  /* 一键分享：手机端调起原生面板（可选微信），电脑端退回剪贴板 */
  function shareNotes() {
    const notes = loadNotes();
    if (!notes.length) {
      showToast('还没有笔记可以分享', 'error');
      return;
    }

    const text = notesToShareText(notes);

    if (typeof navigator.share === 'function') {
      try {
        navigator.share({ title: "Rylan's note", text: text }).then(function () {
          showToast('已调起系统分享面板', 'success');
        }).catch(function (error) {
          // 用户主动取消分享时不需要任何提示
          if (error && error.name === 'AbortError') return;
          // 支持 share 但当前环境（非 HTTPS / 无权限）不可用时，退回剪贴板
          copyText(text, '内容已复制，快去微信粘贴吧！');
        });
        return;
      } catch (error) {
        // 个别浏览器会在调用时直接抛错，降到剪贴板
        console.warn('[EchoNote] 系统分享面板不可用：', error);
      }
    }

    copyText(text, '内容已复制，快去微信粘贴吧！');
  }

  /* 导出 PDF 需要的样式：白底、深色文字、隐藏操作按钮，并保留分页规则 */
  function ensureNotesPdfStyles() {
    if (document.getElementById(NOTES_PDF_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = NOTES_PDF_STYLE_ID;
    style.textContent = [
      '.notes-pdf-stage { position: fixed; top: 0; left: 0; width: 794px; box-sizing: border-box;',
      '  padding: 36px 34px 44px; /* 临时内边距，让 PDF 留白更舒服 */',
      '  background: #ffffff !important; color: #1e293b !important; z-index: 2147483000; overflow: visible;',
      '  font-family: Inter, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }',
      '.notes-pdf-head { margin: 0 0 18px; padding-bottom: 14px; border-bottom: 2px solid #e0e7ff; }',
      '.notes-pdf-brand { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #6366f1 !important; }',
      '.notes-pdf-title { margin: 6px 0 0; font-size: 26px; font-weight: 700; line-height: 1.25; color: #0f172a !important; }',
      '.notes-pdf-meta { margin: 6px 0 0; font-size: 12px; color: #64748b !important; }',
      '.notes-pdf-list { margin: 0 !important; padding: 0 !important; list-style: none !important; border: 0 !important; }',
      '.notes-pdf-list .note-item { margin: 0 0 12px !important; padding: 16px 18px !important;',
      '  border: 1px solid #e2e8f0 !important; border-radius: 14px !important; background: #ffffff !important;',
      '  box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; }',
      '.notes-pdf-stage [data-note-clock], .notes-pdf-stage [data-note-date] { color: #4f46e5 !important; }',
      '.notes-pdf-stage [data-note-icon] { background: #eef2ff !important; color: #4f46e5 !important; }',
      '.notes-pdf-stage [data-note-original], .notes-pdf-stage [data-note-time], .notes-pdf-stage [data-note-source] { color: #64748b !important; }',
      '.notes-pdf-stage [data-note-source] { background: #f1f5f9 !important; }',
      '.notes-pdf-stage [data-note-text], .notes-pdf-stage .note-markdown { color: #1f2937 !important; }',
      '.notes-pdf-stage .note-markdown h1, .notes-pdf-stage .note-markdown h2, .notes-pdf-stage .note-markdown h3, .notes-pdf-stage .note-markdown h4 { color: #0f172a !important; }',
      '.notes-pdf-stage .note-markdown strong { color: #111827 !important; }',
      '.notes-pdf-stage .note-markdown a { color: #4338ca !important; }',
      '.notes-pdf-stage .note-markdown code { background: #f1f5f9 !important; color: #4338ca !important; }',
      '.notes-pdf-stage .note-markdown pre { background: #f8fafc !important; border: 1px solid #e2e8f0 !important;',
      '  border-radius: 10px !important; padding: 10px 12px !important; color: #1e293b !important;',
      '  white-space: pre-wrap !important; word-break: break-word !important; }',
      '.notes-pdf-stage .note-markdown blockquote { background: #f8fafc !important; border-left: 3px solid #a5b4fc !important; color: #475569 !important; }',
      '.notes-pdf-stage .note-markdown table { width: 100% !important; border-collapse: collapse !important; }',
      '.notes-pdf-stage .note-markdown th, .notes-pdf-stage .note-markdown td { border: 1px solid #cbd5e1 !important; padding: 6px 8px !important; color: #334155 !important; }',
      '.notes-pdf-stage .note-markdown th { background: #f1f5f9 !important; }',
      '.notes-pdf-stage .note-markdown img { max-width: 100% !important; height: auto !important; border-radius: 10px; }',
      '.notes-pdf-stage .note-markdown hr { border-color: #e2e8f0 !important; }',
      '.notes-pdf-stage .note-action { display: none !important; }',
      '.notes-pdf-stage mjx-container, .notes-pdf-stage mjx-container * { color: #1f2937 !important; }',
      '.notes-pdf-foot { margin: 16px 0 0; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8 !important; }',
      '.notes-pdf-overlay { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center;',
      '  justify-content: center; gap: 10px; background: rgba(15, 23, 42, 0.92); color: #f8fafc; font-size: 13px; font-weight: 600; }',
      '.notes-pdf-overlay__spinner { width: 18px; height: 18px; border-radius: 999px; border: 2px solid rgba(255, 255, 255, 0.35);',
      '  border-top-color: #ffffff; animation: notesPdfSpin 0.8s linear infinite; }',
      '@keyframes notesPdfSpin { to { transform: rotate(360deg); } }',
      '.note-tool.is-loading { opacity: 0.75; cursor: progress; }',
      '@media (prefers-reduced-motion: reduce) { .notes-pdf-overlay__spinner { animation-duration: 2.4s; } }'
    ].join('\n');

    document.head.appendChild(style);
  }

  function notesPdfTimestamp() {
    const now = new Date();
    const pad2 = function (value) { return ('0' + value).slice(-2); };
    return now.getFullYear() + '/' + pad2(now.getMonth() + 1) + '/' + pad2(now.getDate()) +
      ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  }

  /* 克隆笔记容器（#noteList），临时加大内边距并套上打印样式 */
  function buildNotesPdfStage(notes) {
    const list = $('#noteList');
    if (!list || !list.children.length) return null;

    const stage = document.createElement('div');
    stage.id = NOTES_PDF_STAGE_ID;
    stage.className = 'notes-pdf-stage';
    stage.setAttribute('aria-hidden', 'true');

    const head = document.createElement('div');
    head.className = 'notes-pdf-head';
    head.innerHTML =
      '<p class="notes-pdf-brand">Rylan\'s note</p>' +
      '<h1 class="notes-pdf-title">我的笔记</h1>' +
      '<p class="notes-pdf-meta">共 ' + notes.length + ' 条笔记 · 导出于 ' + notesPdfTimestamp() + '</p>';
    stage.appendChild(head);

    const clone = list.cloneNode(true);
    clone.removeAttribute('id');
    clone.removeAttribute('aria-label');
    clone.className = 'notes-pdf-list';
    stage.appendChild(clone);

    const foot = document.createElement('p');
    foot.className = 'notes-pdf-foot';
    foot.textContent = '本文件由 Rylan\'s note 导出 · 笔记数据仅保存在本机浏览器';
    stage.appendChild(foot);

    return stage;
  }

  /* 等克隆出来的图片加载完成，避免 PDF 里出现空白图 */
  function waitForNotesPdfImages(stage) {
    const images = Array.prototype.slice.call(stage.querySelectorAll('img'));
    if (!images.length) return Promise.resolve();

    return Promise.all(images.map(function (image) {
      if (image.complete) return Promise.resolve();

      return new Promise(function (resolve) {
        const done = function () { resolve(); };
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        window.setTimeout(done, 2500);
      });
    }));
  }

  /* 导出 PDF：html2pdf().from(element).save('我的笔记.pdf') */
  function exportNotesToPdf(button) {
    if (notesPdfExporting) return;

    const notes = loadNotes();
    if (!notes.length) {
      showToast('还没有笔记可以导出', 'error');
      return;
    }

    if (typeof window.html2pdf !== 'function') {
      showToast('PDF 组件还没加载完成，请检查网络后重试', 'error');
      return;
    }

    ensureNotesPdfStyles();

    const stage = buildNotesPdfStage(notes);
    if (!stage) {
      showToast('没有找到笔记列表，无法导出', 'error');
      return;
    }

    notesPdfExporting = true;
    document.body.appendChild(stage);

    const overlay = document.createElement('div');
    overlay.id = NOTES_PDF_OVERLAY_ID;
    overlay.className = 'notes-pdf-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = '<span class="notes-pdf-overlay__spinner" aria-hidden="true"></span><span>正在生成 PDF，请稍候…</span>';
    document.body.appendChild(overlay);

    if (button) {
      button.dataset.busy = '1';
      button.disabled = true;
      button.classList.add('is-loading');
    }

    const restoreButton = function () {
      if (!button) return;
      delete button.dataset.busy;
      button.classList.remove('is-loading');
      button.disabled = loadNotes().length === 0;
    };

    const options = {
      margin: [8, 8, 10, 8],
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: Math.max(document.documentElement.clientWidth || 0, 900)
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.note-item', 'tr', 'pre', 'img'] }
    };

    // 等两帧 + 图片就绪，确保克隆节点布局、图片、公式都渲染稳定
    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(resolve);
      });
    })
      .then(function () { return waitForNotesPdfImages(stage); })
      .then(function () {
        return window.html2pdf().set(options).from(stage).save('我的笔记.pdf');
      })
      .then(function () {
        showToast('PDF 已导出：我的笔记.pdf', 'success');
      })
      .catch(function (error) {
        console.error('[EchoNote] 导出 PDF 失败：', error);
        showToast('导出失败，请稍后重试', 'error');
      })
      .then(function () {
        if (stage.parentNode) stage.remove();
        if (overlay.parentNode) overlay.remove();
        notesPdfExporting = false;
        restoreButton();
      });
  }

  /* ---------------- 笔记页 ---------------- */
  function initNotesPage() {
    const form = $('#noteForm');
    const input = $('#noteInput');
    if (!form || !input) return;

    const list = $('#noteList');
    const emptyState = $('#emptyState');
    const countEl = $('#noteCount');
    const clearAllBtn = $('#clearAllBtn');
    const shareBtn = $('#shareNotesBtn');
    const exportBtn = $('#exportPdfBtn');
    const template = $('#noteItemTemplate');
    const imageBtn = $('#noteImageBtn');
    const imageInput = $('#noteImageInput');

    // 图片上传：FileReader 转 Base64，再以 Markdown 语法追加到输入框
    if (imageBtn && imageInput) {
      imageBtn.addEventListener('click', function () {
        imageInput.click();
      });

      imageInput.addEventListener('change', function () {
        const file = imageInput.files && imageInput.files[0];
        imageInput.value = '';

        if (!file) return;

        if (file.type && file.type.indexOf('image/') !== 0) {
          showToast('请选择图片文件（jpg / png / gif / webp）', 'error');
          return;
        }

        if (file.size > 12 * 1024 * 1024) {
          showToast('图片太大了（上限 12MB），请先压缩再上传', 'error');
          return;
        }

        imageBtn.disabled = true;
        imageBtn.classList.add('is-loading');

        prepareNoteImage(file)
          .then(function (dataUrl) {
            const alt = String(file.name || '图片').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').trim() || '图片';
            insertNoteMarkdown(input, '![' + alt + '](' + dataUrl + ')');
            showToast('图片已插入，点击「添加笔记」保存', 'success');
          })
          .catch(function (error) {
            showToast((error && error.message) || '图片插入失败，请重试', 'error');
          })
          .then(function () {
            imageBtn.disabled = false;
            imageBtn.classList.remove('is-loading');
          });
      });
    }

    // 顶部工具栏：分享（原生面板 / 剪贴板）与导出 PDF
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        shareNotes();
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportNotesToPdf(exportBtn);
      });
    }

    function buildItem(note) {
      if (!template || !template.content.firstElementChild) return null;

      const item = template.content.firstElementChild.cloneNode(true);
      item.dataset.noteId = note.id;

      const textEl = item.querySelector('[data-note-text]');
      const timeEl = item.querySelector('[data-note-time]');
      const clockEl = item.querySelector('[data-note-clock]');
      const dateEl = item.querySelector('[data-note-date]');
      const originalEl = item.querySelector('[data-note-original]');
      const sourceEl = item.querySelector('[data-note-source]');
      const iconEl = item.querySelector('[data-note-icon]');
      const deleteBtn = item.querySelector('[data-delete-id]');
      const copyBtn = item.querySelector('[data-copy-id]');

      // Markdown / 表格 / 公式：先解析为富文本，再由 MathJax 统一排版
      if (textEl) textEl.innerHTML = renderNoteMarkdown(note.text);

      // 时间线左栏：HH:MM:SS + 月日
      const created = new Date(note.createdAt);
      const validDate = !Number.isNaN(created.getTime());
      const pad2 = function (value) { return ('0' + value).slice(-2); };

      if (clockEl) {
        clockEl.textContent = validDate
          ? pad2(created.getHours()) + ':' + pad2(created.getMinutes()) + ':' + pad2(created.getSeconds())
          : '--:--:--';
      }
      if (dateEl) {
        dateEl.textContent = validDate ? (created.getMonth() + 1) + '月' + created.getDate() + '日' : '';
      }

      // 原文 / 译文对照（字幕流保存的笔记带原文）
      if (originalEl) {
        const original = note.originalText && note.originalText !== note.text ? note.originalText : '';
        originalEl.textContent = original;
        originalEl.classList.toggle('hidden', !original);
      }

      if (timeEl) {
        timeEl.textContent = formatDateTime(note.createdAt);
        if (validDate) timeEl.setAttribute('datetime', note.createdAt);
        timeEl.setAttribute('title', validDate ? created.toLocaleString('zh-CN') : '时间未知');
      }
      if (sourceEl) sourceEl.textContent = note.source === 'speech' ? '语音传译' : '手动输入';
      if (iconEl) iconEl.innerHTML = note.source === 'speech' ? ICONS.speech : ICONS.manual;
      if (deleteBtn) deleteBtn.dataset.deleteId = note.id;
      if (copyBtn) copyBtn.dataset.copyId = note.id;

      return item;
    }

    function render() {
      const notes = loadNotes();

      if (list) list.textContent = '';
      notes.forEach(function (note) {
        const item = buildItem(note);
        if (item && list) list.appendChild(item);
      });

      // 富文本插入后再交给 MathJax 排版（容器不可见时会自动跳过，进页时重试）
      typesetNoteMath(list);

      const hasNotes = notes.length > 0;

      if (countEl) countEl.textContent = notes.length + ' 条笔记';
      if (emptyState) emptyState.classList.toggle('hidden', hasNotes);
      if (clearAllBtn) clearAllBtn.classList.toggle('hidden', !hasNotes);

      // 没有笔记时禁用分享 / 导出；导出进行中保持禁用直到结束
      if (shareBtn) shareBtn.disabled = !hasNotes;
      if (exportBtn && !exportBtn.dataset.busy) exportBtn.disabled = !hasNotes;
    }

    function handleAdd() {
      const text = input.value.trim();
      if (!text) {
        showToast('请先输入笔记内容', 'error');
        input.focus();
        return;
      }

      if (!addNote(text, 'manual')) return;

      input.value = '';
      render();
      showToast('笔记已添加', 'success');
      input.focus();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      handleAdd();
    });

    input.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        handleAdd();
      }
    });

    if (list) {
      list.addEventListener('click', function (event) {
        const copyBtn = event.target.closest('[data-copy-id]');
        if (copyBtn) {
          const copyId = copyBtn.dataset.copyId;
          const target = loadNotes().find(function (note) { return note.id === copyId; });
          if (target) {
            const payload = target.originalText && target.originalText !== target.text
              ? target.originalText + '\n' + target.text
              : target.text;
            copyText(payload, '笔记已复制');
          }
          return;
        }

        const deleteBtn = event.target.closest('[data-delete-id]');
        if (!deleteBtn) return;

        const id = deleteBtn.dataset.deleteId;
        const item = deleteBtn.closest('li');
        if (item) item.classList.add('note-item--leaving');

        window.setTimeout(function () {
          if (deleteNoteById(id)) {
            render();
            showToast('笔记已删除', 'success');
          }
        }, 200);
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        if (loadNotes().length === 0) return;
        if (!window.confirm('确定要清空全部笔记吗？此操作无法撤销。')) return;

        saveNotes([]);
        render();
        showToast('已清空全部笔记', 'success');
      });
    }

    render();

    // 供路由与其他页面（保存语音笔记后）刷新列表
    refreshNotesView = render;
    document.addEventListener('echonote:notes-changed', render);
  }

  /* ---------------- 笔记 AI 工具箱 ---------------- */
  function initNotesAI() {
    const summaryBtn = $('#aiSummaryBtn');
    const formatBtn = $('#aiFormatBtn');
    const clearBtn = $('#aiClearResultBtn');
    const statusEl = $('#aiToolStatus');
    const resultBox = $('#aiToolResult');
    const resultTitle = $('#aiToolResultTitle');
    const resultText = $('#aiToolResultText');
    const copyBtn = $('#aiToolCopyBtn');
    if (!summaryBtn || !formatBtn) return;

    function setStatus(message) {
      if (!statusEl) return;
      if (!message) {
        statusEl.classList.add('hidden');
        statusEl.textContent = '';
        return;
      }
      statusEl.textContent = message;
      statusEl.classList.remove('hidden');
    }

    function setBusy(busy, activeBtn) {
      summaryBtn.disabled = busy;
      formatBtn.disabled = busy;
      if (clearBtn) clearBtn.disabled = busy;
      summaryBtn.classList.remove('is-loading');
      formatBtn.classList.remove('is-loading');
      if (busy && activeBtn) activeBtn.classList.add('is-loading');
    }

    async function run(mode, button) {
      const notes = loadNotes();
      if (!notes.length) {
        showToast('还没有笔记可以处理', 'error');
        return;
      }

      const api = readApiSettings();
      if (!api.key) {
        showToast('请先在「个人设置」保存 API Key', 'error');
        window.location.hash = '#profile';
        return;
      }

      setBusy(true, button);
      setStatus(mode === 'format' ? '正在重新分段排版，请稍候…' : '正在总结全部笔记，请稍候…');

      try {
        const result = await requestNotesAi(notes, mode);
        const title = mode === 'format' ? '分段排版' : '笔记总结';

        if (resultTitle) resultTitle.textContent = title + ' · ' + result.providerLabel;
        if (resultText) resultText.textContent = result.content;
        if (resultBox) resultBox.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');

        // 结果自动生成一条新笔记
        addNote('【AI ' + title + '】\n' + result.content, 'manual');

        setStatus('完成，结果已生成一条新笔记。');
        showToast('AI 处理完成，已保存为新笔记', 'success');
      } catch (error) {
        setStatus('');
        if (error && error.code === 'NO_KEY') {
          showToast('请先在「个人设置」保存 API Key', 'error');
          window.location.hash = '#profile';
        } else {
          showToast((error && error.message) || 'AI 处理失败，请稍后重试', 'error');
        }
      } finally {
        setBusy(false);
      }
    }

    summaryBtn.addEventListener('click', function () {
      run('summary', summaryBtn);
    });

    formatBtn.addEventListener('click', function () {
      run('format', formatBtn);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (resultBox) resultBox.classList.add('hidden');
        if (resultText) resultText.textContent = '';
        clearBtn.classList.add('hidden');
        setStatus('');
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyText(resultText ? resultText.textContent : '', 'AI 结果已复制');
      });
    }
  }

  /* ---------------- 个人设置页（API Key） ---------------- */
  function initProfilePage() {
    const form = $('#keyForm');
    const input = $('#apiKeyInput');
    if (!form || !input) return;

    const providerSelect = $('#apiProviderSelect');
    const toggleBtn = $('#toggleKeyBtn');
    const saveBtn = $('#saveKeyBtn');
    const clearBtn = $('#clearKeyBtn');
    const statusEl = $('#keyStatus');
    const statusDot = $('#keyStatusDot');
    const engineSelect = $('#asrEngineSelect');
    const engineHint = $('#asrEngineHint');

    let visible = false;

    function refreshEngine() {
      const engine = readAsrEngine();

      if (engineSelect) engineSelect.value = engine;

      if (engineHint) {
        engineHint.textContent = engine === 'whisper'
          ? 'Whisper 需要 OpenAI API Key（请把下面的「模型提供商」切换为 OpenAI 后保存）。整段录音会上传到 OpenAI 转写，单次最长 ' +
            Math.round(WHISPER_MAX_SECONDS / 60) + ' 分钟；对口音与专有名词的准确率明显更高。「语音翻译 · 对话模式」仍使用浏览器引擎。'
          : '免费、无需额外配置；口音较重、环境嘈杂或专有名词较多时容易出错。想提升准确率可切换到 OpenAI Whisper API。';
      }
    }

    function refresh() {
      const key = getItem(STORAGE.API_KEY) || '';
      const provider = getItem(STORAGE.API_PROVIDER) || 'deepseek';
      const hasKey = key.length > 0;

      if (providerSelect) {
        const known = Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
        providerSelect.value = known ? provider : 'deepseek';
      }

      input.value = key;
      input.type = visible ? 'text' : 'password';

      if (toggleBtn) toggleBtn.textContent = visible ? '隐藏' : '显示';

      if (statusEl) {
        const providerName = providerSelect
          ? providerSelect.options[providerSelect.selectedIndex].textContent
          : (PROVIDERS[provider] || provider);
        statusEl.textContent = hasKey
          ? '已保存 · ' + providerName + ' · ' + maskKey(key)
          : '尚未保存 API Key';
      }
      if (statusDot) {
        statusDot.className = hasKey
          ? 'h-2 w-2 rounded-full bg-emerald-500'
          : 'h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600';
      }
      if (clearBtn) clearBtn.disabled = !hasKey;
      if (saveBtn) saveBtn.disabled = false;

      refreshEngine();
    }

    document.addEventListener('echonote:profile-changed', refresh);

    if (engineSelect) {
      engineSelect.addEventListener('change', function () {
        if (!saveAsrEngine(engineSelect.value)) {
          engineSelect.value = readAsrEngine();
          return;
        }

        refreshEngine();
        showToast('语音识别引擎已切换为「' + getAsrEngineLabel(engineSelect.value) + '」', 'success');
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      const value = input.value.trim();
      if (!value) {
        showToast('请输入 API Key 后再保存', 'error');
        input.focus();
        return;
      }

      const provider = providerSelect ? providerSelect.value : 'deepseek';

      // provider 与 api_key 一起写入 localStorage
      if (!setItem(STORAGE.API_PROVIDER, provider)) return;
      if (!setItem(STORAGE.API_KEY, value)) return;

      refresh();
      showToast('已保存 ' + (PROVIDERS[provider] || provider) + ' 的配置（仅本机）', 'success');
    });

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        visible = !visible;
        input.type = visible ? 'text' : 'password';
        toggleBtn.textContent = visible ? '隐藏' : '显示';
        input.focus();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!getItem(STORAGE.API_KEY)) return;
        if (!window.confirm('确定删除本地保存的 API Key 吗？')) return;

        removeItem(STORAGE.API_KEY);
        visible = false;
        refresh();
        showToast('API Key 已删除', 'success');
      });
    }

    refresh();
  }

  /* ---------------------------------------------------------
   * 大模型 API：真实 fetch 调用
   * ---------------------------------------------------------
   * 从 localStorage 读取：
   *   api_provider  deepseek | openai | anthropic | google | qwen
   *   api_key       Bearer / x-api-key / ?key=
   * 术语表来自内置 BUILTIN_GLOSSARY + 用户自定义 custom_glossary，
   * 统一注入 System Prompt，翻译与笔记整理都必须遵守。
   * ------------------------------------------------------- */
  function normalizeGlossaryItem(item) {
    if (!item || typeof item !== 'object') return null;
    const term = String(item.term || '').trim().slice(0, 48);
    const translation = String(item.translation || '').trim().slice(0, 48);
    if (!term || !translation) return null;
    return { term: term, translation: translation };
  }

  function loadCustomGlossary() {
    const raw = getItem(STORAGE.GLOSSARY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);

      // 兼容旧格式：{ "B-roll": "空镜" }
      if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
        return Object.keys(parsed).map(function (key) {
          return normalizeGlossaryItem({ term: key, translation: parsed[key] });
        }).filter(Boolean);
      }

      if (Array.isArray(parsed)) return parsed.map(normalizeGlossaryItem).filter(Boolean);
    } catch (error) {
      console.warn('[EchoNote] 术语表解析失败：', error);
    }

    return [];
  }

  function saveCustomGlossary(list) {
    const clean = (Array.isArray(list) ? list : []).map(normalizeGlossaryItem).filter(Boolean);
    return setItem(STORAGE.GLOSSARY, JSON.stringify(clean));
  }

  // 内置 + 自定义；同名词条以后者为准（不区分大小写）
  function getAllGlossary() {
    const merged = [];
    const seen = {};

    Object.keys(BUILTIN_GLOSSARY).forEach(function (term) {
      const key = term.toLowerCase();
      seen[key] = true;
      merged.push({ term: term, translation: BUILTIN_GLOSSARY[term], builtin: true });
    });

    loadCustomGlossary().forEach(function (item) {
      const key = item.term.toLowerCase();
      const index = merged.findIndex(function (entry) {
        return entry.term.toLowerCase() === key;
      });

      if (index > -1) {
        merged[index] = { term: item.term, translation: item.translation, builtin: merged[index].builtin };
        return;
      }

      if (!seen[key]) {
        seen[key] = true;
        merged.push({ term: item.term, translation: item.translation, builtin: false });
      }
    });

    return merged;
  }

  function buildGlossaryPrompt() {
    const glossary = getAllGlossary();
    if (!glossary.length) return '（暂无术语表）';

    return glossary.map(function (item) {
      return '- ' + item.term + ' → ' + item.translation;
    }).join('\n');
  }

  function buildTranslationSystemPrompt(targetLang) {
    return [
      '你是资深的传媒行业口译员，擅长新闻、影视与节目制作场景的中英互译。',
      '请把用户提供的口语内容翻译成「' + targetLang + '」。',
      '必须严格遵循下列术语对照表（格式为 原词 → 指定译法），遇到这些词时不得使用其他译法：',
      buildGlossaryPrompt(),
      '要求：',
      '1. 只输出译文，不要输出原文、解释、括号注释或 Markdown 标记；',
      '2. 保持口语的自然与完整，可以进行必要的语序调整；',
      '3. 数字、时间、机构名与专有名词必须准确；',
      '4. 如果原文已经是目标语言，则做轻微润色后原样输出。'
    ].join('\n');
  }

  function buildNotesSystemPrompt() {
    return [
      '你是资深传媒编辑，负责把记者、编导与制片人的零散工作笔记整理成可直接交付的内容。',
      '必须遵守下列传媒术语对照表（原词 → 指定译法）：',
      buildGlossaryPrompt(),
      '输出使用简体中文，专业、克制、信息密度高，不要编造笔记中不存在的细节。'
    ].join('\n');
  }

  function readApiSettings() {
    return {
      key: String(getItem(STORAGE.API_KEY) || '').trim(),
      provider: String(getItem(STORAGE.API_PROVIDER) || 'deepseek').trim()
    };
  }

  function requireApiSettings() {
    const settings = readApiSettings();

    if (!settings.key) {
      const error = new Error('还没有保存 API Key，请先到「个人设置」填写并保存。');
      error.code = 'NO_KEY';
      throw error;
    }

    if (!API_CONFIG[settings.provider]) settings.provider = 'deepseek';
    return settings;
  }

  function extractAiText(provider, data) {
    if (!data) return '';

    if (provider === 'anthropic') {
      return (data.content || []).map(function (part) {
        return part && part.text ? part.text : '';
      }).join('\n').trim();
    }

    if (provider === 'google') {
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate && candidate.content && candidate.content.parts;
      return (parts || []).map(function (part) {
        return part && part.text ? part.text : '';
      }).join('\n').trim();
    }

    const choice = data.choices && data.choices[0];
    return (choice && choice.message && choice.message.content ? choice.message.content : '').trim();
  }

  async function callLLM(system, user, options) {
    const settings = requireApiSettings();
    const config = API_CONFIG[settings.provider] || API_CONFIG.deepseek;
    const temperature = options && typeof options.temperature === 'number' ? options.temperature : 0.3;

    let url = config.endpoint;
    const headers = { 'Content-Type': 'application/json' };
    let body;

    if (config.style === 'anthropic') {
      headers['x-api-key'] = settings.key;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = {
        model: config.model,
        max_tokens: 1400,
        temperature: temperature,
        system: system,
        messages: [{ role: 'user', content: user }]
      };
    } else if (config.style === 'google') {
      url += (url.indexOf('?') > -1 ? '&' : '?') + 'key=' + encodeURIComponent(settings.key);
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: temperature, maxOutputTokens: 1400 }
      };
    } else {
      headers.Authorization = 'Bearer ' + settings.key;
      body = {
        model: config.model,
        temperature: temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      };
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error('网络请求失败，可能是浏览器 CORS 限制或网络不可用。' +
        (error && error.message ? '（' + error.message + '）' : ''));
    }

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const apiError = data && data.error;
      const detail = apiError
        ? (apiError.message || apiError.status || '')
        : (raw ? raw.slice(0, 160) : '');
      throw new Error('请求失败：HTTP ' + response.status + (detail ? ' · ' + detail : ''));
    }

    const content = extractAiText(settings.provider, data);
    if (!content) throw new Error('大模型没有返回内容，请稍后重试。');

    return {
      content: content,
      provider: settings.provider,
      providerLabel: PROVIDERS[settings.provider] || config.label,
      model: config.model
    };
  }

  /* 真实翻译：默认译成简体中文，可传入任意目标语言 */
  async function requestTranslation(text, options) {
    const content = String(text || '').trim();
    if (!content) throw new Error('没有可翻译的内容');

    const targetLang = (options && options.targetLang) || '简体中文';
    const sourceName = (options && options.sourceLang) || '';
    const user = (sourceName ? '原文语言：' + sourceName + '\n' : '') + '原文：\n' + content;

    return callLLM(buildTranslationSystemPrompt(targetLang), user, { temperature: 0.2 });
  }

  /* 笔记 AI 工具箱：summary（总结）/ format（分段排版） */
  async function requestNotesAi(notes, mode) {
    const list = Array.isArray(notes) ? notes : [];
    if (!list.length) throw new Error('还没有笔记可以交给 AI 处理');

    const transcript = list.slice().reverse().map(function (note, index) {
      return (index + 1) + '. [' + formatDateTime(note.createdAt) + '] ' + note.text;
    }).join('\n');

    const instruction = mode === 'format'
      ? [
        '请把下面的笔记按主题重新分段排版，保留全部关键信息。',
        '输出格式：先给一句不超过 30 字的总览，再用「一、二、三」编号分段，每段配一个小标题。',
        '不要输出 Markdown 表格、代码块或多余的客套话。'
      ].join('\n')
      : [
        '请阅读下面的全部笔记，输出一份结构化总结。',
        '输出格式：',
        '【核心要点】3-5 条，每条不超过 40 字；',
        '【关键人物 / 机构】列出出现的人名、机构名与职务；',
        '【待办与风险】列出需要跟进的事项，没有则写「暂无」。',
        '不要编造笔记中没有的信息。'
      ].join('\n');

    const user = instruction + '\n\n笔记原文（按时间从早到晚）：\n' + transcript;
    return callLLM(buildNotesSystemPrompt(), user, { temperature: 0.3 });
  }

  /* ---------------------------------------------------------
   * 用户资料：头像（Base64）+ 昵称
   * ---------------------------------------------------------
   * user_avatar / user_name 只保存在本机，所有页面共用；
   * 顶栏 [data-header-avatar]、设置页头像、引导弹窗头像都通过
   * renderIdentity() 统一刷新。
   * ------------------------------------------------------- */
  const DEFAULT_USER_NAME = 'Rylan';
  const AVATAR_SIZE = 320; // 头像压缩后的边长（px）

  function getUserName() {
    const name = String(getItem(STORAGE.USER_NAME) || '').trim();
    return name || DEFAULT_USER_NAME;
  }

  function getUserAvatar() {
    const avatar = String(getItem(STORAGE.USER_AVATAR) || '');
    return /^data:image\//.test(avatar) ? avatar : '';
  }

  function getInitial(name) {
    const text = String(name || '').trim();
    if (!text) return 'R';
    return text.charAt(0).toUpperCase();
  }

  function debounce(fn, wait) {
    let timer = 0;
    return function () {
      const args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  // 把昵称 / 头像同步到当前页面所有占位节点
  function renderIdentity() {
    const name = getUserName();
    const avatar = getUserAvatar();
    const storedName = String(getItem(STORAGE.USER_NAME) || '').trim();

    $$('[data-avatar-img]').forEach(function (img) {
      const wrap = img.parentElement;
      const fallback = wrap ? $('[data-avatar-fallback]', wrap) : null;

      if (avatar) {
        if (img.getAttribute('src') !== avatar) img.setAttribute('src', avatar);
        img.classList.remove('is-hidden');
        if (fallback) fallback.classList.add('is-hidden');
      } else {
        img.removeAttribute('src');
        img.classList.add('is-hidden');
        if (fallback) fallback.classList.remove('is-hidden');
      }
    });

    $$('[data-avatar-fallback]').forEach(function (el) {
      el.textContent = getInitial(name);
    });

    $$('[data-header-avatar]').forEach(function (link) {
      link.setAttribute('aria-label', name + ' · 打开个人设置');
      link.setAttribute('title', name + ' · 个人设置');
    });

    const displayName = $('#profileDisplayName');
    if (displayName) displayName.textContent = name;

    const nameInput = $('#profileNameInput');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = storedName;

    return { name: name, avatar: avatar, storedName: storedName };
  }

  // 读取图片 → 居中裁成正方形 → 压缩为 JPEG Base64
  function readAvatarFile(file, done) {
    if (!file) return;

    if (!/^image\//.test(file.type)) {
      showToast('请选择图片文件（JPG / PNG / WebP）', 'error');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      showToast('图片太大了，请选择 8MB 以内的图片', 'error');
      return;
    }

    const reader = new FileReader();

    reader.onerror = function () {
      showToast('读取图片失败，请重试', 'error');
    };

    reader.onload = function () {
      const image = new Image();

      image.onerror = function () {
        showToast('这张图片无法解析，请换一张试试', 'error');
      };

      image.onload = function () {
        const side = Math.min(image.width, image.height);
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          showToast('当前浏览器不支持图片处理', 'error');
          return;
        }

        ctx.drawImage(
          image,
          (image.width - side) / 2,
          (image.height - side) / 2,
          side,
          side,
          0,
          0,
          AVATAR_SIZE,
          AVATAR_SIZE
        );

        let dataUrl = '';
        try {
          dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        } catch (error) {
          dataUrl = '';
        }

        if (!dataUrl) {
          showToast('图片处理失败，请换一张试试', 'error');
          return;
        }

        done(dataUrl);
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  }

  function saveAvatar(dataUrl) {
    if (!dataUrl) return false;
    if (!setItem(STORAGE.USER_AVATAR, dataUrl)) return false;
    renderIdentity();
    return true;
  }

  // 昵称为空时删除该键，回退到默认昵称
  function saveUserName(value, silent) {
    const name = String(value || '').trim().slice(0, 24);

    if (name) {
      if (!setItem(STORAGE.USER_NAME, name)) return getUserName();
    } else {
      removeItem(STORAGE.USER_NAME);
    }

    renderIdentity();
    if (!silent) showToast(name ? '昵称已保存' : '昵称已恢复默认', 'success');
    return name || DEFAULT_USER_NAME;
  }

  // 设置页：统一的「点击头像 → 选择本地图片 → 压缩保存」绑定
  function bindAvatarPicker(button, input, options) {
    if (!button || !input) return;

    const config = options || {};

    button.addEventListener('click', function () {
      input.click();
    });

    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      input.value = ''; // 允许重复选择同一张图片
      if (!file) return;

      readAvatarFile(file, function (dataUrl) {
        if (!saveAvatar(dataUrl)) return;
        if (typeof config.onSaved === 'function') config.onSaved(dataUrl);
        if (!config.silent) showToast('头像已更新', 'success');
      });
    });
  }

  /* ---------------- 昵称 / 头像页面初始化 ---------------- */
  function initIdentity() {
    renderIdentity();

    const nameInput = $('#profileNameInput');
    const saveHint = $('#profileSaveHint');
    const avatarInput = $('#avatarInput');

    function touchHint(message) {
      if (saveHint) saveHint.textContent = message;
    }

    bindAvatarPicker($('#avatarPickerBtn'), avatarInput, {
      onSaved: function () {
        touchHint('头像已保存到本机 · 刚刚');
        const removeBtn = $('#removeAvatarBtn');
        if (removeBtn) removeBtn.disabled = false;
      }
    });

    const chooseBtn = $('#avatarChooseBtn');
    if (chooseBtn && avatarInput) {
      chooseBtn.addEventListener('click', function () {
        avatarInput.click();
      });
    }

    const removeBtn = $('#removeAvatarBtn');
    if (removeBtn) {
      removeBtn.disabled = !getUserAvatar();
      removeBtn.addEventListener('click', function () {
        if (!getUserAvatar()) return;
        removeItem(STORAGE.USER_AVATAR);
        renderIdentity();
        removeBtn.disabled = true;
        touchHint('已移除头像，改用昵称首字母');
        showToast('头像已移除', 'success');
      });
    }

    if (nameInput) {
      nameInput.addEventListener('input', debounce(function () {
        saveUserName(nameInput.value, true);
        touchHint('昵称已保存 · 刚刚');
      }, 450));

      nameInput.addEventListener('blur', function () {
        saveUserName(nameInput.value, true);
        nameInput.value = String(getItem(STORAGE.USER_NAME) || '').trim();
      });

      nameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          nameInput.blur();
          showToast('昵称已保存', 'success');
        }
      });
    }
  }

  /* ---------------------------------------------------------
   * 首次打开引导弹窗（仅 index.html 存在该节点）
   * ------------------------------------------------------- */
  function openWelcomeModal() {
    const modal = $('#welcome-modal');
    if (!modal || !modal.hidden) return false;

    const nameInput = $('#welcomeNameInput');
    const providerSelect = $('#welcomeProvider');
    const keyInput = $('#welcomeKeyInput');
    const errorBox = $('#welcomeError');

    if (nameInput) nameInput.value = String(getItem(STORAGE.USER_NAME) || '').trim();
    if (providerSelect) providerSelect.value = getItem(STORAGE.API_PROVIDER) || 'deepseek';
    if (keyInput) {
      keyInput.value = getItem(STORAGE.API_KEY) || '';
      keyInput.type = 'password';
    }
    const eyeBtn = $('#welcomeEyeBtn');
    if (eyeBtn) eyeBtn.textContent = '显示';
    if (errorBox) errorBox.classList.add('is-hidden');

    modal.hidden = false;
    document.body.classList.add('modal-open');

    window.requestAnimationFrame(function () {
      modal.classList.add('is-open');
      // 弹出后自动聚焦昵称输入框，方便直接开始填写
      if (nameInput) {
        window.setTimeout(function () {
          nameInput.focus();
          nameInput.select();
        }, 260);
      }
    });

    window.setTimeout(function () {
      if (nameInput) nameInput.focus();
    }, 340);

    return true;
  }

  function closeWelcomeModal(silent) {
    const modal = $('#welcome-modal');
    if (!modal || modal.hidden) return;

    setItem(STORAGE.WELCOME_DONE, '1');
    modal.classList.remove('is-open');
    document.body.classList.remove('modal-open');

    window.setTimeout(function () {
      modal.hidden = true;
    }, 380);

    if (!silent) showToast('已跳过引导，之后可在「个人设置」里继续', 'success');
  }

  function initWelcome() {
    const modal = $('#welcome-modal');
    if (!modal) return;

    const form = $('#welcomeForm');
    const nameInput = $('#welcomeNameInput');
    const providerSelect = $('#welcomeProvider');
    const keyInput = $('#welcomeKeyInput');
    const eyeBtn = $('#welcomeEyeBtn');
    const errorBox = $('#welcomeError');
    const errorText = $('#welcomeErrorText');
    const submitBtn = $('#welcomeSubmitBtn');
    const submitLabel = $('#welcomeSubmitLabel');

    function showError(message) {
      if (!errorBox || !errorText) return;
      errorText.textContent = message;
      errorBox.classList.remove('is-hidden');
    }

    function clearError() {
      if (errorBox) errorBox.classList.add('is-hidden');
    }

    bindAvatarPicker($('#welcomeAvatarBtn'), $('#welcomeAvatarInput'), { silent: true });

    if (eyeBtn && keyInput) {
      eyeBtn.addEventListener('click', function () {
        const visible = keyInput.type === 'password';
        keyInput.type = visible ? 'text' : 'password';
        eyeBtn.textContent = visible ? '隐藏' : '显示';
      });
    }

    if (keyInput) keyInput.addEventListener('input', clearError);
    if (nameInput) nameInput.addEventListener('input', clearError);

    const closeBtn = $('#welcomeCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeWelcomeModal(); });

    const skipBtn = $('#welcomeSkipBtn');
    if (skipBtn) skipBtn.addEventListener('click', function () { closeWelcomeModal(); });

    // 点击遮罩空白处关闭
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeWelcomeModal();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeWelcomeModal();
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        clearError();

        const key = keyInput ? keyInput.value.trim() : '';
        const provider = providerSelect ? providerSelect.value : 'deepseek';

        if (key && !/^[A-Za-z0-9_\-.]{8,}$/.test(key)) {
          showError('API Key 只应包含字母、数字或 - _ . ，请检查后再试。');
          if (keyInput) keyInput.focus();
          return;
        }

        let saved = true;
        if (nameInput) saveUserName(nameInput.value, true);
        if (provider) saved = setItem(STORAGE.API_PROVIDER, provider) && saved;
        if (key) saved = setItem(STORAGE.API_KEY, key) && saved;

        if (!saved) {
          showError('写入本地存储失败，请检查浏览器隐私设置。');
          return;
        }

        document.dispatchEvent(new CustomEvent('echonote:profile-changed'));

        if (submitBtn) submitBtn.disabled = true;
        if (submitLabel) submitLabel.textContent = '正在保存…';

        window.setTimeout(function () {
          if (submitBtn) submitBtn.disabled = false;
          if (submitLabel) submitLabel.textContent = '保存并开启';
          closeWelcomeModal(true);
          showToast(key ? '设置已保存，可以开始使用了' : '已完成基础设置，随时可补填 API Key', 'success');
        }, 420);
      });
    }

    // 首次打开（还没有 api_key 且未完成过引导）自动弹出
    if (!getItem(STORAGE.API_KEY) && !getItem(STORAGE.WELCOME_DONE)) {
      window.setTimeout(openWelcomeModal, 520);
    }
  }

  /* ---------------- 传媒术语库（个人设置） ---------------- */
  function initGlossary() {
    const form = $('#glossaryForm');
    const termInput = $('#glossaryTermInput');
    const translationInput = $('#glossaryTranslationInput');
    const list = $('#glossaryList');
    const empty = $('#glossaryEmpty');
    const count = $('#glossaryCount');
    const builtinList = $('#builtinGlossaryList');
    const builtinCount = $('#builtinGlossaryCount');
    if (!form || !list) return;

    function renderBuiltin() {
      if (!builtinList) return;
      builtinList.textContent = '';

      Object.keys(BUILTIN_GLOSSARY).forEach(function (term) {
        const chip = document.createElement('span');
        chip.className = 'glossary-chip';

        const termEl = document.createElement('strong');
        termEl.textContent = term;

        const arrow = document.createElement('span');
        arrow.textContent = '→';

        const translationEl = document.createElement('em');
        translationEl.style.fontStyle = 'normal';
        translationEl.textContent = BUILTIN_GLOSSARY[term];

        chip.appendChild(termEl);
        chip.appendChild(arrow);
        chip.appendChild(translationEl);
        builtinList.appendChild(chip);
      });

      if (builtinCount) {
        builtinCount.textContent = Object.keys(BUILTIN_GLOSSARY).length + ' 条内置';
      }
    }

    function renderCustom() {
      const custom = loadCustomGlossary();
      list.textContent = '';

      custom.forEach(function (item, index) {
        const row = document.createElement('div');
        row.className = 'glossary-row';

        const termEl = document.createElement('span');
        termEl.className = 'glossary-row__term';
        termEl.textContent = item.term;

        const translationEl = document.createElement('span');
        translationEl.className = 'glossary-row__translation';
        translationEl.textContent = item.translation;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'note-action note-action--danger';
        deleteBtn.setAttribute('data-glossary-index', String(index));
        deleteBtn.setAttribute('aria-label', '删除术语 ' + item.term);
        deleteBtn.innerHTML = '<svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

        row.appendChild(termEl);
        row.appendChild(translationEl);
        row.appendChild(deleteBtn);
        list.appendChild(row);
      });

      if (empty) empty.classList.toggle('hidden', custom.length > 0);
      if (count) count.textContent = custom.length + ' 条';
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      const term = termInput ? termInput.value.trim() : '';
      const translation = translationInput ? translationInput.value.trim() : '';

      if (!term || !translation) {
        showToast('请同时填写英文术语和中文译法', 'error');
        if (!term && termInput) termInput.focus();
        else if (translationInput) translationInput.focus();
        return;
      }

      const custom = loadCustomGlossary();
      const index = custom.findIndex(function (item) {
        return item.term.toLowerCase() === term.toLowerCase();
      });

      if (index > -1) {
        custom[index] = { term: term, translation: translation };
        if (!saveCustomGlossary(custom)) return;
        renderCustom();
        showToast('已更新「' + term + '」的译法', 'success');
      } else {
        custom.unshift({ term: term, translation: translation });
        if (!saveCustomGlossary(custom)) return;
        renderCustom();
        showToast('术语已添加，立即生效', 'success');
      }

      if (termInput) termInput.value = '';
      if (translationInput) translationInput.value = '';
      if (termInput) termInput.focus();
    });

    if (list) {
      list.addEventListener('click', function (event) {
        const deleteBtn = event.target.closest('[data-glossary-index]');
        if (!deleteBtn) return;

        const index = Number(deleteBtn.getAttribute('data-glossary-index'));
        const custom = loadCustomGlossary();
        if (!custom[index]) return;

        const removed = custom[index];
        custom.splice(index, 1);
        if (!saveCustomGlossary(custom)) return;

        renderCustom();
        showToast('已删除术语「' + removed.term + '」', 'success');
      });
    }

    renderBuiltin();
    renderCustom();
  }

  /* ---------------- 语音翻译页（普通模式 + 对话模式） ---------------- */
  function initTranslatePage() {
    const page = $('#view-translate');
    if (!page) return;

    const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const modeButtons = $$('[data-translate-mode]', page);
    const normalPanel = $('#translateNormalPanel');
    const dialogPanel = $('#translateDialogPanel');

    function setMode(mode, persist) {
      const next = mode === 'dialog' ? 'dialog' : 'normal';

      modeButtons.forEach(function (btn) {
        const active = btn.getAttribute('data-translate-mode') === next;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
      });

      if (normalPanel) normalPanel.classList.toggle('hidden', next !== 'normal');
      if (dialogPanel) dialogPanel.classList.toggle('hidden', next !== 'dialog');
      if (persist) setItem(STORAGE.TRANSLATE_MODE, next);

      if (next === 'dialog' && dialogPanel) {
        dialogPanel.classList.remove('hidden');
      }
    }

    function guardApi(auto) {
      if (readApiSettings().key) return true;
      showToast('请先在「个人设置」保存 API Key', 'error');
      if (!auto) window.location.hash = '#profile';
      return false;
    }

    // 同一时间只允许一个麦克风工作：通知其他面板停止
    function stopOtherMics() {
      document.dispatchEvent(new CustomEvent('echonote:stop-mic'));
    }

    function makeRecognizer(options) {
      if (!SpeechCtor) return null;

      const rec = new SpeechCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.lang = options.lang;

      let softErrors = 0;
      let networkErrors = 0;
      let restartTimer = null;

      function restartLater() {
        if (restartTimer) return;
        const wait = Math.min(320 + (softErrors + networkErrors) * 600, 5000);

        restartTimer = window.setTimeout(function () {
          restartTimer = null;
          if (!(options.shouldRestart && options.shouldRestart())) return;
          try {
            if (options.getLang) rec.lang = options.getLang();
            rec.start();
          } catch (error) {
            /* 忽略重复启动 */
          }
        }, wait);
      }

      rec.onstart = function () {
        softErrors = 0;
        if (options.onStart) options.onStart();
      };

      rec.onresult = function (event) {
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];

          let best = result[0];
          if (result.isFinal && result.length > 1) {
            for (let j = 1; j < result.length; j += 1) {
              const alt = result[j];
              if (!alt) continue;
              if (!best || (alt.confidence || 0) > (best.confidence || 0)) best = alt;
            }
          }

          const piece = best ? best.transcript : '';
          if (result.isFinal) {
            softErrors = 0;
            networkErrors = 0;
            if (options.onFinal) options.onFinal(piece);
          } else {
            interim += piece;
          }
        }

        if (options.onInterim) options.onInterim(interim);
      };

      rec.onerror = function (event) {
        const code = (event && event.error) || 'unknown';
        if (code === 'aborted') return;

        // 静默 / 网络异常属于可恢复错误：自动重连，不终止录音
        if (code === 'no-speech' || code === 'network') {
          if (code === 'network') {
            networkErrors += 1;
            if (networkErrors >= 6) {
              if (options.onError) options.onError(code);
              return;
            }
          } else {
            softErrors += 1;
          }

          if (options.onSoftError) options.onSoftError(code);
          restartLater();
          return;
        }

        if (options.onError) options.onError(code);
      };

      rec.onend = function () {
        if (options.shouldRestart && options.shouldRestart()) {
          restartLater();
          return;
        }
        if (options.onEnd) options.onEnd();
      };

      return rec;
    }

    function speechErrorMessage(code) {
      const tips = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许使用麦克风。',
        'service-not-allowed': '当前环境不允许语音识别，请使用 HTTPS 或 localhost。',
        'audio-capture': '没有检测到可用的麦克风设备。',
        network: '网络异常，语音识别服务暂时不可用。',
        'no-speech': '没有检测到语音，请再试一次。'
      };
      return tips[code] || ('识别出错：' + code);
    }

    modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-translate-mode'), true);
      });
    });

    if (!SpeechCtor) {
      const partnerMic = $('#dialogPartnerMicBtn');
      const myMic = $('#dialogMyMicBtn');
      if (partnerMic) partnerMic.disabled = true;
      if (myMic) myMic.disabled = true;

      // 普通模式若选择 Whisper，仍可用 MediaRecorder 录音
      if (readAsrEngine() !== 'whisper') {
        const normalMic = $('#translateMicBtn');
        if (normalMic) {
          normalMic.disabled = true;
          const status = $('#translateStatus');
          if (status) status.textContent = '当前浏览器不支持语音识别';
        }
      }
    }

    /* ===== 普通模式 ===== */
    const normal = {
      micBtn: $('#translateMicBtn'),
      micWrap: $('#translateMicWrap'),
      status: $('#translateStatus'),
      statusDot: $('#translateStatusDot'),
      sourceSelect: $('#translateLangSelect'),
      targetSelect: $('#translateTargetSelect'),
      sourceText: $('#translateSourceText'),
      sourceInterim: $('#translateSourceInterim'),
      sourcePlaceholder: $('#translateSourcePlaceholder'),
      resultText: $('#translateResultText'),
      resultPlaceholder: $('#translateResultPlaceholder'),
      badge: $('#translateTargetBadge'),
      actionBtn: $('#translateActionBtn'),
      actionLabel: $('#translateActionLabel'),
      saveBtn: $('#translateSaveBtn'),
      clearBtn: $('#translateClearBtn'),
      copySourceBtn: $('#translateCopySourceBtn'),
      copyResultBtn: $('#translateCopyResultBtn')
    };

    let normFinal = '';
    let normInterim = '';
    let normListening = false;
    let normRec = null;
    let normLastTranslation = '';
    let normTranslateOnEnd = false;
    let normWhisper = null;
    let normWhisperTimer = null;
    let normWhisperStartedAt = 0;
    let normWhisperBusy = false;
    let normWhisperSession = 0;

    function normSetStatus(text, recording) {
      if (normal.status) normal.status.textContent = text;
      if (normal.statusDot) {
        normal.statusDot.className = recording
          ? 'h-2 w-2 rounded-full status-dot--recording'
          : 'h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500';
      }
    }

    function normSetRecording(recording) {
      if (normal.micBtn) {
        normal.micBtn.classList.toggle('is-recording', recording);
        normal.micBtn.setAttribute('aria-pressed', String(recording));
      }
      if (normal.micWrap) normal.micWrap.classList.toggle('is-recording', recording);
    }

    function normRender() {
      if (normal.sourceText) normal.sourceText.textContent = normFinal;
      if (normal.sourceInterim) {
        normal.sourceInterim.textContent = normInterim ? (normFinal ? ' ' : '') + normInterim : '';
      }
      if (normal.sourcePlaceholder) {
        normal.sourcePlaceholder.classList.toggle('hidden', Boolean(normFinal.trim() || normInterim.trim()));
      }

      const hasText = normFinal.trim().length > 0;
      if (normal.actionBtn) normal.actionBtn.disabled = !hasText;
      if (normal.copySourceBtn) normal.copySourceBtn.disabled = !hasText;
      if (normal.copyResultBtn) normal.copyResultBtn.disabled = !normLastTranslation;
      if (normal.clearBtn) normal.clearBtn.disabled = !hasText && !normInterim.trim();
      if (normal.saveBtn) normal.saveBtn.disabled = !normLastTranslation;
    }

    function appendSpeechChunk(base, chunk) {
      const piece = String(chunk || '').trim();
      if (!piece) return base;
      if (!base) return piece;
      return /\s$/.test(base) ? base + piece : base + ' ' + piece;
    }

    async function normTranslate(options) {
      const text = normFinal.trim();
      if (!text) {
        showToast('还没有可翻译的内容', 'error');
        return;
      }
      if (!guardApi(options && options.auto)) return;

      const targetName = getSelectedLanguage(normal.targetSelect, '简体中文');
      const sourceName = getSelectedLanguage(normal.sourceSelect, '');
      const originalLabel = normal.actionLabel ? normal.actionLabel.textContent : 'AI 翻译';

      if (normal.actionBtn) {
        normal.actionBtn.disabled = true;
        normal.actionBtn.classList.add('is-loading');
      }
      if (normal.actionLabel) normal.actionLabel.textContent = '翻译中…';
      if (normal.resultPlaceholder) normal.resultPlaceholder.classList.add('hidden');
      if (normal.resultText) normal.resultText.textContent = '正在调用大模型…';

      try {
        const result = await requestTranslation(text, {
          targetLang: targetName,
          sourceLang: sourceName
        });

        normLastTranslation = result.content;
        if (normal.resultText) normal.resultText.textContent = result.content;
        if (normal.badge) normal.badge.textContent = targetName;
        if (normal.copyResultBtn) normal.copyResultBtn.disabled = false;
        if (normal.saveBtn) normal.saveBtn.disabled = false;
        showToast('翻译完成 · ' + result.providerLabel, 'success');
      } catch (error) {
        if (normal.resultText) normal.resultText.textContent = '';
        if (normal.resultPlaceholder) {
          normal.resultPlaceholder.textContent = '翻译失败，请检查 API Key 或稍后重试';
          normal.resultPlaceholder.classList.remove('hidden');
        }

        if (error && error.code === 'NO_KEY') {
          showToast('请先在「个人设置」保存 API Key', 'error');
          window.location.hash = '#profile';
        } else {
          showToast((error && error.message) || '翻译失败，请稍后重试', 'error');
        }
      } finally {
        if (normal.actionLabel) normal.actionLabel.textContent = originalLabel;
        if (normal.actionBtn) {
          normal.actionBtn.classList.remove('is-loading');
          normal.actionBtn.disabled = normFinal.trim().length === 0;
        }
      }
    }

    function normStart() {
      if (readAsrEngine() === 'whisper') {
        normStartWhisper();
        return;
      }

      if (!SpeechCtor) {
        showToast('当前浏览器不支持语音识别，请在「个人设置」切换到 OpenAI Whisper API。', 'error');
        return;
      }

      normTranslateOnEnd = false;
      stopOtherMics();
      if (!normRec) {
        normRec = makeRecognizer({
          lang: normal.sourceSelect ? normal.sourceSelect.value : DEFAULT_SPEECH_LANG,
          onStart: function () {
            normListening = true;
            normSetRecording(true);
            normSetStatus('正在聆听…（再次点击停止并翻译）', true);
          },
          onFinal: function (piece) {
            normFinal = appendSpeechChunk(normFinal, piece);
            normInterim = '';
            if (normLastTranslation) {
              normLastTranslation = '';
              if (normal.resultText) normal.resultText.textContent = '';
              if (normal.resultPlaceholder) {
                normal.resultPlaceholder.textContent = '点击「AI 翻译」后，这里会显示经过术语润色的译文…';
                normal.resultPlaceholder.classList.remove('hidden');
              }
            }
            normRender();
          },
          onInterim: function (text) {
            normInterim = text;
            normRender();
          },
          onError: function (code) {
            showToast(speechErrorMessage(code), 'error');
            normListening = false;
            normSetRecording(false);
            normSetStatus('已停止，点击可继续', false);
          },
          onSoftError: function (code) {
            normSetStatus(code === 'network' ? '网络波动，正在自动重连…' : '等待语音…（会自动继续）', true);
          },
          onEnd: function () {
            if (normListening) return;
            normSetRecording(false);
            if (normTranslateOnEnd) {
              normTranslateOnEnd = false;
              normSetStatus('识别完成，正在翻译…', false);
              normTranslate();
              return;
            }
            normSetStatus('已停止，点击可继续', false);
          },
          shouldRestart: function () { return normListening; },
          getLang: function () {
            return normal.sourceSelect ? normal.sourceSelect.value : DEFAULT_SPEECH_LANG;
          }
        });
      }

      if (!normRec) return;
      normRec.lang = normal.sourceSelect ? normal.sourceSelect.value : DEFAULT_SPEECH_LANG;
      normListening = true;
      normSetRecording(true);
      normSetStatus('正在聆听…（再次点击停止并翻译）', true);

      try {
        normRec.start();
      } catch (error) {
        console.warn('[EchoNote] 启动翻译识别失败：', error);
      }
    }

    function normClearWhisperTimer() {
      if (normWhisperTimer) {
        window.clearInterval(normWhisperTimer);
        normWhisperTimer = null;
      }
    }

    function normStartWhisper() {
      if (normWhisperBusy) return;

      if (!isMediaRecordingSupported()) {
        showToast('当前浏览器不支持录音，请使用最新版 Chrome / Edge。', 'error');
        return;
      }

      if (!readApiSettings().key) {
        showToast('Whisper 需要 OpenAI API Key，请先在「个人设置」保存', 'error');
        window.location.hash = '#profile';
        return;
      }

      normTranslateOnEnd = false;
      normInterim = '';
      stopOtherMics();

      normListening = true;
      normSetRecording(true);
      normSetStatus('正在录音（Whisper）…再次点击结束并翻译', true);

      const session = normWhisperSession + 1;
      normWhisperSession = session;

      normWhisper = createWhisperRecorder({
        onStart: function () {
          if (session !== normWhisperSession) return;
          normWhisperStartedAt = Date.now();
          normWhisperTimer = window.setInterval(function () {
            const seconds = Math.floor((Date.now() - normWhisperStartedAt) / 1000);
            normSetStatus('正在录音（Whisper）· ' + seconds + 's · 再次点击结束', true);
            if (seconds >= WHISPER_MAX_SECONDS) normStop();
          }, 500);
        },
        onStop: function (blob) {
          if (session !== normWhisperSession) return;
          normClearWhisperTimer();
          normListening = false;
          normSetRecording(false);
          normSetStatus('Whisper 正在转写…', false);

          normWhisperBusy = true;
          transcribeWithWhisper(blob, {
            lang: normal.sourceSelect ? normal.sourceSelect.value : DEFAULT_SPEECH_LANG
          }).then(function (text) {
            normFinal = appendSpeechChunk(normFinal, text);
            normInterim = '';
            normRender();
            showToast('Whisper 转写完成，正在自动翻译…', 'success');
            return normTranslate({ auto: true });
          }).catch(function (error) {
            if (error && error.code === 'NO_KEY') {
              showToast('Whisper 需要 OpenAI API Key，请先在「个人设置」保存。', 'error');
            } else {
              showToast((error && error.message) || 'Whisper 转写失败，请稍后重试', 'error');
            }
          }).then(function () {
            normWhisperBusy = false;
            if (!normListening) normSetStatus('准备就绪，点击麦克风开始', false);
          });
        },
        onError: function (error) {
          if (session !== normWhisperSession) return;
          normClearWhisperTimer();
          normListening = false;
          normSetRecording(false);
          showToast('录音失败：' + (error && error.message ? error.message : '请检查麦克风'), 'error');
          normSetStatus('录音失败，点击可重试', false);
        }
      });

      normWhisper.start().catch(function (error) {
        if (session !== normWhisperSession) return;
        normListening = false;
        normClearWhisperTimer();
        normSetRecording(false);

        const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        showToast(denied
          ? '麦克风权限被拒绝，请在浏览器地址栏的权限设置中允许使用麦克风。'
          : '无法启动录音：' + (error && error.message ? error.message : '未知错误'), 'error');
        normSetStatus('麦克风不可用，点击可重试', false);
      });
    }

    function normCancelWhisper() {
      normWhisperSession += 1;
      normListening = false;
      normClearWhisperTimer();
      if (normWhisper) normWhisper.cancel();
      normWhisper = null;
      normSetRecording(false);
    }

    function normStop() {
      if (readAsrEngine() === 'whisper') {
        normListening = false;
        normClearWhisperTimer();

        const stopped = normWhisper ? normWhisper.stop() : false;
        normSetRecording(false);
        normSetStatus(stopped ? '录音结束，正在转写…' : '准备就绪，点击麦克风开始', false);
        return;
      }

      normListening = false;
      if (normFinal.trim().length === 0 && normInterim.trim()) {
        normFinal = normInterim.trim();
        normInterim = '';
        normRender();
      }
      if (normRec) {
        try { normRec.stop(); } catch (error) { /* 忽略重复停止 */ }
      }
      normSetRecording(false);
      if (normFinal.trim()) {
        normTranslateOnEnd = true;
        normSetStatus('识别完成，正在翻译…', false);
      } else {
        normTranslateOnEnd = false;
        normSetStatus('准备就绪，点击麦克风开始', false);
      }
    }

    if (normal.micBtn) {
      normal.micBtn.addEventListener('click', function () {
        if (normListening) normStop();
        else normStart();
      });
    }

    if (normal.actionBtn) {
      normal.actionBtn.addEventListener('click', function () {
        normTranslate();
      });
    }

    if (normal.saveBtn) {
      normal.saveBtn.addEventListener('click', function () {
        if (!normFinal.trim() || !normLastTranslation) {
          showToast('还没有可保存的翻译', 'error');
          return;
        }

        const content = '【语音翻译】\n原文：' + normFinal.trim() + '\n译文：' + normLastTranslation;
        if (addNote(content, 'speech')) {
          showToast('已保存到笔记', 'success');
          normLastTranslation = '';
          normal.saveBtn.disabled = true;
        }
      });
    }

    if (normal.clearBtn) {
      normal.clearBtn.addEventListener('click', function () {
        if (normListening && readAsrEngine() === 'whisper') normCancelWhisper();

        normFinal = '';
        normInterim = '';
        normLastTranslation = '';
        if (normal.resultText) normal.resultText.textContent = '';
        if (normal.resultPlaceholder) {
          normal.resultPlaceholder.textContent = '点击「AI 翻译」后，这里会显示经过术语润色的译文…';
          normal.resultPlaceholder.classList.remove('hidden');
        }
        if (normal.copyResultBtn) normal.copyResultBtn.disabled = true;
        normRender();
        normSetStatus('准备就绪，点击麦克风开始', false);
        showToast('已清空', 'success');
      });
    }

    if (normal.copySourceBtn) {
      normal.copySourceBtn.addEventListener('click', function () {
        copyText(normFinal, '识别原文已复制');
      });
    }

    if (normal.copyResultBtn) {
      normal.copyResultBtn.addEventListener('click', function () {
        copyText(normLastTranslation, '译文已复制');
      });
    }

    if (normal.targetSelect) {
      normal.targetSelect.addEventListener('change', function () {
        if (normal.badge) normal.badge.textContent = getSelectedLanguage(normal.targetSelect, '简体中文');
      });
    }

    if (normal.sourceSelect) {
      normal.sourceSelect.addEventListener('change', function () {
        if (normRec) normRec.lang = normal.sourceSelect.value;
      });
    }

    // 其他面板开始录音时自动停止本面板（不自动翻译）
    document.addEventListener('echonote:stop-mic', function () {
      if (!normListening) return;
      normTranslateOnEnd = false;

      if (readAsrEngine() === 'whisper') {
        // 被其他麦克风抢占：丢弃本次 Whisper 录音，不上传转写
        normCancelWhisper();
        normSetStatus('已停止，点击可继续', false);
        return;
      }

      normListening = false;
      if (normRec) {
        try { normRec.stop(); } catch (error) { /* 忽略 */ }
      }
      normSetRecording(false);
      normSetStatus('已停止，点击可继续', false);
    });

    // 「个人设置」切换识别引擎后立即停止当前录音
    document.addEventListener('echonote:asr-engine-changed', function () {
      if (normListening) {
        if (readAsrEngine() === 'whisper') {
          normListening = false;
          if (normRec) { try { normRec.stop(); } catch (error) { /* 忽略 */ } }
        } else {
          normCancelWhisper();
        }
      }
      normSetRecording(false);
      normSetStatus('已切换识别引擎，点击麦克风开始', false);

      if (normal.micBtn) {
        normal.micBtn.disabled = readAsrEngine() === 'whisper'
          ? !isMediaRecordingSupported()
          : !SpeechCtor;
      }
    });

    normRender();



    /* ===== 对话模式（上下分屏） ===== */
    const dialog = {
      partnerLang: $('#dialogPartnerLang'),
      myLang: $('#dialogMyLang'),
      partnerMic: $('#dialogPartnerMicBtn'),
      myMic: $('#dialogMyMicBtn'),
      partnerStatus: $('#dialogPartnerStatus'),
      myStatus: $('#dialogMyStatus'),
      partnerBubbles: $('#dialogPartnerBubbles'),
      myBubbles: $('#dialogMyBubbles'),
      partnerEmpty: $('#dialogPartnerEmpty'),
      myEmpty: $('#dialogMyEmpty'),
      clearBtn: $('#dialogClearBtn')
    };

    const dialogSides = {
      partner: {
        role: 'partner',
        langSelect: dialog.partnerLang,
        mic: dialog.partnerMic,
        status: dialog.partnerStatus,
        thread: dialog.partnerBubbles,
        empty: dialog.partnerEmpty,
        idleText: '等待对方说话',
        rec: null,
        listening: false,
        pendingTranslate: false,
        finalText: '',
        interimText: ''
      },
      me: {
        role: 'me',
        langSelect: dialog.myLang,
        mic: dialog.myMic,
        status: dialog.myStatus,
        thread: dialog.myBubbles,
        empty: dialog.myEmpty,
        idleText: '等待我说话',
        rec: null,
        listening: false,
        pendingTranslate: false,
        finalText: '',
        interimText: ''
      }
    };

    function otherSide(side) {
      return side === dialogSides.partner ? dialogSides.me : dialogSides.partner;
    }

    function sideSetStatus(side, text, recording) {
      if (side.status) {
        side.status.textContent = text;
        side.status.classList.toggle('text-rose-500', Boolean(recording));
        side.status.classList.toggle('text-slate-500', !recording);
        side.status.classList.toggle('dark:text-rose-400', Boolean(recording));
      }
      if (side.mic) {
        side.mic.classList.toggle('is-recording', Boolean(recording));
        side.mic.setAttribute('aria-pressed', String(Boolean(recording)));
      }
    }

    function sideSetRecording(side, recording) {
      if (side.mic) {
        side.mic.classList.toggle('is-recording', recording);
        side.mic.setAttribute('aria-pressed', String(recording));
      }
    }

    function addDialogBubble(side, original) {
      if (!side.thread) return null;
      if (side.empty) side.empty.classList.add('hidden');

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble--' + side.role;

      const textEl = document.createElement('p');
      textEl.className = 'chat-bubble__text';
      textEl.textContent = original;

      const translationEl = document.createElement('p');
      translationEl.className = 'chat-bubble__translation';
      translationEl.innerHTML = '<span class="chat-bubble__loading"></span> 正在翻译…';

      const meta = document.createElement('span');
      meta.className = 'chat-bubble__meta';
      meta.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

      bubble.appendChild(textEl);
      bubble.appendChild(translationEl);
      bubble.appendChild(meta);
      side.thread.appendChild(bubble);
      side.thread.scrollTop = side.thread.scrollHeight;

      return translationEl;
    }

    async function translateDialogBubble(side, text, translationEl) {
      const targetName = getSelectedLanguage(otherSide(side).langSelect, '');
      const sourceName = getSelectedLanguage(side.langSelect, '');

      if (!readApiSettings().key) {
        translationEl.textContent = '请先在「个人设置」保存 API Key';
        return;
      }

      try {
        const result = await requestTranslation(text, {
          targetLang: targetName,
          sourceLang: sourceName
        });
        translationEl.textContent = result.content;
        if (side.thread) side.thread.scrollTop = side.thread.scrollHeight;
      } catch (error) {
        translationEl.textContent = '翻译失败：' + ((error && error.message) || '请稍后重试');
      }
    }

    function sideStart(side) {
      if (!SpeechCtor) {
        showToast('当前浏览器不支持语音识别', 'error');
        return;
      }
      if (!guardApi()) return;

      // 另一侧或普通模式若在录音，先停下来（不触发翻译）
      const other = otherSide(side);
      if (other.listening) sideStop(other, false);
      stopOtherMics();

      if (!side.rec) {
        side.rec = makeRecognizer({
          lang: side.langSelect ? side.langSelect.value : DEFAULT_SPEECH_LANG,
          onStart: function () {
            side.listening = true;
            sideSetStatus(side, '正在聆听…（再次点击停止并翻译）', true);
          },
          onFinal: function (piece) {
            side.finalText = appendSpeechChunk(side.finalText, piece);
            side.interimText = '';
          },
          onInterim: function (text) {
            side.interimText = text;
            sideSetStatus(side, text ? '识别中：' + text : '正在聆听…', true);
          },
          onError: function (code) {
            showToast(speechErrorMessage(code), 'error');
            if (code !== 'no-speech') {
              side.listening = false;
              side.pendingTranslate = false;
              side.finalText = '';
              side.interimText = '';
              sideSetRecording(side, false);
              sideSetStatus(side, side.idleText, false);
            }
          },
          onEnd: function () {
            if (side.listening) return;
            sideSetRecording(side, false);
            if (side.pendingTranslate) {
              finishSide(side);
              return;
            }
            sideSetStatus(side, side.idleText, false);
          },
          shouldRestart: function () { return side.listening; },
          getLang: function () {
            return side.langSelect ? side.langSelect.value : DEFAULT_SPEECH_LANG;
          }
        });
      }

      if (!side.rec) return;
      side.rec.lang = side.langSelect ? side.langSelect.value : DEFAULT_SPEECH_LANG;
      side.listening = true;
      sideSetStatus(side, '正在聆听…（再次点击停止并翻译）', true);

      try {
        side.rec.start();
      } catch (error) {
        console.warn('[EchoNote] 启动对话识别失败：', error);
      }
    }

    function finishSide(side) {
      side.pendingTranslate = false;
      const text = side.finalText.trim();
      side.finalText = '';
      side.interimText = '';

      if (!text) {
        sideSetStatus(side, side.idleText, false);
        return;
      }

      sideSetStatus(side, '正在翻译…', false);
      const translationEl = addDialogBubble(side, text);
      if (!translationEl) return;

      translateDialogBubble(side, text, translationEl).then(function () {
        sideSetStatus(side, side.idleText, false);
      });
    }

    function sideStop(side, translate) {
      side.listening = false;
      if (side.rec) {
        try { side.rec.stop(); } catch (error) { /* 忽略重复停止 */ }
      }
      sideSetRecording(side, false);

      if (!translate) {
        side.pendingTranslate = false;
        side.finalText = '';
        side.interimText = '';
        sideSetStatus(side, side.idleText, false);
        return;
      }

      if (!side.finalText.trim() && side.interimText.trim()) {
        side.finalText = side.interimText.trim();
      }

      if (!side.finalText.trim() && !side.interimText.trim()) {
        side.pendingTranslate = false;
        sideSetStatus(side, side.idleText, false);
        return;
      }

      // 等待 onend 收齐最后的 final 结果后再翻译
      side.pendingTranslate = true;
      sideSetStatus(side, '识别完成，正在翻译…', false);
    }

    Object.keys(dialogSides).forEach(function (key) {
      const side = dialogSides[key];

      if (side.mic) {
        side.mic.addEventListener('click', function () {
          if (side.listening) sideStop(side, true);
          else sideStart(side);
        });
      }

      if (side.langSelect) {
        side.langSelect.addEventListener('change', function () {
          if (side.rec) side.rec.lang = side.langSelect.value;
        });
      }
    });

    if (dialog.clearBtn) {
      dialog.clearBtn.addEventListener('click', function () {
        Object.keys(dialogSides).forEach(function (key) {
          const side = dialogSides[key];
          if (side.listening) sideStop(side, false);
          if (side.thread) {
            $$('.chat-bubble', side.thread).forEach(function (bubble) { bubble.remove(); });
          }
          if (side.empty) side.empty.classList.remove('hidden');
          sideSetStatus(side, side.idleText, false);
        });
        showToast('对话已清空', 'success');
      });
    }

    // 其他麦克风启动时，停止对话两侧（不触发翻译）
    document.addEventListener('echonote:stop-mic', function () {
      Object.keys(dialogSides).forEach(function (key) {
        const side = dialogSides[key];
        if (!side.listening) return;
        side.listening = false;
        side.pendingTranslate = false;
        side.finalText = '';
        side.interimText = '';
        if (side.rec) {
          try { side.rec.stop(); } catch (error) { /* 忽略 */ }
        }
        sideSetRecording(side, false);
        sideSetStatus(side, side.idleText, false);
      });
    });



    setMode(getItem(STORAGE.TRANSLATE_MODE) || 'normal', false);
  }

  function init() {
    initTheme();
    initNav();
    initIdentity();
    initSpeechPage();
    initNotesPage();
    initNotesAI();
    initTranslatePage();
    initGlossary();
    initProfilePage();
    initWelcome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露少量方法，方便在控制台调试
  window.EchoNote = {
    loadNotes: loadNotes,
    addNote: addNote,
    requestTranslation: requestTranslation,
    requestNotesAi: requestNotesAi,
    callLLM: callLLM,
    transcribeWithWhisper: transcribeWithWhisper,
    readAsrEngine: readAsrEngine,
    getAllGlossary: getAllGlossary,
    copyText: copyText,
    showToast: showToast,
    shareNotes: shareNotes,
    exportNotesToPdf: exportNotesToPdf,
    go: function (route) { window.location.hash = '#' + route; }
  };





})();

