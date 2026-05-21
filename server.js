const http = require("http");
const fs = require("fs");
const path = require("path");
const { setTimeout: delay } = require("timers/promises");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_DRAMA_ID = "86740";
const ADD_COMMENT_URL = "https://www.missevan.com/site/addcomment";
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
  episodePrefix: "",
  comment: "",
  testCommentMode: false,
  targetCommentIndex: 1,
  currentCommentCount: null,
  matchedItemId: null,
  matchedSoundId: null,
  matchedEpisodeName: "",
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

function snapshotState() {
  return {
    running: state.running,
    startTime: state.startTime,
    lastCheckAt: state.lastCheckAt,
    dramaId: state.dramaId,
    intervalMs: state.intervalMs,
    episodePrefix: state.episodePrefix,
    comment: state.comment,
    testCommentMode: state.testCommentMode,
    targetCommentIndex: state.targetCommentIndex,
    currentCommentCount: state.currentCommentCount,
    matchedItemId: state.matchedItemId,
    matchedSoundId: state.matchedSoundId,
    matchedEpisodeName: state.matchedEpisodeName,
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
  state.matchedItemId = null;
  state.matchedSoundId = null;
  state.matchedEpisodeName = "";
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
    `低延迟抢评已启动，剧ID：${config.dramaId}，目标前缀：${config.episodePrefix}，${config.testCommentMode ? "测试评论模式" : `目标位次：第${config.targetCommentIndex}条评论`}，轮询间隔：${config.intervalMs}ms`
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
            testCommentMode: config.testCommentMode,
            targetCommentIndex: config.targetCommentIndex,
          });
          stopMonitoring("缺少 sound_id，已自动停止");
          return;
        }
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
      const episodePrefix =
        typeof body.episodePrefix === "string" ? body.episodePrefix.trim() : "";
      const comment =
        typeof body.comment === "string" ? body.comment.trim() : "";
      const testCommentMode = Boolean(body.testCommentMode);
      const targetCommentIndex =
        Number(body.targetCommentIndex) === 2 ? 2 : 1;
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

      if (state.running) {
        stopMonitoring("收到新的开始请求，旧任务已停止");
      }

      resetRuntimeFields();
      state.running = true;
      state.startTime = new Date().toISOString();
      state.dramaId = dramaId;
      state.intervalMs = intervalMs;
      state.episodePrefix = episodePrefix;
      state.comment = comment;
      state.testCommentMode = testCommentMode;
      state.targetCommentIndex = targetCommentIndex;
      state.currentTaskId += 1;

      const currentTaskId = state.currentTaskId;
      monitorLoop(currentTaskId, {
        cookie,
        dramaId,
        episodePrefix,
        comment,
        testCommentMode,
        targetCommentIndex,
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
