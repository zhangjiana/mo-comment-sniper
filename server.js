const http = require("http");
const fs = require("fs");
const path = require("path");
const { setTimeout: delay } = require("timers/promises");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_DRAMA_ID = "86740";
const ADD_COMMENT_URL = "https://www.missevan.com/site/addcomment";
const ADD_SUBCOMMENT_URL = "https://www.missevan.com/site/addsubcomment";
const USER_INFO_URL = "https://www.missevan.com/account/userinfo";
const GET_COMMENT_URL = (soundId) =>
  `https://www.missevan.com/site/getcomment?type=1&e_id=${soundId}&order=3&p=1&pagesize=20`;
const MAX_LOGS = 200;
const MIN_INTERVAL_MS = 500;

const state = {
  running: false,
  currentTaskId: 0,
  startTime: null,
  lastCheckAt: null,
  dramaId: DEFAULT_DRAMA_ID,
  intervalMs: MIN_INTERVAL_MS,
  mode: "comment",
  episodePrefix: "",
  comment: "",
  testCommentMode: false,
  targetCommentIndex: 1,
  targetCommentUsername: "",
  targetReplyIndex: 2,
  currentCommentCount: null,
  currentReplyCount: null,
  matchedItemId: null,
  matchedSoundId: null,
  matchedEpisodeName: "",
  matchedTargetCommentId: null,
  matchedTargetCommentUsername: "",
  userInfo: null,
  lastCommentResult: null,
  logs: [],
};

function addLog(message, level = "info") {
  const log = {
    time: new Date().toISOString(),
    level,
    message,
  };

  state.logs.push(log);
  if (state.logs.length > MAX_LOGS) {
    state.logs.splice(0, state.logs.length - MAX_LOGS);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function setCommentResult(status, message, extra = {}) {
  state.lastCommentResult = {
    status,
    message,
    time: new Date().toISOString(),
    ...extra,
  };
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

function getDramaReferer(dramaId) {
  return `https://www.missevan.com/mdrama/${dramaId}`;
}

function getDramaUrl(dramaId) {
  return `https://www.missevan.com/dramaapi/getdrama?drama_id=${dramaId}`;
}

function buildHeaders(cookie, accept = "application/json", dramaId = state.dramaId) {
  return {
    accept,
    "accept-language": "zh,en;q=0.9",
    cookie,
    referer: getDramaReferer(dramaId),
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  };
}

async function readJsonBody(req) {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
  }

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function fetchDrama(cookie, dramaId) {
  const response = await fetch(getDramaUrl(dramaId), {
    method: "GET",
    headers: buildHeaders(cookie, "application/json", dramaId),
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

async function fetchUserInfo(cookie, dramaId) {
  const response = await fetch(USER_INFO_URL, {
    method: "GET",
    headers: buildHeaders(cookie, "application/json", dramaId),
  });

  if (!response.ok) {
    throw new Error(`获取用户信息失败，HTTP ${response.status}`);
  }

  const data = await response.json();
  return data;
}

async function fetchCommentList(cookie, soundId, dramaId) {
  const response = await fetch(GET_COMMENT_URL(soundId), {
    method: "GET",
    headers: {
      ...buildHeaders(
        cookie,
        "application/json, text/javascript, */*; q=0.01",
        dramaId
      ),
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
    const username =
      typeof item?.username === "string" ? item.username.trim() : "";
    return username === targetCommentUsername;
  });
}

function findEpisodeByPrefix(episodes, episodePrefix) {
  return episodes.find((item) => {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    return name.startsWith(episodePrefix);
  });
}

async function addComment(cookie, soundId, comment, dramaId) {
  const form = new FormData();
  form.append("comment", comment);
  form.append("type", "1");
  form.append("e_id", String(soundId));

  const response = await fetch(ADD_COMMENT_URL, {
    method: "POST",
    headers: buildHeaders(cookie, "*/*", dramaId),
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

async function addSubComment(cookie, commentId, comment, dramaId) {
  const form = new FormData();
  form.append("targetType", "comment");
  form.append("comment_id", String(commentId));
  form.append("sub", "0");
  form.append("comment", comment);

  const response = await fetch(ADD_SUBCOMMENT_URL, {
    method: "POST",
    headers: buildHeaders(cookie, "*/*", dramaId),
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

function snapshotState() {
  return {
    running: state.running,
    startTime: state.startTime,
    lastCheckAt: state.lastCheckAt,
    dramaId: state.dramaId,
    intervalMs: state.intervalMs,
    mode: state.mode,
    episodePrefix: state.episodePrefix,
    comment: state.comment,
    testCommentMode: state.testCommentMode,
    targetCommentIndex: state.targetCommentIndex,
    targetCommentUsername: state.targetCommentUsername,
    targetReplyIndex: state.targetReplyIndex,
    currentCommentCount: state.currentCommentCount,
    currentReplyCount: state.currentReplyCount,
    matchedItemId: state.matchedItemId,
    matchedSoundId: state.matchedSoundId,
    matchedEpisodeName: state.matchedEpisodeName,
    matchedTargetCommentId: state.matchedTargetCommentId,
    matchedTargetCommentUsername: state.matchedTargetCommentUsername,
    userInfo: state.userInfo,
    lastCommentResult: state.lastCommentResult,
    logs: state.logs,
  };
}

function resetRuntimeFields() {
  state.startTime = null;
  state.lastCheckAt = null;
  state.testCommentMode = false;
  state.currentCommentCount = null;
  state.currentReplyCount = null;
  state.matchedItemId = null;
  state.matchedSoundId = null;
  state.matchedEpisodeName = "";
  state.matchedTargetCommentId = null;
  state.matchedTargetCommentUsername = "";
  state.lastCommentResult = null;
}

function stopMonitoring(reason = "已停止监控") {
  const wasRunning = state.running;
  state.running = false;
  state.currentTaskId += 1;

  if (wasRunning) {
    addLog(reason, "warn");
  }
}

async function monitorLoop(taskId, config) {
  let checkCount = 0;
  let lastCommentCount = null;
  addLog(
    `低延迟抢评已启动，剧ID：${config.dramaId}，目标前缀：${config.episodePrefix}，${buildActionLabel(
      config
    )}，轮询间隔：${config.intervalMs}ms`
  );

  while (state.running && taskId === state.currentTaskId) {
    try {
      checkCount += 1;
      state.lastCheckAt = new Date().toISOString();

      if (!state.matchedSoundId) {
        const result = await fetchDrama(config.cookie, config.dramaId);
        const match = findEpisodeByPrefix(result.episodes, config.episodePrefix);

        if (!match) {
          if (checkCount === 1 || checkCount % 20 === 0) {
            addLog(
              `抢评进行中：已检查 ${checkCount} 轮，当前仍未发现以“${config.episodePrefix}”开头的剧集`
            );
          }
          await delay(config.intervalMs);
          continue;
        }

        state.matchedItemId = match.id ?? null;
        state.matchedSoundId = match.sound_id ?? null;
        state.matchedEpisodeName = match.name ?? "";
        addLog(
          `已命中目标剧集：${state.matchedEpisodeName}，item.id=${state.matchedItemId}，sound_id=${state.matchedSoundId}`
        );

        if (!state.matchedSoundId) {
          addLog("目标剧集缺少 sound_id，无法发评论", "error");
          setCommentResult("error", "目标剧集缺少 sound_id，无法发评论", {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            mode: config.mode,
            testCommentMode: config.testCommentMode,
            targetCommentIndex: config.targetCommentIndex,
            targetCommentUsername: config.targetCommentUsername,
            targetReplyIndex: config.targetReplyIndex,
          });
          stopMonitoring("缺少 sound_id，已自动停止");
          return;
        }
      }

      if (config.mode === "subcomment") {
        const commentListResult = await fetchCommentList(
          config.cookie,
          state.matchedSoundId,
          config.dramaId
        );
        const targetComment = findCommentByUsername(
          commentListResult.comments,
          config.targetCommentUsername
        );

        if (!targetComment) {
          state.currentReplyCount = null;
          state.matchedTargetCommentId = null;
          state.matchedTargetCommentUsername = "";
          if (checkCount === 1 || checkCount % 20 === 0) {
            addLog(
              `回复抢评进行中：当前第一页未找到用户名“${config.targetCommentUsername}”的主评论`
            );
          }
          await delay(config.intervalMs);
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

        if (lastCommentCount !== state.currentReplyCount) {
          lastCommentCount = state.currentReplyCount;
          addLog(
            `已找到目标主评论：username=${state.matchedTargetCommentUsername}，comment_id=${state.matchedTargetCommentId}，当前回复数：${
              typeof state.currentReplyCount === "number"
                ? state.currentReplyCount
                : "未知"
            }`
          );
        }

        if (!state.matchedTargetCommentId) {
          setCommentResult("error", "目标主评论缺少 comment_id，无法发回复", {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            mode: "subcomment",
            targetCommentUsername: config.targetCommentUsername,
            targetReplyIndex: config.targetReplyIndex,
          });
          addLog("目标主评论缺少 comment_id，无法发回复", "error");
          stopMonitoring("缺少目标主评论 ID，已自动停止");
          return;
        }

        if (config.testCommentMode) {
          addLog("测试回复模式：已跳过回复数校验，直接发起回复");
          const subCommentResult = await addSubComment(
            config.cookie,
            state.matchedTargetCommentId,
            config.comment,
            config.dramaId
          );

          if (subCommentResult.payload?.success) {
            setCommentResult("success", "测试回复发送成功", {
              episodeName: state.matchedEpisodeName,
              soundId: state.matchedSoundId,
              mode: "subcomment",
              testCommentMode: true,
              targetCommentUsername: state.matchedTargetCommentUsername,
              targetCommentId: state.matchedTargetCommentId,
              currentReplyCount: state.currentReplyCount,
              targetReplyIndex: config.targetReplyIndex,
            });
            addLog("测试回复发送成功，监控结束");
            stopMonitoring("测试回复成功，已自动停止");
            return;
          }

          const message =
            subCommentResult.payload?.info ||
            subCommentResult.payload?.message ||
            subCommentResult.rawText ||
            `HTTP ${subCommentResult.status}`;

          setCommentResult("error", `测试回复发送失败：${message}`, {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            mode: "subcomment",
            testCommentMode: true,
            targetCommentUsername: state.matchedTargetCommentUsername,
            targetCommentId: state.matchedTargetCommentId,
            currentReplyCount: state.currentReplyCount,
            targetReplyIndex: config.targetReplyIndex,
          });
          addLog(`测试回复发送失败：${message}`, "error");
          stopMonitoring("测试回复失败，已自动停止");
          return;
        }

        if (
          config.targetReplyIndex === 1 &&
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
            targetReplyIndex: config.targetReplyIndex,
          });
          addLog(message, "warn");
          stopMonitoring("已错过目标回复位次，自动停止");
          return;
        }

        if (
          config.targetReplyIndex === 2 &&
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
            targetReplyIndex: config.targetReplyIndex,
          });
          addLog(message, "warn");
          stopMonitoring("已错过目标回复位次，自动停止");
          return;
        }

        const readyToReply =
          (config.targetReplyIndex === 1 && state.currentReplyCount === 0) ||
          (config.targetReplyIndex === 2 && state.currentReplyCount === 1);

        if (!readyToReply) {
          await delay(config.intervalMs);
          continue;
        }

        addLog(
          `已满足第${config.targetReplyIndex}条回复条件，立即给用户名“${state.matchedTargetCommentUsername}”的主评论发回复`
        );
        const subCommentResult = await addSubComment(
          config.cookie,
          state.matchedTargetCommentId,
          config.comment,
          config.dramaId
        );

        if (subCommentResult.payload?.success) {
          setCommentResult("success", "回复发送成功", {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            mode: "subcomment",
            testCommentMode: false,
            targetCommentUsername: state.matchedTargetCommentUsername,
            targetCommentId: state.matchedTargetCommentId,
            currentReplyCount: state.currentReplyCount,
            targetReplyIndex: config.targetReplyIndex,
          });
          addLog("回复发送成功，监控结束");
          stopMonitoring("回复成功，已自动停止");
          return;
        }

        const message =
          subCommentResult.payload?.info ||
          subCommentResult.payload?.message ||
          subCommentResult.rawText ||
          `HTTP ${subCommentResult.status}`;

        setCommentResult("error", `回复发送失败：${message}`, {
          episodeName: state.matchedEpisodeName,
          soundId: state.matchedSoundId,
          mode: "subcomment",
          testCommentMode: false,
          targetCommentUsername: state.matchedTargetCommentUsername,
          targetCommentId: state.matchedTargetCommentId,
          currentReplyCount: state.currentReplyCount,
          targetReplyIndex: config.targetReplyIndex,
        });
        addLog(`回复发送失败：${message}`, "error");
        stopMonitoring("回复失败，已自动停止");
        return;
      }

      if (config.testCommentMode) {
        addLog("测试评论模式：已跳过评论数校验，直接发起评论");
        const commentResult = await addComment(
          config.cookie,
          state.matchedSoundId,
          config.comment,
          config.dramaId
        );

        if (commentResult.payload?.success) {
          setCommentResult("success", "测试评论发送成功", {
            episodeName: state.matchedEpisodeName,
            soundId: state.matchedSoundId,
            mode: "comment",
            testCommentMode: true,
          });
          addLog("测试评论发送成功，监控结束");
          stopMonitoring("测试评论成功，已自动停止");
          return;
        }

        const message =
          commentResult.payload?.info ||
          commentResult.payload?.message ||
          commentResult.rawText ||
          `HTTP ${commentResult.status}`;

        setCommentResult("error", `测试评论发送失败：${message}`, {
          episodeName: state.matchedEpisodeName,
          soundId: state.matchedSoundId,
          mode: "comment",
          testCommentMode: true,
        });
        addLog(`测试评论发送失败：${message}`, "error");
        stopMonitoring("测试评论失败，已自动停止");
        return;
      }

      const commentListResult = await fetchCommentList(
        config.cookie,
        state.matchedSoundId,
        config.dramaId
      );
      state.currentCommentCount = commentListResult.count;

      if (lastCommentCount !== state.currentCommentCount) {
        lastCommentCount = state.currentCommentCount;
        addLog(
          `当前主评论数：${state.currentCommentCount}，目标位次：第${config.targetCommentIndex}条评论`
        );
      }

      if (
        config.targetCommentIndex === 1 &&
        state.currentCommentCount >= 1
      ) {
        const message = "已错过第1条评论";
        setCommentResult("error", message, {
          episodeName: state.matchedEpisodeName,
          soundId: state.matchedSoundId,
          mode: "comment",
          currentCommentCount: state.currentCommentCount,
          testCommentMode: false,
          targetCommentIndex: config.targetCommentIndex,
        });
        addLog(message, "warn");
        stopMonitoring("已错过目标位次，自动停止");
        return;
      }

      if (
        config.targetCommentIndex === 2 &&
        state.currentCommentCount >= 2
      ) {
        const message = "已错过第2条评论";
        setCommentResult("error", message, {
          episodeName: state.matchedEpisodeName,
          soundId: state.matchedSoundId,
          mode: "comment",
          currentCommentCount: state.currentCommentCount,
          testCommentMode: false,
          targetCommentIndex: config.targetCommentIndex,
        });
        addLog(message, "warn");
        stopMonitoring("已错过目标位次，自动停止");
        return;
      }

      const readyToComment =
        (config.targetCommentIndex === 1 && state.currentCommentCount === 0) ||
        (config.targetCommentIndex === 2 && state.currentCommentCount === 1);

      if (!readyToComment) {
        await delay(config.intervalMs);
        continue;
      }

      addLog(`已满足第${config.targetCommentIndex}条评论条件，立即发起评论`);
      const commentResult = await addComment(
        config.cookie,
        state.matchedSoundId,
        config.comment,
        config.dramaId
      );

      if (commentResult.payload?.success) {
        setCommentResult("success", "评论发送成功", {
          episodeName: state.matchedEpisodeName,
          soundId: state.matchedSoundId,
          mode: "comment",
          currentCommentCount: state.currentCommentCount,
          testCommentMode: false,
          targetCommentIndex: config.targetCommentIndex,
        });
        addLog("评论发送成功，监控结束");
        stopMonitoring("评论成功，已自动停止");
        return;
      }

      const message =
        commentResult.payload?.info ||
        commentResult.payload?.message ||
        commentResult.rawText ||
        `HTTP ${commentResult.status}`;

      setCommentResult("error", `评论发送失败：${message}`, {
        episodeName: state.matchedEpisodeName,
        soundId: state.matchedSoundId,
        mode: "comment",
        currentCommentCount: state.currentCommentCount,
        testCommentMode: false,
        targetCommentIndex: config.targetCommentIndex,
      });
      addLog(`评论发送失败：${message}`, "error");
      stopMonitoring("评论失败，已自动停止");
      return;
    } catch (error) {
      addLog(`监控异常：${error.message}`, "error");
      await delay(config.intervalMs);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    sendHtml(res, html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, snapshotState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/start") {
    try {
      const body = await readJsonBody(req);
      const cookie = typeof body.cookie === "string" ? body.cookie.trim() : "";
      const dramaId =
        typeof body.dramaId === "string" ? body.dramaId.trim() : String(body.dramaId || "").trim();
      const mode = body.mode === "subcomment" ? "subcomment" : "comment";
      const episodePrefix =
        typeof body.episodePrefix === "string" ? body.episodePrefix.trim() : "";
      const comment =
        typeof body.comment === "string" ? body.comment.trim() : "";
      const testCommentMode = Boolean(body.testCommentMode);
      const targetCommentIndex =
        Number(body.targetCommentIndex) === 2 ? 2 : 1;
      const targetCommentUsername =
        typeof body.targetCommentUsername === "string"
          ? body.targetCommentUsername.trim()
          : "";
      const targetReplyIndex = Number(body.targetReplyIndex) === 1 ? 1 : 2;
      const intervalMs = Math.max(MIN_INTERVAL_MS, Number(body.intervalMs) || MIN_INTERVAL_MS);

      if (!cookie) {
        sendJson(res, 400, { success: false, message: "cookie 不能为空" });
        return;
      }

      if (!dramaId) {
        sendJson(res, 400, { success: false, message: "剧ID 不能为空" });
        return;
      }

      if (!/^\d+$/.test(dramaId)) {
        sendJson(res, 400, { success: false, message: "剧ID 必须是数字" });
        return;
      }

      if (!episodePrefix) {
        sendJson(res, 400, { success: false, message: "目标集数前缀不能为空" });
        return;
      }

      if (!comment) {
        sendJson(res, 400, { success: false, message: "评论内容不能为空" });
        return;
      }

      if (mode === "subcomment" && !targetCommentUsername) {
        sendJson(res, 400, { success: false, message: "目标用户名不能为空" });
        return;
      }

      if (state.running) {
        stopMonitoring("收到新的开始请求，旧任务已停止");
      }

      resetRuntimeFields();
      state.running = true;
      state.startTime = new Date().toISOString();
      state.dramaId = dramaId;
      state.intervalMs = intervalMs;
      state.mode = mode;
      state.episodePrefix = episodePrefix;
      state.comment = comment;
      state.testCommentMode = testCommentMode;
      state.targetCommentIndex = targetCommentIndex;
      state.targetCommentUsername = targetCommentUsername;
      state.targetReplyIndex = targetReplyIndex;
      state.currentTaskId += 1;

      const currentTaskId = state.currentTaskId;
      monitorLoop(currentTaskId, {
        cookie,
        dramaId,
        mode,
        episodePrefix,
        comment,
        testCommentMode,
        targetCommentIndex,
        targetCommentUsername,
        targetReplyIndex,
        intervalMs,
      }).catch((error) => {
        addLog(`后台任务异常退出：${error.message}`, "error");
        stopMonitoring("后台任务异常退出，已停止");
      });

      sendJson(res, 200, { success: true, message: "低延迟抢评已启动" });
    } catch (error) {
      sendJson(res, 400, { success: false, message: `请求参数错误：${error.message}` });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/userinfo") {
    try {
      const body = await readJsonBody(req);
      const cookie = typeof body.cookie === "string" ? body.cookie.trim() : "";
      const dramaId =
        typeof body.dramaId === "string" && body.dramaId.trim()
          ? body.dramaId.trim()
          : state.dramaId;

      if (!cookie) {
        sendJson(res, 400, { success: false, message: "cookie 不能为空" });
        return;
      }

      const data = await fetchUserInfo(cookie, dramaId);
      const info = data?.info || {};
      state.userInfo = data;

      addLog(
        `读取用户信息成功：nickname=${info.nickname || "未知"}，uid=${info.uid || "未知"}`
      );

      sendJson(res, 200, {
        success: true,
        data,
      });
    } catch (error) {
      state.userInfo = null;
      addLog(`读取用户信息失败：${error.message}`, "error");
      sendJson(res, 400, { success: false, message: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stop") {
    stopMonitoring("用户手动停止监控");
    sendJson(res, 200, { success: true, message: "监控已停止" });
    return;
  }

  sendJson(res, 404, { success: false, message: "接口不存在" });
});

server.listen(PORT, HOST, () => {
  addLog(`服务已启动：http://${HOST}:${PORT}`);
  console.log(`服务已启动：http://${HOST}:${PORT}`);
  console.log(`其他机器可通过 http://服务器IP:${PORT}/ 访问`);
});
