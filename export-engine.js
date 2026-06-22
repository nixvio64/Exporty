function snowflakeToUnix(snowflake) {
  return Math.floor(Number(BigInt(snowflake) >> 22n) + 1420070400000);
}

function formatTimestamp(iso, dateStyle, timeStyle, locale) {
  try {
    return new Intl.DateTimeFormat(locale || "en-US", {
      dateStyle: dateStyle || "short",
      timeStyle: timeStyle || "short",
    }).format(new Date(iso));
  } catch (e) {
    return new Date(iso).toLocaleString();
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCsv(str) {
  var s = String(str).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? '"' + s + '"' : s;
}

var FORMAT_TXT = 0;
var FORMAT_CSV = 1;
var FORMAT_JSON = 2;
var FORMAT_HTML = 3;

var DISCORD_API = "https://discord.com/api/v9";

export async function fetchChannelInfo(token, channelId) {
  var res = await fetch(DISCORD_API + "/channels/" + channelId, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new Error("Invalid Discord token. Please refresh the page and try again.");
    if (res.status === 404) throw new Error("Channel not found.");
    throw new Error("Failed to fetch channel info (HTTP " + res.status + ")");
  }

  var channel = await res.json();

  if (!channel.name && channel.recipients) {
    channel.name = channel.recipients.map(function (r) { return r.global_name || r.username; }).join(", ");
  }
  if (!channel.name) channel.name = channel.id;

  var guild = null;
  if (channel.guild_id) {
    var gRes = await fetch(DISCORD_API + "/guilds/" + channel.guild_id, {
      headers: { Authorization: token },
    });
    if (gRes.ok) {
      var gData = await gRes.json();
      guild = {
        id: gData.id,
        name: gData.name,
        iconUrl: gData.icon
          ? "https://cdn.discordapp.com/icons/" + gData.id + "/" + gData.icon + "." + (gData.icon.startsWith("a_") ? "gif" : "png") + "?size=512"
          : null,
        roles: new Map(),
      };

      var rRes = await fetch(DISCORD_API + "/guilds/" + channel.guild_id + "/roles", {
        headers: { Authorization: token },
      });
      if (rRes.ok) {
        var roles = await rRes.json();
        roles.forEach(function (r) { guild.roles.set(r.id, r); });
      }
    }
  }

  return { channel: channel, guild: guild };
}

async function fetchAllMessages(token, channelId, after, before, onProgress) {
  var messages = [];
  var lastId = after || "0";
  var prevTimestamp = null;
  var count = 0;

  var firstRes = await fetch(
    DISCORD_API + "/channels/" + channelId + "/messages?limit=1" + (before ? "&before=" + before : ""),
    { headers: { Authorization: token } }
  );
  if (!firstRes.ok) throw new Error("Failed to fetch messages");
  var firstBatch = await firstRes.json();
  if (firstBatch.length > 0) {
    prevTimestamp = snowflakeToUnix(firstBatch[0].id);
  }

  while (true) {
    var url = DISCORD_API + "/channels/" + channelId + "/messages?limit=100";
    if (lastId) url += "&after=" + lastId;

    var res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) {
      if (res.status === 429) {
        var retryAfter = parseFloat(res.headers.get("Retry-After") || "1");
        await new Promise(function (r) { setTimeout(r, retryAfter * 1000); });
        continue;
      }
      throw new Error("Discord API error: " + res.status);
    }

    var batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    batch.reverse();

    for (var i = 0; i < batch.length; i++) {
      var msg = batch[i];

      if (before && BigInt(msg.id) >= BigInt(before)) {
        return { messages: messages, done: true };
      }

      delete msg.application;
      delete msg.application_id;
      delete msg.flags;
      delete msg.webhook_id;
      delete msg.activity;
      delete msg.thread;
      delete msg.nonce;
      delete msg.tts;
      delete msg.mention_everyone;
      delete msg.mention_roles;

      messages.push(msg);
      count++;

      if (onProgress && prevTimestamp) {
        var msgTime = snowflakeToUnix(msg.id);
        if (msgTime !== prevTimestamp) {
          var progress = Math.min(0.99, count / (count + 50));
          onProgress(progress);
        }
      }
    }

    if (onProgress && !prevTimestamp) {
      onProgress(Math.min(0.99, count * 0.002));
    }

    lastId = batch[batch.length - 1].id;
  }

  return { messages: messages, done: false };
}

function formatTxt(messages, channel) {
  var lines = [];
  var channelLabel = channel.guild_id
    ? "#" + (channel.name || channel.id) + " — " + (channel.guildName || "")
    : "@" + (channel.name || channel.id);

  lines.push("Discord Chat Export — " + channelLabel);
  lines.push("Exported at: " + new Date().toLocaleString());
  lines.push("");
  lines.push("—".repeat(60));
  lines.push("");

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var author = (msg.author ? msg.author.global_name || msg.author.username : "Unknown");
    var time = formatTimestamp(msg.timestamp);
    lines.push("[" + time + "] " + author + ":");
    lines.push(msg.content || "(no content)");

    if (msg.attachments && msg.attachments.length > 0) {
      for (var a = 0; a < msg.attachments.length; a++) {
        lines.push("[Attachment: " + msg.attachments[a].url + "]");
      }
    }

    if (msg.embeds && msg.embeds.length > 0) {
      for (var e = 0; e < msg.embeds.length; e++) {
        var embed = msg.embeds[e];
        if (embed.title) lines.push("[Embed: " + embed.title + "]");
        if (embed.description) lines.push("  " + embed.description);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatCsv(messages, channel) {
  var rows = [["Author", "Author ID", "Date", "Time", "Content", "Attachments", "Embeds"]];
  var locale = navigator.language || "en-US";

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var author = msg.author ? msg.author.global_name || msg.author.username : "Unknown";
    var authorId = msg.author ? msg.author.id : "";
    var date = formatTimestamp(msg.timestamp, "short", undefined, locale).split(",")[0] || "";
    var time = formatTimestamp(msg.timestamp, undefined, "medium", locale).split(",")[1] || formatTimestamp(msg.timestamp);
    var content = msg.content || "";
    var attachments = (msg.attachments || []).map(function (a) { return a.url; }).join("; ");
    var embeds = (msg.embeds || []).map(function (e) { return e.title || e.description || ""; }).join("; ");

    rows.push([author, authorId, date, time, content, attachments, embeds]);
  }

  return rows.map(function (r) { return r.map(escapeCsv).join(","); }).join("\n");
}

function formatJson(messages, channel) {
  var exportData = {
    exportedAt: new Date().toISOString(),
    channel: {
      id: channel.id,
      name: channel.name || null,
      type: channel.type,
      guildId: channel.guild_id || null,
    },
    messageCount: messages.length,
    messages: messages,
  };

  return JSON.stringify(exportData, null, 2);
}

function formatHtml(messages, channel) {
  var channelLabel = escapeHtml(channel.name || channel.id);
  var parts = [];

  parts.push("<!DOCTYPE html>");
  parts.push('<html lang="en">');
  parts.push("<head>");
  parts.push('<meta charset="UTF-8">');
  parts.push("<title>Discord Chat Export — " + channelLabel + "</title>");
  parts.push("<style>");
  parts.push(
    ":root{--bg:#fafaf9;--card:#ffffff;--text:#1c1917;--muted:#78716c;--border:#e7e5e4;--accent:#f59e0b;--hover:#fef3c7;--author:#d97706}" +
    ".msg{display:flex;gap:12px;padding:8px 12px;border-bottom:1px solid var(--border);font-family:-apple-system,BlinkMacSystemFont,sans-serif}" +
    ".msg:hover{background:var(--hover)}" +
    ".avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0}" +
    ".body{flex:1;min-width:0}" +
    ".author{font-weight:600;color:var(--author);margin-right:8px}" +
    ".time{font-size:12px;color:var(--muted)}" +
    ".content{margin-top:2px;word-break:break-word}" +
    ".attachment{margin-top:6px;font-size:13px}" +
    ".attachment a{color:var(--accent)}" +
    ".embed{margin-top:6px;padding:8px 12px;border-left:4px solid var(--accent);background:var(--bg);border-radius:4px}" +
    ".embed-title{font-weight:600}" +
    "h1{font-size:18px;padding:16px;margin:0;border-bottom:2px solid var(--accent)}" +
    "body{margin:0;background:var(--bg);color:var(--text)}"
  );
  parts.push("</style>");
  parts.push("</head>");
  parts.push("<body>");
  parts.push("<h1>Discord Chat Export — " + channelLabel + "</h1>");

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var avatarUrl = msg.author
      ? "https://cdn.discordapp.com/avatars/" + msg.author.id + "/" + (msg.author.avatar || "0") + ".png?size=80"
      : "";
    var authorName = escapeHtml(msg.author ? msg.author.global_name || msg.author.username : "Unknown");
    var time = formatTimestamp(msg.timestamp);

    parts.push('<div class="msg">');
    parts.push('<img class="avatar" src="' + avatarUrl + '" alt="" onerror="this.style.display=\'none\'">');
    parts.push('<div class="body">');
    parts.push('<span class="author">' + authorName + '</span>');
    parts.push('<span class="time">' + escapeHtml(time) + '</span>');

    if (msg.content) {
      var content = escapeHtml(msg.content)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/__(.+?)__/g, "<u>$1</u>")
        .replace(/~~(.+?)~~/g, "<s>$1</s>")
        .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
      parts.push('<div class="content">' + content + '</div>');
    }

    if (msg.attachments) {
      for (var a = 0; a < msg.attachments.length; a++) {
        var att = msg.attachments[a];
        var isImg = att.content_type && att.content_type.startsWith("image/");
        if (isImg) {
          parts.push('<div class="attachment"><img src="' + escapeHtml(att.url) + '" alt="' + escapeHtml(att.filename) + '" style="max-width:400px;border-radius:4px"></div>');
        } else {
          parts.push('<div class="attachment"><a href="' + escapeHtml(att.url) + '" target="_blank">' + escapeHtml(att.filename) + '</a> (' + (att.size ? Math.round(att.size/1024) + "KB" : "unknown") + ')</div>');
        }
      }
    }

    if (msg.embeds) {
      for (var e = 0; e < msg.embeds.length; e++) {
        var embed = msg.embeds[e];
        parts.push('<div class="embed">');
        if (embed.title) parts.push('<div class="embed-title">' + escapeHtml(embed.title) + '</div>');
        if (embed.description) parts.push('<div>' + escapeHtml(embed.description) + '</div>');
        if (embed.image) parts.push('<img src="' + escapeHtml(embed.image.url || embed.image.proxy_url) + '" style="max-width:400px;border-radius:4px;margin-top:6px" alt="">');
        parts.push('</div>');
      }
    }

    parts.push('</div>');
    parts.push('</div>');
  }

  parts.push("</body>");
  parts.push("</html>");

  return parts.join("\n");
}

function generateFilename(channel, format) {
  var name = (channel.name || channel.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  var date = new Date().toISOString().slice(0, 10);
  var ext = format === FORMAT_TXT ? "txt" : format === FORMAT_CSV ? "csv" : format === FORMAT_JSON ? "json" : "html";
  return name + "_" + date + "." + ext;
}

export async function exportChat(options) {
  var token = options.token;
  var channelId = options.channelId;
  var after = options.after || "";
  var before = options.before || "";
  var format = options.format !== undefined ? options.format : FORMAT_TXT;
  var onProgress = options.onProgress || function () {};

  onProgress(0);

  var info = await fetchChannelInfo(token, channelId);

  var firstMessage = null;
  try {
    var probeUrl = DISCORD_API + "/channels/" + channelId + "/messages?limit=1" + (before ? "&before=" + before : "");
    var probeRes = await fetch(probeUrl, { headers: { Authorization: token } });
    if (probeRes.ok) {
      var probeData = await probeRes.json();
      if (probeData.length > 0) firstMessage = probeData[0];
    }
  } catch (e) {}

  var result = await fetchAllMessages(token, channelId, after, before, onProgress);
  var messages = result.messages;

  var formatted;
  switch (format) {
    case FORMAT_CSV:
      formatted = formatCsv(messages, info.channel);
      break;
    case FORMAT_JSON:
      formatted = formatJson(messages, info.channel);
      break;
    case FORMAT_HTML:
      formatted = formatHtml(messages, info.channel);
      break;
    default:
      formatted = formatTxt(messages, info.channel);
  }

  var mime = format === FORMAT_TXT
    ? "text/plain"
    : format === FORMAT_CSV
      ? "text/csv"
      : format === FORMAT_JSON
        ? "application/json"
        : "text/html";

  var blob = new Blob([formatted], { type: mime });
  var filename = generateFilename(info.channel, format);

  onProgress(1);

  return { blob: blob, filename: filename, messageCount: messages.length };
}
