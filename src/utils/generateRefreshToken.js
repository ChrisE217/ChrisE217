/* eslint-disable @typescript-eslint/no-var-requires */
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const http = require("http");
const open = require("open");
const { URL, URLSearchParams } = require("url");

const SERVER_PORT = 3000;
const REDIRECT_URI = `http://localhost:${SERVER_PORT}/callback`;
const SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-top-read",
];

const force = process.argv.includes("--force");

for (const envPath of [".env.local", ".env"]) {
  if (fs.existsSync(envPath)) {
    console.log(`Using ${envPath} for environment variables`);
    dotenv.config({ path: envPath });
  }
}

if (process.env.SPOTIFY_REFRESH_TOKEN && !force) {
  console.log(
    "SPOTIFY_REFRESH_TOKEN already set. Pass --force to re-authorize."
  );
  process.exit(0);
}

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET (.env / .env.local)."
  );
  process.exit(1);
}

async function exchangeAuthorizationCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `${data.error || response.status}: ${data.error_description || ""}`
    );
  }
  return data;
}

function upsertEnvVar(filePath, key, value) {
  const line = `${key}=${value}`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${line}\n`);
    return;
  }

  const current = fs.readFileSync(filePath, "utf8");
  const next = current.match(new RegExp(`^${key}=.*$`, "m"))
    ? current.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${current.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(filePath, next);
}

function writeRefreshToken(refreshToken) {
  const targets = [".env", ".env.local"].filter((p) => fs.existsSync(p));
  if (targets.length === 0) targets.push(".env");

  for (const filePath of targets) {
    upsertEnvVar(filePath, "SPOTIFY_REFRESH_TOKEN", refreshToken);
    console.log(`Wrote SPOTIFY_REFRESH_TOKEN to ${path.resolve(filePath)}`);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${SERVER_PORT}`);
    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      res.statusCode = 400;
      res.end(`Spotify error: ${error}`);
      server.close();
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      res.statusCode = 400;
      res.end("Missing code");
      return;
    }

    const tokens = await exchangeAuthorizationCode(code);
    if (!tokens.refresh_token) {
      res.statusCode = 500;
      res.end(
        "No refresh_token in response:\n" + JSON.stringify(tokens, null, 2)
      );
      server.close();
      return;
    }

    writeRefreshToken(tokens.refresh_token);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      [
        "OK — refresh token saved locally.",
        "",
        "Push it to Vercel + redeploy:",
        `printf '%s' '${tokens.refresh_token}' | npx vercel env add SPOTIFY_REFRESH_TOKEN production --force`,
        "npx vercel --prod",
        "",
        JSON.stringify(
          {
            expires_in: tokens.expires_in,
            scope: tokens.scope,
            refresh_token: tokens.refresh_token,
          },
          null,
          2
        ),
      ].join("\n")
    );
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(String(err && err.message ? err.message : err));
  } finally {
    server.close();
  }
});

server.listen(SERVER_PORT, () => {
  const authorizeUrl =
    "https://accounts.spotify.com/authorize?" +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(" "),
    }).toString();

  console.log(`Listening on ${REDIRECT_URI}`);
  console.log("Opening Spotify authorize URL…");
  open(authorizeUrl);
});
