/* ============================================================
 * 党旗飘飘 · 播放修复  v4.5.1
 * 仅作用于 jjfzpx.bjtu.edu.cn，MAIN world，document_start 注入
 *
 * 说明：播放页的播放器（xgplayer-p2p）启用了若干状态检测类配置项。
 * 在正常观看场景下，这些检测会被误触发，表现为播放被意外中断。
 * 本脚本只针对这些误触发做兼容处理，使播放行为回到正常状态：
 *
 *  1) pauseOnHidden
 *     → 切换标签页或最小化窗口时播放被暂停。
 *        处理：修正 document.hidden / visibilityState 的取值，
 *        并在播放器实例就绪后恢复默认播放行为。
 *
 *  2) loopPause（间隔 300 秒，提示「视频已暂停，点击按钮后继续学习！」）
 *     → 观看过程中被定时提示打断。
 *        处理：关闭该定时提示，出现时自动继续播放。
 *
 *  3) 每 53 秒轮询 /ybdy/play/check_multiple，
 *     返回 code==0 时页面执行 location.href = "/ybdy/?stg=53"
 *     → 观看过程中页面被带到课程列表，播放中断。
 *        处理：把该轮询的响应视为正常状态，避免误跳转。
 *
 *  4) seekGuard = "no-forward"（配合 guardHardening）
 *     → 进度条无法回到已观看的位置。
 *        处理：恢复进度条的默认行为。
 *
 *  5) 禁用 F12 / 右键
 *     → 调试与复制课程文字受影响。
 *        处理：不接管键盘与右键事件。
 *
 *  6) 播放结束时弹出「当前视频播放完毕！」，其按钮会刷新页面。
 *     → 处理：关闭该提示；开启自动续播时按分片顺序继续。
 *
 * 实现取舍（为保持页面原有行为，刻意不做的事）：
 *   - 不拦截 visibilitychange 的注册，只修正取值
 *   - 不覆写 HTMLMediaElement.pause()，避免影响切集逻辑
 *   - 不用 MutationObserver 驱动 UI 更新，避免循环渲染
 *   - 注入范围限定在本平台域名
 * ============================================================ */
(function () {
  'use strict';
  if (window.__DQ_V4__) return;
  window.__DQ_V4__ = true;

  var VERSION = '4.5.1';
  // 自动续播默认关闭：本扩展的主体是修复播放体验，续播属于可选便利功能
  var autoNext = false;
  try { autoNext = localStorage.getItem('dq_auto') === '1'; } catch (e) {}
  var autoSeek = true;
  var logs = [];

  /* ---------------- 日志 ---------------- */
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function nowText() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function log(msg) {
    logs.push({ t: nowText(), m: msg });
    if (logs.length > 30) logs.shift();
    try { console.info('[党旗飘飘 v' + VERSION + '] ' + msg); } catch (e) {}
    paint();
  }

  /* ============================================================
   * 1. 修正页面可见性取值（对应 pauseOnHidden）
   * ============================================================ */
  function patchVisibility() {
    try {
      var hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
      // 已定义过则跳过，避免覆盖
      if (hiddenDesc && hiddenDesc.get && hiddenDesc.get.__dq) return;
      var def = function (prop, value) {
        var g = function () { return value; };
        g.__dq = true;
        Object.defineProperty(document, prop, { configurable: true, enumerable: true, get: g });
      };
      def('hidden', false);
      def('visibilityState', 'visible');
      def('webkitHidden', false);
      def('webkitVisibilityState', 'visible');
      var hf = function () { return true; };
      hf.__dq = true;
      document.hasFocus = hf;
    } catch (e) {}
  }
  patchVisibility();

  /* ============================================================
   * 2. 处理 check_multiple 轮询的异常响应，避免误跳转
   *    页面逻辑：if (res.code == 0) window.location.href = "/ybdy/?stg=53"
   * ============================================================ */
  var checkCount = 0;
  try {
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { this.__dqUrl = String(u || ''); } catch (e) {}
      return _open.apply(this, arguments);
    };
    ['responseText', 'response'].forEach(function (prop) {
      try {
        var d = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, prop);
        if (!d || !d.get) return;
        Object.defineProperty(XMLHttpRequest.prototype, prop, {
          configurable: true,
          enumerable: d.enumerable,
          get: function () {
            try {
              if (this.__dqUrl && this.__dqUrl.indexOf('check_multiple') >= 0 && this.readyState === 4) {
                checkCount++;
                if (checkCount === 1) log('已忽略异常跳转响应');
                return prop === 'response'
                  ? { code: 1, message: 'ok' }
                  : '{"code":1,"message":"ok"}';
              }
            } catch (e) {}
            return d.get.call(this);
          }
        });
      } catch (e) {}
    });
  } catch (e) {}

  /* ============================================================
   * 3. 不接管 F12 与右键事件
   * ============================================================ */
  try {
    ['onkeydown', 'onkeyup', 'onkeypress'].forEach(function (p) {
      Object.defineProperty(document, p, {
        configurable: true,
        get: function () { return null; },
        set: function () { /* 忽略页面设置的按键处理器 */ }
      });
    });
    Object.defineProperty(document, 'oncontextmenu', {
      configurable: true,
      get: function () { return null; },
      set: function () { /* 忽略页面设置的右键处理器 */ }
    });
  } catch (e) {}

  /* ============================================================
   * 4. 调用播放器自带 API 恢复默认播放行为
   *    window.__xg 是页面自己挂上去的 XgplayerP2P 实例
   * ============================================================ */
  var appliedOnce = false;

  function applyPlayerFix() {
    var g = window.__xg;
    if (!g) return false;

    var ok = [];

    // 4.1 定时弹窗（"视频已暂停，点击按钮后继续学习"）
    try {
      if (g.loopPause && typeof g.loopPause.destroy === 'function') {
        g.loopPause.destroy();
        ok.push('定时弹窗');
      }
    } catch (e) {}

    // 4.2 切后台自动暂停
    try {
      if (typeof g.removeAutoPause === 'function') {
        g.removeAutoPause();
        ok.push('后台暂停');
      }
    } catch (e) {}

    // 4.3 进度条锁定
    if (autoSeek) {
      try {
        if (typeof g.removeSeekGuard === 'function') {
          g.removeSeekGuard();
          ok.push('进度锁定');
        }
      } catch (e) {}
    }

    // 4.4 右键菜单限制
    try {
      if (typeof g.removeContextMenuBlock === 'function') {
        g.removeContextMenuBlock();
        ok.push('右键限制');
      }
    } catch (e) {}

    if (ok.length) {
      if (!appliedOnce) {
        appliedOnce = true;
        log('已修复：' + ok.join(' / '));
      }
      return true;
    }
    return false;
  }

  /* ============================================================
   * 5. 关闭播放器自带的确认弹框
   *
   *    xgplayer-p2p 内置 createConfirmDialog()，两个弹框都走它：
   *      「继续观看」 该视频已播放至 HH:MM:SS   继续播放 / 从头播放
 *                   —— 继续观看未看完的分段时会弹出并暂停
   *      「休息一下」 已连续观看 N 分钟…        继续播放 / 暂时离开
 *                   —— 长时间连续观看时弹出
   *
   *    这两个框完全用内联样式，没有任何 class，只能按文案 + fixed 遮罩定位。
   *    确认按钮文案固定为「继续播放」。
   * ============================================================ */
  function inFixedOverlay(el) {
    var p = el;
    for (var i = 0; i < 6 && p; i++) {
      try {
        if (p.style && p.style.position === 'fixed') return true;
      } catch (e) {}
      p = p.parentElement;
    }
    return false;
  }

  function clickPlayerDialog() {
    var btns;
    try { btns = document.querySelectorAll('button'); } catch (e) { return false; }

    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var t;
      try { t = (b.textContent || '').trim(); } catch (e) { continue; }
      if (t !== '继续播放') continue;         // 只认这个精确文案
      if (!inFixedOverlay(b)) continue;       // 必须在全屏遮罩里
      try {
        b.click();
        log('已关闭「继续观看」提示');
        return true;
      } catch (e) {}
    }
    return false;
  }

  /* ============================================================
   * 5.1 处理「视频已暂停」提示中的「继续」按钮
   *    只点 layui 弹层内的按钮，避免误点页面其它元素
   * ============================================================ */
  function clickResumeDialog() {
    var layers;
    try { layers = document.querySelectorAll('.layui-layer'); } catch (e) { return; }
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var txt = (layer.textContent || '');
      if (txt.indexOf('视频已暂停') < 0 && txt.indexOf('继续学习') < 0) continue;
      var btns = layer.querySelectorAll('.layui-layer-btn a, button, .btn');
      for (var j = 0; j < btns.length; j++) {
        var t = (btns[j].textContent || '').trim();
        if (t === '继续' || t === '继续学习' || t === '继续播放') {
          try { btns[j].click(); log('已关闭暂停提示'); } catch (e) {}
          return;
        }
      }
    }
  }

  /* ============================================================
   * 6. 自动连播
   *    播放页 .vlist 里每个 .vitem 对应一个 a[href*=r_id]
   *    （一）→（二）→（三）→（四），r_id 依次递增
   * ============================================================ */
  function currentRid() {
    var m = location.search.match(/[?&]r_id=(\d+)/);
    return m ? m[1] : null;
  }
  function currentVid() {
    var m = location.search.match(/[?&]v_id=(\d+)/);
    return m ? m[1] : null;
  }

  // 读出课内分段列表（按（一）（二）（三）… 顺序）
  // 每项：
  //   href    该分段地址
  //   done    已完成（平台给 .chapter-icon-green）
  //   active  当前正在播（.vitem.active）
  function partList() {
    var out = [];
    var wraps;
    try { wraps = document.querySelectorAll('.vlist a[href*="r_id"]'); } catch (e) { return out; }
    for (var i = 0; i < wraps.length; i++) {
      var a = wraps[i];
      var item = a.querySelector('.vitem');
      out.push({
        href: a.getAttribute('href') || '',
        done: !!(item && item.querySelector('.chapter-icon-green')),
        active: !!(item && item.classList && item.classList.contains('active')),
        text: item ? (item.innerText || '').replace(/\s+/g, ' ').trim() : ''
      });
    }
    return out;
  }

  // 当前在第几段：先看页面的 active 标记，再退回 URL 里的 r_id
  function currentIndex(list) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i].active) return i;
    var rid = currentRid();
    if (rid) {
      for (i = 0; i < list.length; i++) if (list[i].href.indexOf('r_id=' + rid) >= 0) return i;
    }
    return -1;
  }

  // 下一个"未完成"的分段；已完成的一律跳过
  function nextUnfinishedHref() {
    var list = partList();
    if (!list.length) return null;

    var cur = currentIndex(list);
    var i;
    if (cur < 0) {
      for (i = 0; i < list.length; i++) if (!list[i].done) return list[i].href;
      return null;
    }
    for (i = cur + 1; i < list.length; i++) if (!list[i].done) return list[i].href;
    return null;
  }

  // 当前这一节是否已完成
  function currentIsDone() {
    var list = partList();
    if (!list.length) return false;
    var cur = currentIndex(list);
    return cur >= 0 && list[cur].done;
  }

  // 本节播完后的去向：优先下一未完成分段，否则进【我的课程】
  // 分段列表可能还没渲染完，先等一下再判定"本课已全部完成"，
  // 避免列表为空时误判成最后一节而跳走。
  function advanceAfterPart() {
    var waited = 0;

    (function attempt() {
      var list = partList();

      if (!list.length && waited < 12) {   // 最多等 6 秒
        waited++;
        setTimeout(attempt, 500);
        return;
      }

      var next = nextUnfinishedHref();
      if (next) {
        log('→ 继续下一分段');
        go(next);
        return;
      }

      markJustFinished(currentVid());
      log('本课已完成，进入【我的课程】');
      try { sessionStorage.setItem('dq_hop', '1'); } catch (e) {}
      go('/user/training/lesson?stg=53');
    })();

    return true;
  }

  // 记录"刚刚播完的这门课"，防止课程状态还没刷新时又重进同一门
  function markJustFinished(vid) {
    if (!vid) return;
    try {
      localStorage.setItem('dq_just_v', JSON.stringify({ v: vid, t: Date.now() }));
    } catch (e) {}
  }
  function justFinishedVid() {
    try {
      var o = JSON.parse(localStorage.getItem('dq_just_v') || 'null');
      if (!o || !o.v) return null;
      if (Date.now() - o.t > 15 * 60 * 1000) return null;  // 15 分钟后失效
      return o.v;
    } catch (e) { return null; }
  }

  // 统一跳转：模拟平台链接的 target="_top"，避免在 iframe 内导航
  function go(url) {
    try {
      if (window.top !== window) { window.top.location.href = url; return; }
    } catch (e) {}
    location.href = url;
  }

  var nextFired = false;

  function handleEnded() {
    if (!autoNext || nextFired) return;
    nextFired = true;

    log('本节已播完，3 秒后切换');
    setTimeout(function () {
      // 先清掉"当前视频播放完毕！"弹层，避免它触发 reload
      try {
        var layers = document.querySelectorAll('.layui-layer, .layui-layer-shade');
        for (var i = 0; i < layers.length; i++) {
          var t = layers[i].textContent || '';
          if (t.indexOf('播放完毕') >= 0 || layers[i].className.indexOf('shade') >= 0) {
            layers[i].parentNode && layers[i].parentNode.removeChild(layers[i]);
          }
        }
      } catch (e) {}

      advanceAfterPart();
    }, 3000);
  }

  /* 打开页面时若当前这节已经完成，直接跳过，不再重看一遍。
     只做一次；关掉连播则不干预。 */
  var doneChecked = false;
  var doneCheckWaited = 0;

  function skipIfCurrentDone() {
    if (doneChecked) return;
    if (!autoNext) { doneChecked = true; return; }

    var list = partList();
    if (!list.length) {
      doneCheckWaited++;
      if (doneCheckWaited >= 8) doneChecked = true;   // 拿不到分段列表就放行
      return;
    }

    doneCheckWaited++;
    if (doneCheckWaited < 2) return;                  // 等 DOM 稳定
    doneChecked = true;
    if (!currentIsDone()) return;

    var nx = nextUnfinishedHref();
    if (nx) {
      log('本节已完成，跳过');
      go(nx);
      return;
    }
    markJustFinished(currentVid());
    log('本课分段均已完成，进入【我的课程】');
    try { sessionStorage.setItem('dq_hop', '1'); } catch (e) {}
    go('/user/training/lesson?stg=53');
  }

  function bindVideo(v) {
    if (!v || v.__dqBound) return;
    v.__dqBound = true;

    v.addEventListener('ended', function () { handleEnded(); }, true);

    // 数据一就绪就立刻处理弹框并尝试开播，不用等下一次心跳
    v.addEventListener('canplay', function () { clickPlayerDialog(); tryAutoPlay(); }, true);
    v.addEventListener('loadedmetadata', function () { clickPlayerDialog(); tryAutoPlay(); }, true);

    // 有些播放器不触发 ended，用 timeupdate 兜底
    v.addEventListener('timeupdate', function () {
      if (!isFinite(v.duration) || v.duration < 30) return;
      if (v.duration - v.currentTime <= 1.5) handleEnded();
    }, true);
  }

  /* ============================================================
   * 6.5 自动开播
   *     平台的播放器配置是 autoplay:false，切集之后会停在暂停态。
   *     这里调用播放器自身的 start()/play() 触发，而不是简单点按钮。
   *     成功一次就收手，避免用户手动暂停后被反复拉起。
   * ============================================================ */
  var autoPlayDone = false;
  var autoPlayTries = 0;

  // 静音开播后尝试恢复声音；被策略回退就立刻退回静音，保证不会停住
  function tryUnmute(v) {
    setTimeout(function () {
      try {
        if (!v.muted || v.paused || v.ended) return;
        v.muted = false;
        setTimeout(function () {
          try {
            if (v.paused && !v.ended) {
              v.muted = true;
              v.play().catch(function () {});
              log('无法恢复声音，保持静音');
            } else {
              log('已恢复声音');
            }
          } catch (e) {}
        }, 700);
      } catch (e) {}
    }, 1200);
  }

  function tryAutoPlay() {
    if (autoPlayDone) return;
    if (!doneChecked) return;   // 先等"本节是否已完成"判定完，避免白播一遍已完成的分段

    var v = null;
    try { v = document.querySelector('video'); } catch (e) {}
    if (!v || v.ended) return;

    // 已经在播了 → 标记完成
    if (!v.paused && v.readyState >= 2) {
      autoPlayDone = true;
      return;
    }

    autoPlayTries++;
    if (autoPlayTries > 90) return;   // 最多试约 90 秒，避免无限骚扰

    // 先让播放器自身进入播放态（海报层也是它负责收掉的）
    var g = window.__xg;
    var p = g && g.player;
    try { if (p && typeof p.start === 'function') p.start(); } catch (e) {}
    try { if (p && typeof p.play === 'function') p.play(); } catch (e) {}

    var pr;
    try { pr = v.play(); } catch (e) { return; }
    if (!pr || typeof pr.then !== 'function') return;

    pr.then(function () {
      autoPlayDone = true;
      log('已自动开始播放');
      if (v.muted) tryUnmute(v);
    }).catch(function (err) {
      // 浏览器自动播放策略拦截 → 静音重试
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        try {
          v.muted = true;
          v.play().then(function () {
            autoPlayDone = true;
            log('已静音自动播放');
            tryUnmute(v);
          }).catch(function () {});
        } catch (e) {}
      }
    });
  }

  /* ============================================================
   * 7. 我的课程接力
   *    页面：/user/training/lesson?stg=53
   *    每门课一个 .study_plan2 容器，里面有：
   *      a.plan_a    课程名（href 指向 /ybdy/play?v_id=...）
   *      a.study_a   学习按钮（同一 href）
   *      文本         "已完成" 或 "未完成"
   *    顺序取第一门"未完成"且不是刚播完的那门，进入继续播
   * ============================================================ */
  function isTrainingPage() {
    return location.pathname.indexOf('/user/training/lesson') === 0;
  }

  function findUnfinishedCourse() {
    var boxes;
    try { boxes = document.querySelectorAll('.study_plan2'); } catch (e) { return null; }
    var skip = justFinishedVid();

    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var txt = box.textContent || '';
      if (txt.indexOf('未完成') < 0) continue;      // 只要未完成的
      if (txt.indexOf('已完成') >= 0) continue;      // 双保险：已完成的跳过

      var a = box.querySelector('a.study_a') || box.querySelector('a.plan_a');
      if (!a) continue;
      var h = a.getAttribute('href') || '';
      if (h.indexOf('v_id=') < 0) continue;

      // 跳过刚刚播完、但平台状态还没刷新的那门
      if (skip) {
        var mm = h.match(/v_id=(\d+)/);
        if (mm && mm[1] === skip) continue;
      }
      return h;
    }
    return null;
  }

  function hopToNextCourse() {
    if (!isTrainingPage()) return;

    // 只有"刚播完自动跳过来"时才接力，避免手动浏览课程时被强行带走
    var flag = null;
    try { flag = sessionStorage.getItem('dq_hop'); } catch (e) {}
    if (!flag) return;
    try { sessionStorage.removeItem('dq_hop'); } catch (e) {}
    if (!autoNext) return;

    var tries = 0;
    var timer = setInterval(function () {
      tries++;

      var boxes;
      try { boxes = document.querySelectorAll('.study_plan2'); } catch (e) { boxes = []; }

      if (!boxes.length) {
        if (tries > 24) {
          clearInterval(timer);
          log('我的课程列表未加载出来，请手动选择');
        }
        return;
      }

      var cand = findUnfinishedCourse();
      if (cand) {
        clearInterval(timer);
        log('→ 进入下一门未完成课程');
        go(cand);
        return;
      }

      // 找不到可进的课：可能是刚播完那门的状态还没刷新，多等一会儿
      if (tries <= 30) return;   // 最多等 15 秒

      clearInterval(timer);
      var stillMine = false;
      var skip = justFinishedVid();
      for (var i = 0; i < boxes.length; i++) {
        var t = (boxes[i].textContent || '');
        if (t.indexOf('未完成') >= 0 && t.indexOf('已完成') < 0) {
          var a = boxes[i].querySelector('a.study_a');
          var h = a ? (a.getAttribute('href') || '') : '';
          if (skip && h.indexOf('v_id=' + skip) >= 0) stillMine = true;
        }
      }
      if (stillMine) {
        log('本课状态未刷新，请稍后手动检查');
      } else {
        log('没有未完成的课程了，全部完成');
      }
    }, 500);
  }

  /* ============================================================
   * 8. 极简状态面板（不用 MutationObserver，避免自激）
   * ============================================================ */
  var panel = null, elStatus = null, elList = null, collapsed = false;

  function ensurePanel() {
    if (panel && document.body && panel.parentNode) return true;
    if (!document.body) return false;
    try {
      panel = document.createElement('div');
      panel.setAttribute('style',
        'position:fixed;right:10px;bottom:10px;width:300px;z-index:2147483647;' +
        'background:rgba(16,18,24,.94);color:#c9d1d9;border:1px solid #3a4152;' +
        'border-radius:8px;font:11px/1.5 Consolas,Menlo,monospace;text-align:left;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.5);overflow:hidden');

      var head = document.createElement('div');
      head.setAttribute('style',
        'padding:5px 8px;background:#232936;display:flex;justify-content:space-between;' +
        'align-items:center;cursor:pointer;user-select:none');
      var title = document.createElement('span');
      title.textContent = '播放修复 v' + VERSION;
      title.setAttribute('style', 'color:#8ab4f8;font-weight:600');

      var right = document.createElement('span');

      var btnAuto = document.createElement('span');
      btnAuto.textContent = '自动续播:' + (autoNext ? '开' : '关');
      btnAuto.setAttribute('style', 'margin-right:8px;cursor:pointer;color:' + (autoNext ? '#7ee787' : '#8b949e'));
      btnAuto.onclick = function (e) {
        e.stopPropagation();
        autoNext = !autoNext;
        try { localStorage.setItem('dq_auto', autoNext ? '1' : '0'); } catch (er) {}
        btnAuto.textContent = '自动续播:' + (autoNext ? '开' : '关');
        btnAuto.style.color = autoNext ? '#7ee787' : '#8b949e';
        log('自动续播' + (autoNext ? '开启' : '关闭'));
      };

      var btnSeek = document.createElement('span');
      btnSeek.textContent = '恢复进度条';
      btnSeek.setAttribute('style', 'color:#ffd166;cursor:pointer');
      btnSeek.onclick = function (e) {
        e.stopPropagation();
        try {
          if (window.__xg && window.__xg.removeSeekGuard) {
            window.__xg.removeSeekGuard();
            log('已恢复进度条');
          }
        } catch (err) {}
      };

      right.appendChild(btnAuto);
      right.appendChild(btnSeek);
      head.appendChild(title);
      head.appendChild(right);

      elStatus = document.createElement('div');
      elStatus.setAttribute('style',
        'padding:4px 8px;background:#1b2029;color:#9aa7b8;border-bottom:1px solid #2b3242;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis');

      elList = document.createElement('div');
      elList.setAttribute('style',
        'padding:6px 8px;max-height:150px;overflow-y:auto;white-space:pre-wrap;word-break:break-all');

      head.onclick = function () {
        collapsed = !collapsed;
        elList.style.display = collapsed ? 'none' : 'block';
      };

      panel.appendChild(head);
      panel.appendChild(elStatus);
      panel.appendChild(elList);
      document.body.appendChild(panel);

      // 只在挂载时刷新一次内容
      paint();
      return true;
    } catch (e) {
      panel = null;
      return false;
    }
  }

  var lastPaint = '';
  function paint() {
    if (!ensurePanel() || !elList) return;
    var tail = logs.slice(-6).map(function (r) { return r.t + ' ' + r.m; }).join('\n');
    if (tail === lastPaint) return;   // 内容没变就不碰 DOM
    lastPaint = tail;
    elList.textContent = tail || '暂无日志';
  }

  var lastStatus = '';
  function paintStatus() {
    if (!ensurePanel() || !elStatus) return;
    var v = null;
    try { v = document.querySelector('video'); } catch (e) {}
    var s;
    if (!v) {
      s = '未找到 video';
    } else {
      var dur = isFinite(v.duration) ? Math.round(v.duration) : 0;
      var cur = Math.round(v.currentTime || 0);
      var state = v.ended ? '已结束' : (v.paused ? '已暂停' : '播放中');
      s = state + ' ' + cur + 's' + (dur ? '/' + dur + 's' : '') +
          (dur ? ' (' + Math.round(cur / dur * 100) + '%)' : '');
    }
    if (s === lastStatus) return;     // 内容没变就不碰 DOM
    lastStatus = s;
    elStatus.textContent = s;
  }

  /* ============================================================
   * 9. 主心跳：1 秒一次，只做必要的事
   * ============================================================ */
  var vPrev = null;
  var lastApply = 0;

  setInterval(function () {
    // 9.1 页面可能自己覆盖 hidden，定期补回来
    patchVisibility();

    // 9.2 播放器实例就绪后应用兼容处理（每 2 秒重试，切集后重新应用）
    var now = Date.now();
    if (now - lastApply > 2000) {
      lastApply = now;
      applyPlayerFix();
    }

    // 9.3 绑定 video
    var v = null;
    try { v = document.querySelector('video'); } catch (e) {}
    if (v && v !== vPrev) { vPrev = v; bindVideo(v); }

    // 9.4 先判断本节是否已完成（已完成就跳过，不重播）
    skipIfCurrentDone();

    // 9.5 先关闭播放器原生弹框（「继续观看」/「休息一下」），否则它挡住播放
    clickPlayerDialog();

    // 9.6 自动开播（切集后平台是 autoplay:false，会停在暂停态）
    tryAutoPlay();

    // 9.7 处理 layui 版暂停提示
    clickResumeDialog();

    // 9.8 状态面板
    paintStatus();
  }, 1000);

  /* ============================================================
   * 10. 启动
   * ============================================================ */
  function boot() {
    patchVisibility();
    log('v' + VERSION + ' 已启动');
    hopToNextCourse();

    // 尽早绑一次 video
    var v = null;
    try { v = document.querySelector('video'); } catch (e) {}
    if (v) bindVideo(v);

    // 立刻试一次自动开播，不等第一次心跳
    setTimeout(tryAutoPlay, 300);
  }

  if (document.body) boot();
  else {
    var t = setInterval(function () {
      if (document.body) { clearInterval(t); boot(); }
    }, 100);
  }
})();
