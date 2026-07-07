// ==UserScript==
// @name         Maoer Comment Sniper
// @namespace    https://www.missevan.com/
// @version      1.1.0
// @description  猫耳页面内直接运行的抢评脚本
// @author       zhangjohn
// @match        https://www.missevan.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "maoer-comment-sniper-settings";
  const MAX_LOGS = 200;
  const MIN_INTERVAL_MS = 500;
  const ONE_TIME_RELEASE_ID = "release-10260526-001";
  const ONE_TIME_STATUS_KEY = `maoer-comment-sniper-once:${ONE_TIME_RELEASE_ID}`;

  const state = {
    running: false,
    currentTaskId: 0,
    startTime: null,
    lastCheckAt: null,
    mode: "comment",
    matchedItemId: null,
    matchedSoundId: null,
    matchedEpisodeName: "",
    currentCommentCount: null,
    currentReplyCount: null,
    matchedTargetCommentId: null,
    matchedTargetCommentUsername: "",
    userInfo: null,
    lastCommentResult: null,
    logs: [],
    settings: loadSettings(),
    lastNotifiedResultKey: "",
    oneTimeUsed: isReleaseConsumed(),
  };

  injectStyles();
  const ui = createPanel();
  renderAll();
  bindEvents();

  function loadSettings() {
    const defaults = {
      dramaId: "86740",
      mode: "comment",
      episodePrefix: "第六期",
      intervalMs: String(MIN_INTERVAL_MS),
      targetCommentIndex: "1",
      targetCommentUsername: "",
      targetReplyIndex: "2",
      testCommentMode: false,
      comment: "男主好帅",
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        testCommentMode: Boolean(parsed?.testCommentMode),
      };
    } catch (error) {
      return defaults;
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  }

  function createPanel() {
    const root = document.createElement("div");
    root.id = "maoer-sniper-root";
    root.innerHTML = `
      <div class="maoer-sniper-card">
        <div class="maoer-sniper-header">
          <div>
            <div class="maoer-sniper-title">Maoer 抢评脚本</div>
            <div class="maoer-sniper-subtitle">直接在猫耳页面里运行，默认使用当前页面登录态</div>
          </div>
          <button type="button" class="maoer-sniper-collapse" data-action="toggle-panel">收起</button>
        </div>
        <div class="maoer-sniper-body">
          <div class="maoer-sniper-grid">
            <div class="maoer-sniper-field">
              <label for="maoer-mode">功能模式</label>
              <select id="maoer-mode">
                <option value="comment">抢节目主评论</option>
                <option value="subcomment">抢指定评论下的回复</option>
              </select>
            </div>
            <div class="maoer-sniper-field">
              <label for="maoer-drama-id">剧ID</label>
              <input id="maoer-drama-id" placeholder="例如：86740" />
            </div>
            <div class="maoer-sniper-field">
              <label for="maoer-episode-prefix">目标集数前缀</label>
              <input id="maoer-episode-prefix" placeholder="例如：第十一集" />
            </div>
            <div class="maoer-sniper-field">
              <label for="maoer-interval">轮询间隔（毫秒）</label>
              <input id="maoer-interval" type="number" min="${MIN_INTERVAL_MS}" step="100" />
            </div>
            <div class="maoer-sniper-field" id="maoer-target-comment-index-field">
              <label for="maoer-target-index">目标位次</label>
              <select id="maoer-target-index">
                <option value="1">抢第1条评论</option>
                <option value="2">抢第2条评论</option>
              </select>
            </div>
            <div class="maoer-sniper-field maoer-sniper-checkbox">
              <label for="maoer-test-mode">测试评论</label>
              <input id="maoer-test-mode" type="checkbox" />
              <span class="maoer-test-mode-note">测试模式已开启：会跳过位次校验直接发送</span>
            </div>
            <div class="maoer-sniper-field maoer-sniper-full" id="maoer-target-username-field" style="display:none;">
              <label for="maoer-target-username">目标主评论用户名</label>
              <input id="maoer-target-username" placeholder="例如：沈谧仁mile" />
            </div>
            <div class="maoer-sniper-field" id="maoer-target-reply-index-field" style="display:none;">
              <label for="maoer-target-reply-index">目标回复位次</label>
              <select id="maoer-target-reply-index">
                <option value="1">抢第1条回复</option>
                <option value="2">抢第2条回复</option>
              </select>
            </div>
            <div class="maoer-sniper-field maoer-sniper-full">
              <label for="maoer-comment">评论内容</label>
              <textarea id="maoer-comment" placeholder="例如：男主好帅"></textarea>
            </div>
          </div>
          <div class="maoer-sniper-actions">
            <button type="button" data-action="userinfo">读取用户信息</button>
            <button type="button" class="primary" data-action="start">开始抢评</button>
            <button type="button" data-action="stop">停止抢评</button>
          </div>
          <div class="maoer-sniper-status">
            <div class="item">
              <div class="label">抢评状态</div>
              <div class="value" data-role="running">未启动</div>
            </div>
            <div class="item">
              <div class="label">剧ID</div>
              <div class="value" data-role="drama-id">${escapeHtml(state.settings.dramaId)}</div>
            </div>
            <div class="item">
              <div class="label">匹配结果</div>
              <div class="value" data-role="matched">暂无</div>
            </div>
            <div class="item">
              <div class="label">最后检测时间</div>
              <div class="value" data-role="last-check">暂无</div>
            </div>
            <div class="item">
              <div class="label">功能模式</div>
              <div class="value" data-role="mode">抢节目主评论</div>
            </div>
            <div class="item">
              <div class="label">目标位次</div>
              <div class="value" data-role="target-index">第1条评论</div>
            </div>
            <div class="item">
              <div class="label" data-role="count-label">当前主评论数</div>
              <div class="value" data-role="comment-count">暂无</div>
            </div>
            <div class="item">
              <div class="label">目标用户名</div>
              <div class="value" data-role="target-username">暂无</div>
            </div>
          </div>
          <div class="maoer-sniper-result" data-role="result-box" style="display:none;">
            <div class="title" data-role="result-title">暂无结果</div>
            <div class="detail" data-role="result-detail"></div>
          </div>
          <div class="maoer-sniper-user">
            <div class="title">用户信息</div>
            <div class="user-meta">
              <div><span>昵称：</span><strong data-role="nickname">未读取</strong></div>
              <div><span>UID：</span><strong data-role="uid">未读取</strong></div>
              <div><span>用户名：</span><strong data-role="username">未读取</strong></div>
              <div><span>状态：</span><strong data-role="user-status">未读取</strong></div>
            </div>
          </div>
          <div class="maoer-sniper-logs">
            <div class="logs-header">
              <strong>运行日志</strong>
              <span data-role="log-count">0 条</span>
            </div>
            <div class="logs-box" data-role="logs-box"></div>
          </div>
          <div class="maoer-sniper-hint">
            提示：篡改猴脚本默认使用当前页面登录态发请求。
          </div>
          <div class="maoer-sniper-hint" data-role="one-time-hint"></div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    const refs = {
      root,
      body: root.querySelector(".maoer-sniper-body"),
      collapseBtn: root.querySelector("[data-action='toggle-panel']"),
      mode: root.querySelector("#maoer-mode"),
      dramaId: root.querySelector("#maoer-drama-id"),
      episodePrefix: root.querySelector("#maoer-episode-prefix"),
      intervalMs: root.querySelector("#maoer-interval"),
      targetCommentIndexField: root.querySelector("#maoer-target-comment-index-field"),
      targetCommentIndex: root.querySelector("#maoer-target-index"),
      testCommentMode: root.querySelector("#maoer-test-mode"),
      targetCommentUsernameField: root.querySelector("#maoer-target-username-field"),
      targetCommentUsername: root.querySelector("#maoer-target-username"),
      targetReplyIndexField: root.querySelector("#maoer-target-reply-index-field"),
      targetReplyIndex: root.querySelector("#maoer-target-reply-index"),
      comment: root.querySelector("#maoer-comment"),
      userinfoBtn: root.querySelector("[data-action='userinfo']"),
      startBtn: root.querySelector("[data-action='start']"),
      stopBtn: root.querySelector("[data-action='stop']"),
      runningText: root.querySelector("[data-role='running']"),
      dramaIdText: root.querySelector("[data-role='drama-id']"),
      matchedText: root.querySelector("[data-role='matched']"),
      lastCheckText: root.querySelector("[data-role='last-check']"),
      modeText: root.querySelector("[data-role='mode']"),
      targetCommentText: root.querySelector("[data-role='target-index']"),
      countLabelText: root.querySelector("[data-role='count-label']"),
      commentCountText: root.querySelector("[data-role='comment-count']"),
      targetUsernameText: root.querySelector("[data-role='target-username']"),
      resultBox: root.querySelector("[data-role='result-box']"),
      resultTitle: root.querySelector("[data-role='result-title']"),
      resultDetail: root.querySelector("[data-role='result-detail']"),
      nicknameText: root.querySelector("[data-role='nickname']"),
      uidText: root.querySelector("[data-role='uid']"),
      usernameText: root.querySelector("[data-role='username']"),
      userStatusText: root.querySelector("[data-role='user-status']"),
      logCount: root.querySelector("[data-role='log-count']"),
      logsBox: root.querySelector("[data-role='logs-box']"),
      oneTimeHint: root.querySelector("[data-role='one-time-hint']"),
    };

    refs.mode.value = state.settings.mode;
    refs.dramaId.value = state.settings.dramaId;
    refs.episodePrefix.value = state.settings.episodePrefix;
    refs.intervalMs.value = state.settings.intervalMs;
    refs.targetCommentIndex.value = state.settings.targetCommentIndex;
    refs.targetCommentUsername.value = state.settings.targetCommentUsername;
    refs.targetReplyIndex.value = state.settings.targetReplyIndex;
    refs.testCommentMode.checked = state.settings.testCommentMode;
    refs.comment.value = state.settings.comment;

    return refs;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #maoer-sniper-root {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483646;
        width: 420px;
        max-height: calc(100vh - 36px);
        color: #e5e7eb;
        font-size: 14px;
        line-height: 1.4;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #maoer-sniper-root * {
        box-sizing: border-box;
      }
      #maoer-sniper-root .maoer-sniper-card {
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 16px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.45);
        overflow: hidden;
      }
      #maoer-sniper-root .maoer-sniper-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      }
      #maoer-sniper-root .maoer-sniper-title {
        font-size: 16px;
        font-weight: 700;
      }
      #maoer-sniper-root .maoer-sniper-subtitle {
        margin-top: 4px;
        font-size: 12px;
        color: #94a3b8;
      }
      #maoer-sniper-root .maoer-sniper-collapse,
      #maoer-sniper-root button {
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(30, 41, 59, 0.96);
        color: #e5e7eb;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
      }
      #maoer-sniper-root button.primary {
        background: #2563eb;
        border-color: #2563eb;
      }
      #maoer-sniper-root .maoer-sniper-body {
        padding: 16px;
        overflow: auto;
        max-height: calc(100vh - 100px);
      }
      #maoer-sniper-root .maoer-sniper-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      #maoer-sniper-root .maoer-sniper-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #maoer-sniper-root .maoer-sniper-field label {
        font-size: 12px;
        color: #cbd5e1;
      }
      #maoer-sniper-root .maoer-sniper-field input,
      #maoer-sniper-root .maoer-sniper-field select,
      #maoer-sniper-root .maoer-sniper-field textarea {
        width: 100%;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.86);
        color: #f8fafc;
        border-radius: 10px;
        padding: 10px 12px;
      }
      #maoer-sniper-root .maoer-sniper-field textarea {
        min-height: 84px;
        resize: vertical;
      }
      #maoer-sniper-root .maoer-sniper-full {
        grid-column: 1 / -1;
      }
      #maoer-sniper-root .maoer-sniper-checkbox {
        justify-content: center;
        min-height: 72px;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.42);
        transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }
      #maoer-sniper-root .maoer-sniper-checkbox:has(input:checked) {
        border-color: rgba(250, 204, 21, 0.9);
        background: rgba(250, 204, 21, 0.18);
        box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.18);
      }
      #maoer-sniper-root .maoer-sniper-checkbox:has(input:checked) label {
        color: #fde68a;
        font-weight: 700;
      }
      #maoer-sniper-root .maoer-sniper-checkbox input {
        width: 22px;
        height: 22px;
        padding: 0;
        accent-color: #facc15;
      }
      #maoer-sniper-root .maoer-test-mode-note {
        display: none;
        color: #fef3c7;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
      }
      #maoer-sniper-root .maoer-sniper-checkbox:has(input:checked) .maoer-test-mode-note {
        display: block;
      }
      #maoer-sniper-root .maoer-sniper-actions {
        display: flex;
        gap: 10px;
        margin-top: 14px;
      }
      #maoer-sniper-root .maoer-sniper-status {
        margin-top: 14px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      #maoer-sniper-root .maoer-sniper-status .item {
        background: rgba(30, 41, 59, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 12px;
        padding: 10px;
      }
      #maoer-sniper-root .label {
        color: #94a3b8;
        font-size: 12px;
      }
      #maoer-sniper-root .value {
        margin-top: 6px;
        font-size: 13px;
        word-break: break-word;
      }
      #maoer-sniper-root .maoer-sniper-result {
        margin-top: 14px;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(30, 41, 59, 0.72);
      }
      #maoer-sniper-root .maoer-sniper-result.success {
        border-color: rgba(34, 197, 94, 0.6);
      }
      #maoer-sniper-root .maoer-sniper-result.error {
        border-color: rgba(239, 68, 68, 0.6);
      }
      #maoer-sniper-root .maoer-sniper-result .title,
      #maoer-sniper-root .maoer-sniper-user .title {
        font-weight: 700;
      }
      #maoer-sniper-root .maoer-sniper-result .detail,
      #maoer-sniper-root .maoer-sniper-user pre {
        margin-top: 8px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #maoer-sniper-root .maoer-sniper-user {
        margin-top: 14px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(30, 41, 59, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.16);
      }
      #maoer-sniper-root .user-meta {
        display: grid;
        gap: 6px;
        margin-top: 8px;
      }
      #maoer-sniper-root .logs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #maoer-sniper-root .maoer-sniper-logs {
        margin-top: 14px;
      }
      #maoer-sniper-root .logs-box {
        margin-top: 8px;
        max-height: 220px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #maoer-sniper-root .log-line {
        border-radius: 10px;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.82);
        white-space: pre-wrap;
        word-break: break-word;
      }
      #maoer-sniper-root .log-line.warn {
        border-color: rgba(250, 204, 21, 0.4);
      }
      #maoer-sniper-root .log-line.error {
        border-color: rgba(239, 68, 68, 0.45);
      }
      #maoer-sniper-root .maoer-sniper-hint {
        margin-top: 12px;
        font-size: 12px;
        color: #94a3b8;
      }
      #maoer-sniper-root.collapsed .maoer-sniper-body {
        display: none;
      }
      @media (max-width: 640px) {
        #maoer-sniper-root {
          right: 8px;
          left: 8px;
          width: auto;
          bottom: 8px;
        }
        #maoer-sniper-root .maoer-sniper-grid,
        #maoer-sniper-root .maoer-sniper-status {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function bindEvents() {
    function syncModeFields() {
      const isSubcommentMode = ui.mode.value === "subcomment";
      ui.targetCommentIndexField.style.display = isSubcommentMode ? "none" : "";
      ui.targetCommentUsernameField.style.display = isSubcommentMode ? "" : "none";
      ui.targetReplyIndexField.style.display = isSubcommentMode ? "" : "none";
    }

    ui.collapseBtn.addEventListener("click", () => {
      ui.root.classList.toggle("collapsed");
      ui.collapseBtn.textContent = ui.root.classList.contains("collapsed")
        ? "展开"
        : "收起";
    });

    const saveField = () => {
      state.settings = collectSettings();
      saveSettings();
      renderStatus();
    };

    [
      ui.mode,
      ui.dramaId,
      ui.episodePrefix,
      ui.intervalMs,
      ui.targetCommentIndex,
      ui.targetCommentUsername,
      ui.targetReplyIndex,
      ui.comment,
    ].forEach((element) => {
      element.addEventListener("input", saveField);
      element.addEventListener("change", saveField);
    });

    ui.testCommentMode.addEventListener("change", () => {
      state.settings = collectSettings();
      saveSettings();
      renderStatus();
    });

    ui.mode.addEventListener("change", () => {
      syncModeFields();
      state.settings = collectSettings();
      saveSettings();
      renderStatus();
    });

    ui.userinfoBtn.addEventListener("click", async () => {
      if (state.oneTimeUsed) {
        alert("这份脚本已经成功使用过一次，已失效。请让对方重新粘贴一份新的脚本代码。");
        return;
      }
      ui.userinfoBtn.disabled = true;
      try {
        const userInfo = await fetchUserInfo();
        state.userInfo = userInfo;
        const info = userInfo?.info || {};
        addLog(`读取用户信息成功：nickname=${info.nickname || "未知"}，uid=${info.uid || "未知"}`);
        renderUserInfo();
      } catch (error) {
        state.userInfo = null;
        addLog(`读取用户信息失败：${error.message}`, "error");
        renderUserInfo();
        alert(error.message);
      } finally {
        ui.userinfoBtn.disabled = false;
      }
    });

    ui.startBtn.addEventListener("click", async () => {
      if (state.oneTimeUsed) {
        alert("这份脚本已经成功使用过一次，已失效。请让对方重新粘贴一份新的脚本代码。");
        renderStatus();
        return;
      }
      ui.startBtn.disabled = true;
      try {
        const settings = collectSettings();
        validateSettings(settings);
        state.settings = settings;
        saveSettings();

        if (state.running) {
          stopMonitoring("收到新的开始请求，旧任务已停止");
        }

        resetRuntimeFields();
        state.running = true;
        state.startTime = new Date().toISOString();
        state.currentTaskId += 1;
        state.lastNotifiedResultKey = "";
        renderAll();

        const taskId = state.currentTaskId;
        monitorLoop(taskId, settings).catch((error) => {
          addLog(`后台任务异常退出：${error.message}`, "error");
          stopMonitoring("后台任务异常退出，已停止");
          renderAll();
        });
      } catch (error) {
        alert(error.message);
      } finally {
        ui.startBtn.disabled = false;
      }
    });

    ui.stopBtn.addEventListener("click", () => {
      stopMonitoring("用户手动停止监控");
      renderAll();
    });

    syncModeFields();
  }

  function collectSettings() {
    return {
      mode: ui.mode.value === "subcomment" ? "subcomment" : "comment",
      dramaId: ui.dramaId.value.trim(),
      episodePrefix: ui.episodePrefix.value.trim(),
      intervalMs: String(Math.max(MIN_INTERVAL_MS, Number(ui.intervalMs.value) || MIN_INTERVAL_MS)),
      targetCommentIndex: ui.targetCommentIndex.value === "2" ? "2" : "1",
      targetCommentUsername: ui.targetCommentUsername.value.trim(),
      targetReplyIndex: ui.targetReplyIndex.value === "1" ? "1" : "2",
      testCommentMode: ui.testCommentMode.checked,
      comment: ui.comment.value.trim(),
    };
  }

  function validateSettings(settings) {
    if (!settings.dramaId) {
      throw new Error("剧ID 不能为空");
    }
    if (!/^\d+$/.test(settings.dramaId)) {
      throw new Error("剧ID 必须是数字");
    }
    if (!settings.episodePrefix) {
      throw new Error("目标集数前缀不能为空");
    }
    if (settings.mode === "subcomment" && !settings.targetCommentUsername) {
      throw new Error("目标主评论用户名不能为空");
    }
    if (!settings.comment) {
      throw new Error("评论内容不能为空");
    }
  }

  function resetRuntimeFields() {
    state.startTime = null;
    state.lastCheckAt = null;
    state.currentCommentCount = null;
    state.currentReplyCount = null;
    state.matchedItemId = null;
    state.matchedSoundId = null;
    state.matchedEpisodeName = "";
    state.matchedTargetCommentId = null;
    state.matchedTargetCommentUsername = "";
    state.lastCommentResult = null;
  }

  function buildActionLabel(config) {
    if (config.mode === "subcomment") {
      if (config.testCommentMode) {
        return `测试回复模式，目标用户名：${config.targetCommentUsername}`;
      }
      return `目标用户名：${config.targetCommentUsername}，目标位次：第${config.targetReplyIndex}条回复`;
    }

    if (config.testCommentMode) {
      return "测试评论模式";
    }

    return `目标位次：第${config.targetCommentIndex}条评论`;
  }

  function addLog(message, level = "info") {
    state.logs.push({
      time: new Date().toISOString(),
      level,
      message,
    });
    if (state.logs.length > MAX_LOGS) {
      state.logs.splice(0, state.logs.length - MAX_LOGS);
    }
    renderLogs();
  }

  function stopMonitoring(reason = "已停止监控", level = "warn") {
    const wasRunning = state.running;
    state.running = false;
    state.currentTaskId += 1;
    if (wasRunning) {
      addLog(reason, level);
    }
    renderStatus();
  }

  function isReleaseConsumed() {
    try {
      return Boolean(localStorage.getItem(ONE_TIME_STATUS_KEY));
    } catch (error) {
      return false;
    }
  }

  function consumeCurrentRelease(meta) {
    try {
      localStorage.setItem(
        ONE_TIME_STATUS_KEY,
        JSON.stringify({
          usedAt: new Date().toISOString(),
          ...meta,
        })
      );
    } catch (error) {
      // 忽略本地存储失败，至少在当前页面内锁住。
    }
    state.oneTimeUsed = true;
    renderStatus();
  }

  function getReleaseConsumeInfo() {
    try {
      const raw = localStorage.getItem(ONE_TIME_STATUS_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  async function monitorLoop(taskId, config) {
    let checkCount = 0;
    let lastCount = null;
    addLog(
      `低延迟抢评已启动，剧ID：${config.dramaId}，目标前缀：${config.episodePrefix}，${buildActionLabel(
        config
      )}，轮询间隔：${config.intervalMs}ms`
    );

    while (state.running && taskId === state.currentTaskId) {
      try {
        checkCount += 1;
        state.lastCheckAt = new Date().toISOString();
        renderStatus();

        if (!state.matchedSoundId) {
          const result = await fetchDrama(config.dramaId);
          const match = findEpisodeByPrefix(result.episodes, config.episodePrefix);

          if (!match) {
            if (checkCount === 1 || checkCount % 20 === 0) {
              addLog(
                `抢评进行中：已检查 ${checkCount} 轮，当前仍未发现以“${config.episodePrefix}”开头的剧集`
              );
            }
            await sleep(Number(config.intervalMs));
            continue;
          }

          state.matchedItemId = match.id ?? null;
          state.matchedSoundId = match.sound_id ?? null;
          state.matchedEpisodeName = match.name ?? "";
          addLog(
            `已命中目标剧集：${state.matchedEpisodeName}，item.id=${state.matchedItemId}，sound_id=${state.matchedSoundId}`
          );
          renderStatus();

          if (!state.matchedSoundId) {
            addLog("目标剧集缺少 sound_id，无法发评论", "error");
            setCommentResult("error", "目标剧集缺少 sound_id，无法发评论", {
              episodeName: state.matchedEpisodeName,
              soundId: state.matchedSoundId,
              mode: config.mode,
              testCommentMode: config.testCommentMode,
              targetCommentIndex: Number(config.targetCommentIndex),
              targetCommentUsername: config.targetCommentUsername,
              targetReplyIndex: Number(config.targetReplyIndex),
            });
            stopMonitoring("缺少 sound_id，已自动停止");
            return;
          }
        }

        if (config.mode === "subcomment") {
          const commentListResult = await fetchCommentList(state.matchedSoundId);
          const targetComment = findCommentByUsername(
            commentListResult.comments,
            config.targetCommentUsername
          );

          if (!targetComment) {
            state.currentReplyCount = null;
            state.matchedTargetCommentId = null;
            state.matchedTargetCommentUsername = "";
            renderStatus();
            if (checkCount === 1 || checkCount % 20 === 0) {
              addLog(`回复抢评进行中：当前第一页未找到用户名“${config.targetCommentUsername}”的主评论`);
            }
            await sleep(Number(config.intervalMs));
            continue;
          }

          state.matchedTargetCommentId = targetComment.id ?? null;
          state.matchedTargetCommentUsername =
            typeof targetComment.username === "string"
              ? targetComment.username
              : config.targetCommentUsername;
          state.currentReplyCount = Number.isFinite(targetComment.sub_comment_num)
            ? targetComment.sub_comment_num
            : Array.isArray(targetComment.subcomments)
            ? targetComment.subcomments.length
            : null;
          renderStatus();

          if (lastCount !== state.currentReplyCount) {
            lastCount = state.currentReplyCount;
            addLog(
              `已找到目标主评论：username=${state.matchedTargetCommentUsername}，comment_id=${state.matchedTargetCommentId}，当前回复数：${
                typeof state.currentReplyCount === "number" ? state.currentReplyCount : "未知"
              }`
            );
          }

          if (!state.matchedTargetCommentId) {
            setCommentResult("error", "目标主评论缺少 comment_id，无法发回复", {
              episodeName: state.matchedEpisodeName,
              soundId: state.matchedSoundId,
              mode: "subcomment",
              targetCommentUsername: config.targetCommentUsername,
              targetReplyIndex: Number(config.targetReplyIndex),
            });
            addLog("目标主评论缺少 comment_id，无法发回复", "error");
            stopMonitoring("缺少目标主评论 ID，已自动停止");
            return;
          }

          if (config.testCommentMode) {
            addLog("测试回复模式：已跳过回复数校验，直接发起回复");
            await submitSubComment(config, true);
            return;
          }

          if (
            Number(config.targetReplyIndex) === 1 &&
            typeof state.currentReplyCount === "number" &&
            state.currentReplyCount >= 1
          ) {
            const message = "已错过第1条回复";
            setCommentResult("error", message, {
              episodeName: state.matchedEpisodeName,
              soundId: state.matchedSoundId,
              mode: "subcomment",
              targetCommentUsername: state.matchedTargetCommentUsername,
              targetCommentId: state.matchedTargetCommentId,
              currentReplyCount: state.currentReplyCount,
              targetReplyIndex: 1,
              testCommentMode: false,
            });
            addLog(message, "warn");
            stopMonitoring("已错过目标回复位次，自动停止");
            return;
          }

          if (
            Number(config.targetReplyIndex) === 2 &&
            typeof state.currentReplyCount === "number" &&
            state.currentReplyCount >= 2
          ) {
            const message = "已错过第2条回复";
            setCommentResult("error", message, {
              episodeName: state.matchedEpisodeName,
              soundId: state.matchedSoundId,
              mode: "subcomment",
              targetCommentUsername: state.matchedTargetCommentUsername,
              targetCommentId: state.matchedTargetCommentId,
              currentReplyCount: state.currentReplyCount,
              targetReplyIndex: 2,
              testCommentMode: false,
            });
            addLog(message, "warn");
            stopMonitoring("已错过目标回复位次，自动停止");
            return;
          }

          const readyToReply =
            (Number(config.targetReplyIndex) === 1 && state.currentReplyCount === 0) ||
            (Number(config.targetReplyIndex) === 2 && state.currentReplyCount === 1);

          if (!readyToReply) {
            await sleep(Number(config.intervalMs));
            continue;
          }

          addLog(
            `已满足第${config.targetReplyIndex}条回复条件，立即给用户名“${state.matchedTargetCommentUsername}”的主评论发回复`
          );
          await submitSubComment(config, false);
          return;
        }

        if (config.testCommentMode) {
          addLog("测试评论模式：已跳过评论数校验，直接发起评论");
          await submitComment(config, true);
          return;
        }

        const commentListResult = await fetchCommentList(state.matchedSoundId);
        state.currentCommentCount = commentListResult.count;
        renderStatus();

        if (lastCount !== state.currentCommentCount) {
          lastCount = state.currentCommentCount;
          addLog(
            `当前主评论数：${state.currentCommentCount}，目标位次：第${config.targetCommentIndex}条评论`
          );
        }

        if (Number(config.targetCommentIndex) === 1 && state.currentCommentCount >= 1) {
          const message = "已错过第1条评论";
          setCommentResult("error", message, {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            currentCommentCount: state.currentCommentCount,
            targetCommentIndex: 1,
            testCommentMode: false,
          });
          addLog(message, "warn");
          stopMonitoring("已错过目标位次，自动停止");
          return;
        }

        if (Number(config.targetCommentIndex) === 2 && state.currentCommentCount >= 2) {
          const message = "已错过第2条评论";
          setCommentResult("error", message, {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            currentCommentCount: state.currentCommentCount,
            targetCommentIndex: 2,
            testCommentMode: false,
          });
          addLog(message, "warn");
          stopMonitoring("已错过目标位次，自动停止");
          return;
        }

        const readyToComment =
          (Number(config.targetCommentIndex) === 1 && state.currentCommentCount === 0) ||
          (Number(config.targetCommentIndex) === 2 && state.currentCommentCount === 1);

        if (!readyToComment) {
          await sleep(Number(config.intervalMs));
          continue;
        }

        addLog(`已满足第${config.targetCommentIndex}条评论条件，立即发起评论`);
        await submitComment(config, false);
        return;
      } catch (error) {
        addLog(`监控异常：${error.message}`, "error");
        await sleep(Number(config.intervalMs));
      }
    }
  }

  async function submitComment(config, testMode) {
    const commentResult = await addComment(state.matchedSoundId, config.comment);
    if (commentResult.payload?.success) {
      consumeCurrentRelease({
        type: "comment",
        episodeName: state.matchedEpisodeName,
        soundId: state.matchedSoundId,
      });
      setCommentResult("success", testMode ? "测试评论发送成功" : "评论发送成功", {
        episodeName: state.matchedEpisodeName,
        soundId: state.matchedSoundId,
        currentCommentCount: testMode ? null : state.currentCommentCount,
        targetCommentIndex: Number(config.targetCommentIndex),
        testCommentMode: Boolean(testMode),
      });
      addLog(testMode ? "测试评论发送成功，监控结束" : "评论发送成功，监控结束");
      stopMonitoring(testMode ? "测试评论成功，已自动停止" : "评论成功，已自动停止");
      return;
    }

    const message =
      commentResult.payload?.info ||
      commentResult.payload?.message ||
      commentResult.rawText ||
      `HTTP ${commentResult.status}`;

    setCommentResult("error", `${testMode ? "测试评论发送失败" : "评论发送失败"}：${message}`, {
      episodeName: state.matchedEpisodeName,
      soundId: state.matchedSoundId,
        mode: "comment",
      currentCommentCount: testMode ? null : state.currentCommentCount,
      targetCommentIndex: Number(config.targetCommentIndex),
      testCommentMode: Boolean(testMode),
    });
    addLog(`${testMode ? "测试评论发送失败" : "评论发送失败"}：${message}`, "error");
    stopMonitoring(testMode ? "测试评论失败，已自动停止" : "评论失败，已自动停止");
  }

  async function submitSubComment(config, testMode) {
    const subCommentResult = await addSubComment(state.matchedTargetCommentId, config.comment);
    if (subCommentResult.payload?.success) {
      consumeCurrentRelease({
        type: "subcomment",
        episodeName: state.matchedEpisodeName,
        soundId: state.matchedSoundId,
        targetCommentId: state.matchedTargetCommentId,
      });
      setCommentResult("success", testMode ? "测试回复发送成功" : "回复发送成功", {
        episodeName: state.matchedEpisodeName,
        soundId: state.matchedSoundId,
        mode: "subcomment",
        targetCommentUsername: state.matchedTargetCommentUsername,
        targetCommentId: state.matchedTargetCommentId,
        currentReplyCount: testMode ? null : state.currentReplyCount,
        targetReplyIndex: Number(config.targetReplyIndex),
        testCommentMode: Boolean(testMode),
      });
      addLog(testMode ? "测试回复发送成功，监控结束" : "回复发送成功，监控结束");
      stopMonitoring(testMode ? "测试回复成功，已自动停止" : "回复成功，已自动停止");
      return;
    }

    const message =
      subCommentResult.payload?.info ||
      subCommentResult.payload?.message ||
      subCommentResult.rawText ||
      `HTTP ${subCommentResult.status}`;

    setCommentResult("error", `${testMode ? "测试回复发送失败" : "回复发送失败"}：${message}`, {
      episodeName: state.matchedEpisodeName,
      soundId: state.matchedSoundId,
      mode: "subcomment",
      targetCommentUsername: state.matchedTargetCommentUsername,
      targetCommentId: state.matchedTargetCommentId,
      currentReplyCount: testMode ? null : state.currentReplyCount,
      targetReplyIndex: Number(config.targetReplyIndex),
      testCommentMode: Boolean(testMode),
    });
    addLog(`${testMode ? "测试回复发送失败" : "回复发送失败"}：${message}`, "error");
    stopMonitoring(testMode ? "测试回复失败，已自动停止" : "回复失败，已自动停止");
  }

  function setCommentResult(status, message, extra = {}) {
    state.lastCommentResult = {
      status,
      message,
      time: new Date().toISOString(),
      ...extra,
    };
    renderCommentResult();
  }

  async function fetchDrama(dramaId) {
    const response = await fetch(getDramaUrl(dramaId), {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        "accept-language": "zh,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`获取剧集接口失败，HTTP ${response.status}`);
    }

    const data = await response.json();
    const episodes = data?.info?.episodes?.episode;
    if (!Array.isArray(episodes)) {
      throw new Error("接口返回结构异常，未找到 info.episodes.episode");
    }

    return {
      success: Boolean(data?.success),
      episodes,
    };
  }

  async function fetchUserInfo() {
    const response = await fetch("/account/userinfo", {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        "accept-language": "zh,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`获取用户信息失败，HTTP ${response.status}`);
    }

    return response.json();
  }

  async function fetchCommentList(soundId) {
    const response = await fetch(getCommentUrl(soundId), {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "zh,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      throw new Error(`获取评论列表失败，HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data?.success === false) {
      throw new Error(data?.info || data?.message || "获取评论列表失败");
    }

    const comments = data?.info?.comment?.Datas;
    if (!Array.isArray(comments)) {
      throw new Error("评论列表返回结构异常，未找到 info.comment.Datas");
    }

    return {
      comments,
      count: comments.length,
    };
  }

  function findCommentByUsername(comments, targetCommentUsername) {
    return comments.find((item) => {
      const username = typeof item?.username === "string" ? item.username.trim() : "";
      return username === targetCommentUsername;
    });
  }

  async function addComment(soundId, comment) {
    const form = new FormData();
    form.append("comment", comment);
    form.append("type", "1");
    form.append("e_id", String(soundId));

    const response = await fetch("/site/addcomment", {
      method: "POST",
      credentials: "include",
      body: form,
    });

    const rawText = await response.text();
    let payload = null;

    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      payload = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
      rawText,
    };
  }

  async function addSubComment(commentId, comment) {
    const form = new FormData();
    form.append("targetType", "comment");
    form.append("comment_id", String(commentId));
    form.append("sub", "0");
    form.append("comment", comment);

    const response = await fetch("/site/addsubcomment", {
      method: "POST",
      credentials: "include",
      body: form,
    });

    const rawText = await response.text();
    let payload = null;

    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      payload = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
      rawText,
    };
  }

  function findEpisodeByPrefix(episodes, episodePrefix) {
    return episodes.find((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      return name.startsWith(episodePrefix);
    });
  }

  function getDramaUrl(dramaId) {
    return `/dramaapi/getdrama?drama_id=${encodeURIComponent(dramaId)}`;
  }

  function getCommentUrl(soundId) {
    return `/site/getcomment?type=1&e_id=${encodeURIComponent(soundId)}&order=3&p=1&pagesize=20`;
  }

  function renderAll() {
    renderStatus();
    renderCommentResult();
    renderUserInfo();
    renderLogs();
  }

  function renderStatus() {
    const isSubcommentMode = state.settings.mode === "subcomment";
    const consumedInfo = getReleaseConsumeInfo();
    ui.runningText.textContent = state.running ? "运行中" : "已停止";
    ui.dramaIdText.textContent = state.settings.dramaId || "暂无";
    ui.modeText.textContent = isSubcommentMode ? "抢指定评论下的回复" : "抢节目主评论";
    ui.matchedText.textContent = state.matchedSoundId
      ? isSubcommentMode && state.matchedTargetCommentId
        ? `${state.matchedEpisodeName} / ${state.matchedTargetCommentUsername || "目标用户"} (comment_id=${state.matchedTargetCommentId})`
        : `${state.matchedEpisodeName} (sound_id=${state.matchedSoundId})`
      : "暂无";
    ui.lastCheckText.textContent = formatTime(state.lastCheckAt);
    ui.targetCommentText.textContent = isSubcommentMode
      ? state.settings.testCommentMode
        ? "测试回复模式"
        : `第${state.settings.targetReplyIndex || 2}条回复`
      : state.settings.testCommentMode
      ? "测试评论模式"
      : `第${state.settings.targetCommentIndex || 1}条评论`;
    ui.countLabelText.textContent = isSubcommentMode ? "当前回复数" : "当前主评论数";
    ui.commentCountText.textContent = isSubcommentMode
      ? state.settings.testCommentMode
        ? "已跳过"
        : typeof state.currentReplyCount === "number"
        ? String(state.currentReplyCount)
        : "暂无"
      : state.settings.testCommentMode
      ? "已跳过"
      : typeof state.currentCommentCount === "number"
      ? String(state.currentCommentCount)
      : "暂无";
    ui.targetUsernameText.textContent = isSubcommentMode
      ? state.settings.targetCommentUsername || state.matchedTargetCommentUsername || "暂无"
      : "暂无";
    ui.startBtn.disabled = state.oneTimeUsed;
    ui.oneTimeHint.textContent = state.oneTimeUsed
      ? `当前脚本已失效：该发布编号 ${ONE_TIME_RELEASE_ID} 已在 ${
          formatTime(consumedInfo?.usedAt) || "未知时间"
        } 成功使用过一次。要再次使用，请重新粘贴一份带新发布编号的脚本代码。`
      : `当前为单次使用脚本，发布编号：${ONE_TIME_RELEASE_ID}。抢评成功一次后将自动失效。`;
  }

  function renderCommentResult() {
    const result = state.lastCommentResult;
    if (!result) {
      ui.resultBox.style.display = "none";
      ui.resultBox.className = "maoer-sniper-result";
      ui.resultTitle.textContent = "暂无结果";
      ui.resultDetail.textContent = "";
      return;
    }

    const statusText =
      result.status === "success"
        ? result.mode === "subcomment"
          ? "回复成功"
          : "评论成功"
        : result.mode === "subcomment"
        ? "回复失败"
        : "评论失败";
    const detailLines = [
      `时间：${formatTime(result.time)}`,
      `剧集：${result.episodeName || "未知"}`,
      `sound_id：${result.soundId || "未知"}`,
      `模式：${
        result.mode === "subcomment"
          ? result.testCommentMode
            ? "测试回复"
            : `第${result.targetReplyIndex || 2}条回复`
          : result.testCommentMode
          ? "测试评论"
          : `第${result.targetCommentIndex || 1}条评论`
      }`,
      ...(result.mode === "subcomment"
        ? [
            `目标用户名：${result.targetCommentUsername || "未知"}`,
            `目标主评论ID：${result.targetCommentId || "未知"}`,
          ]
        : []),
      `${result.mode === "subcomment" ? "当前回复数" : "当前主评论数"}：${
        result.testCommentMode
          ? "已跳过"
          : typeof (result.mode === "subcomment"
              ? result.currentReplyCount
              : result.currentCommentCount) === "number"
          ? result.mode === "subcomment"
            ? result.currentReplyCount
            : result.currentCommentCount
          : "未知"
      }`,
      `结果：${result.message || "未知"}`,
    ];

    ui.resultBox.style.display = "block";
    ui.resultBox.className = `maoer-sniper-result ${result.status === "success" ? "success" : "error"}`;
    ui.resultTitle.textContent = statusText;
    ui.resultDetail.textContent = detailLines.join("\n");

    const resultKey = `${result.time || ""}-${result.status || ""}-${result.message || ""}`;
    if (resultKey && resultKey !== state.lastNotifiedResultKey) {
      state.lastNotifiedResultKey = resultKey;
      alert(`${statusText}\n${result.message || ""}`);
    }
  }

  function renderUserInfo() {
    const payload = state.userInfo;
    if (!payload) {
      ui.nicknameText.textContent = "未读取";
      ui.uidText.textContent = "未读取";
      ui.usernameText.textContent = "未读取";
      ui.userStatusText.textContent = "未读取";
      return;
    }

    const info = payload.info || {};
    ui.nicknameText.textContent = info.nickname || "未知";
    ui.uidText.textContent = info.uid || info.id || "未知";
    ui.usernameText.textContent = info.username || info.mobile || "未知";
    ui.userStatusText.textContent = payload.success ? "已登录/已返回" : "返回异常";
  }

  function renderLogs() {
    ui.logCount.textContent = `${state.logs.length} 条`;
    ui.logsBox.innerHTML = "";

    if (!state.logs.length) {
      const item = document.createElement("div");
      item.className = "log-line";
      item.textContent = "暂无日志";
      ui.logsBox.appendChild(item);
      return;
    }

    state.logs.forEach((log) => {
      const item = document.createElement("div");
      item.className = `log-line ${log.level || "info"}`;
      item.textContent = `[${formatTime(log.time)}] ${log.message}`;
      ui.logsBox.appendChild(item);
    });

    ui.logsBox.scrollTop = ui.logsBox.scrollHeight;
  }

  function formatTime(value) {
    if (!value) {
      return "暂无";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
