function looksLikeToken(str) {
  return (
    typeof str === "string" &&
    str.length > 40 &&
    /^[A-Za-z0-9._-]+$/.test(str) &&
    !str.includes(" ") &&
    !str.includes("{") &&
    !str.includes("(")
  );
}

function getToken() {
  var token = null;

  try {
    if (window.webpackChunkdiscord_app) {
      window.webpackChunkdiscord_app.push([
        [Math.random()],
        {},
        function (req) {
          for (var key in req.c) {
            var mod = req.c[key].exports;
            if (!mod) continue;
            var target = mod.default || mod;
            var hasAuthFlag =
              typeof target.isAuthenticated === "boolean" ||
              (typeof target.isAuthenticated === "function" &&
                typeof target._dispatchToken === "string");
            if (typeof target.getToken === "function" && hasAuthFlag) {
              try {
                var candidate = target.getToken();
                if (looksLikeToken(candidate)) {
                  token = candidate;
                }
              } catch (e) {}
            }
            if (token) break;
          }
        },
      ]);
    }
  } catch (e) {}

  if (token) return token;

  try {
    if (window.localStorage && window.localStorage.token) {
      var lsToken = window.localStorage.token.replace(/"/g, "");
      if (looksLikeToken(lsToken)) return lsToken;
    }
  } catch (e) {}

  try {
    var domToken = document.body.getAttribute("data-token");
    if (domToken && looksLikeToken(domToken)) return domToken;
  } catch (e) {}

  return null;
}

function getPageInfo() {
  var url = document.URL;
  var title = document.title;
  var body = document.body.innerHTML;

  var isThread = url.includes("threads");
  var regex = isThread
    ? /^https:\/\/discord\.com\/channels\/([0-9]+)\/[0-9]+\/threads\/([0-9]+).*/
    : /^https:\/\/discord\.com\/channels\/(@me|[0-9]+)\/([0-9]+).*/;

  var matches = url.match(regex);
  if (!matches) return { serverName: "", channelName: "", iconUrl: "", isDM: false };

  var serverId = matches[1];
  var channelId = matches[2];
  var isDM = serverId === "@me";

  var serverName = "";
  var channelName = "";
  var iconUrl = "";

  if (isDM) {
    var titleParts = title.split(" | ");
    if (titleParts.length >= 2) {
      channelName = titleParts[0].replace(/^@/, "").trim();
      serverName = "Direct Messages";
    } else {
      var atParts = title.split(" - ");
      if (atParts.length >= 2) {
        channelName = atParts[0].replace(/^@/, "").trim();
        serverName = "Direct Messages";
      } else {
        channelName = title.replace(" | Discord", "").replace(" - Discord", "").trim();
        serverName = "Direct Messages";
      }
    }

    var avatarRegex = /https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/[a-f0-9_]+\.(?:png|webp|gif|jpg)\?size=\d+/gi;
    var avatarMatches = body.match(avatarRegex);
    if (avatarMatches && avatarMatches.length > 0) {
      iconUrl = avatarMatches[0];
    }

  } else {
    var titleSegments = title.split(" | ");
    if (titleSegments.length >= 2) {
      channelName = titleSegments[0].replace(/^#/, "").trim();
      serverName = titleSegments[1].replace("Discord", "").trim();
    }

    var iconPatterns = [
      new RegExp('<img[^>]*src=["\'](https://cdn\\.discordapp\\.com/icons/' + serverId + '/[^"\']+)["\']', "i"),
      new RegExp('<image[^>]*href=["\'](https://cdn\\.discordapp\\.com/icons/' + serverId + '/[^"\']+)["\']', "i"),
      new RegExp('https://cdn\\.discordapp\\.com/icons/' + serverId + '/[^"\'\\s]+', "i"),
      new RegExp('url\\(["\']?(https://cdn\\.discordapp\\.com/icons/' + serverId + '/[^"\')]+)["\']?\\)', "i"),
    ];

    for (var i = 0; i < iconPatterns.length; i++) {
      var match = body.match(iconPatterns[i]);
      if (match) {
        iconUrl = match[1] || match[0];
        break;
      }
    }
  }

  return {
    serverName: serverName,
    channelName: channelName,
    iconUrl: iconUrl,
    isDM: isDM,
    _title: document.title,
  };
}

var result = {
  token: getToken(),
  info: getPageInfo(),
};

result;
