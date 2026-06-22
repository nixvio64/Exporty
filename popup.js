import { exportChat, fetchChannelInfo } from "./export-engine.js";

var state = {
  token: null,
  channelId: null,
  channelInfo: null,
  exporting: false,
};

var $ = function (sel) { return document.querySelector(sel); };

var channelCard = $("#channelCard");
var channelIcon = $("#channelIcon");
var serverName = $("#serverName");
var channelNameEl = $("#channelName");
var errorCard = $("#errorCard");
var errorText = $("#errorText");
var controls = $("#controls");
var formatSelect = $("#formatSelect");
var dateStart = $("#dateStart");
var dateEnd = $("#dateEnd");
var exportBtn = $("#exportBtn");
var progressWrap = $("#progressWrap");
var progressBar = $("#progressBar");
var progressText = $("#progressText");
var themeToggle = $("#themeToggle");
var themeLabel = $("#themeLabel");

var THEME_AUTO = "auto";
var THEME_LIGHT = "light";
var THEME_DARK = "dark";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? THEME_DARK : THEME_LIGHT;
}

function getEffectiveTheme(storedTheme) {
  if (!storedTheme || storedTheme === THEME_AUTO) {
    return getSystemTheme();
  }
  return storedTheme;
}

function applyTheme(effective) {
  document.documentElement.setAttribute("data-theme", effective);
}

function updateThemeLabel(stored) {
  themeLabel.textContent = getStoredThemeLabel(stored);
}

function getNextStoredTheme(current) {
  if (!current || current === THEME_AUTO) return THEME_LIGHT;
  if (current === THEME_LIGHT) return THEME_DARK;
  return THEME_AUTO;
}

function getStoredThemeLabel(stored) {
  if (!stored || stored === THEME_AUTO) return "AUTO";
  return stored === THEME_DARK ? "DARK" : "LIGHT";
}

async function cycleTheme() {
  var stored = await chrome.storage.local.get("exportyTheme");
  var current = stored.exportyTheme || THEME_AUTO;
  var next = getNextStoredTheme(current);

  await chrome.storage.local.set({ exportyTheme: next });
  applyTheme(getEffectiveTheme(next));
  updateThemeLabel(next);
}

async function loadTheme() {
  var stored = await chrome.storage.local.get("exportyTheme");
  var theme = stored.exportyTheme || THEME_AUTO;
  applyTheme(getEffectiveTheme(theme));
  updateThemeLabel(theme);
}

themeToggle.addEventListener("click", cycleTheme);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async function () {
  var stored = await chrome.storage.local.get("exportyTheme");
  if (!stored.exportyTheme || stored.exportyTheme === THEME_AUTO) {
    applyTheme(getSystemTheme());
    updateThemeLabel(THEME_AUTO);
  }
});

function showError(msg) {
  errorText.textContent = msg;
  errorCard.classList.remove("hidden");
}

function hideError() {
  errorCard.classList.add("hidden");
}

async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function discordChannelFromUrl(url) {
  if (!url) return null;
  var m = url.match(/discord\.com\/channels\/(@me|\d+)\/(\d+)/);
  if (!m) return null;
  return { serverId: m[1], channelId: m[2], isDM: m[1] === "@me" };
}

function parseTitleFallback(title, isDM) {
  var clean = title.replace(/^\(\d+\)\s*/, "").trim();

  if (isDM) {
    var name = clean
      .replace(/\s*\|\s*Discord\s*$/, "")
      .replace(/\s*[-–—]\s*Discord\s*$/, "")
      .replace(/^@/, "")
      .trim();
    if (name && name !== "Discord") {
      return { serverName: "Direct Messages", channelName: name };
    }
  }

  var parts = clean.split(/\s*\|\s*/);
  if (parts.length >= 2) {
    var ch = parts[0].replace(/^#/, "").trim();
    var srv = parts[1].replace(/Discord/i, "").trim();
    if (ch && srv && ch !== "Discord") {
      return { serverName: srv, channelName: ch };
    }
  }

  return { serverName: isDM ? "Direct Messages" : "Server", channelName: clean };
}

async function init() {
  hideError();

  var tab = await getActiveTab();
  if (!tab || !tab.url) {
    showError("Could not access the active tab.");
    return;
  }

  var parsed = discordChannelFromUrl(tab.url);
  if (!parsed) {
    showError("Open a Discord channel or DM to use Exporty.");
    return;
  }

  state.channelId = parsed.channelId;

  try {
    var execOpts = { target: { tabId: tab.id }, files: ["inject.js"] };
    if (chrome.scripting.executionWorld) {
      execOpts.world = "MAIN";
    }

    var results = await chrome.scripting.executeScript(execOpts);

    if (!results || !results.length || !results[0].result) {
      showError("Could not read Discord data. Refresh the Discord page and try again.");
      return;
    }

    var data = results[0].result;
    state.token = data.token;

    if (!state.token) {
      showError("Could not find your Discord token. Refresh the Discord page and try again.");
      return;
    }

    var domInfo = data.info || {};
    var fallback = parseTitleFallback(domInfo._title || "", parsed.isDM);

    renderChannelFromFallback(fallback, domInfo);

    try {
      var info = await fetchChannelInfo(state.token, state.channelId);
      state.channelInfo = info;
      renderChannel(info, fallback, domInfo);
    } catch (apiErr) {
      console.error("Exporty API channel fetch failed, using fallback:", apiErr);
    }

    controls.classList.remove("hidden");
  } catch (e) {
    showError("Could not connect to Discord. Refresh the page and try again.");
    console.error("Exporty init error:", e);
  }
}

function renderChannelFromFallback(fb, domInfo) {
  serverName.textContent = fb.serverName;
  channelNameEl.textContent = fb.isDM ? "@" + fb.channelName : "#" + fb.channelName;
  if (domInfo && domInfo.iconUrl) {
    channelIcon.src = domInfo.iconUrl;
    channelIcon.style.display = "";
  } else {
    channelIcon.style.display = "none";
  }
  channelCard.classList.remove("hidden");
}

function renderChannel(info, fallback, domInfo) {
  var name, chName, iconUrl;

  if (info.channel && info.channel.name) {
    chName = info.channel.name;
  } else if (fallback) {
    chName = fallback.channelName;
  }

  if (info.guild && info.guild.name) {
    name = info.guild.name;
    iconUrl = info.guild.iconUrl;
  } else if (fallback) {
    name = fallback.serverName;
  }

  if (!name) name = "Direct Messages";

  serverName.textContent = name;
  channelNameEl.textContent = info.guild ? "#" + chName : "@" + chName;

  if (iconUrl) {
    channelIcon.src = iconUrl;
    channelIcon.style.display = "";
  } else if (info.channel && info.channel.recipients && info.channel.recipients.length > 0) {
    var rcpt = info.channel.recipients[0];
    if (rcpt.avatar) {
      channelIcon.src = "https://cdn.discordapp.com/avatars/" + rcpt.id + "/" + rcpt.avatar + ".png?size=128";
      channelIcon.style.display = "";
    } else {
      var idx = (parseInt(rcpt.discriminator || "0") || 0) % 5;
      channelIcon.src = "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
      channelIcon.style.display = "";
    }
  } else if (domInfo && domInfo.iconUrl) {
    channelIcon.src = domInfo.iconUrl;
    channelIcon.style.display = "";
  } else {
    channelIcon.style.display = "none";
  }

  channelCard.classList.remove("hidden");
}

function snowflakeFromDate(dateStr) {
  var ms = new Date(dateStr).getTime();
  if (isNaN(ms)) return "";
  return ((BigInt(ms) - 1420070400000n) << 22n).toString();
}

function validateDates() {
  if (!dateStart.value || !dateEnd.value) return true;
  return new Date(dateEnd.value).getTime() > new Date(dateStart.value).getTime();
}

async function handleExport() {
  if (state.exporting) return;
  if (!state.token || !state.channelId) return;

  if (!validateDates()) {
    showError("End time must be after start time.");
    return;
  }

  state.exporting = true;
  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting...";
  hideError();
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";

  try {
    var result = await exportChat({
      token: state.token,
      channelId: state.channelId,
      after: snowflakeFromDate(dateStart.value),
      before: snowflakeFromDate(dateEnd.value),
      format: parseInt(formatSelect.value),
      onProgress: function (p) {
        var pct = Math.round(p * 100);
        progressBar.style.width = pct + "%";
        progressText.textContent = pct + "%";
      },
    });

    var url = URL.createObjectURL(result.blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    progressBar.style.width = "100%";
    progressText.textContent = "Done!";
  } catch (e) {
    showError(e.message || "Export failed. Try again.");
    progressWrap.classList.add("hidden");
  } finally {
    state.exporting = false;
    exportBtn.disabled = false;
    exportBtn.textContent = "Export";
  }
}

exportBtn.addEventListener("click", handleExport);
formatSelect.addEventListener("change", function () {
  progressWrap.classList.add("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
});

loadTheme().then(init);
