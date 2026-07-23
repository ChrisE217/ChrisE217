import { NowRequest, NowResponse } from "@vercel/node";
import {
  exchangeAuthorizationCode,
  getAuthorizeUrl,
  SpotifyAuthError,
} from "../utils/spotifyTokens";

function absoluteUrl(req: NowRequest, path: string) {
  const host = (req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "localhost:3000") as string;
  const proto = (req.headers["x-forwarded-proto"] || "https") as string;
  return `${proto}://${host}${path}`;
}

function html(body: string, status = 200) {
  return {
    status,
    body: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Spotify auth</title>
    <style>
      body { font: 16px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2rem; max-width: 52rem; }
      code, pre { background: #f4f4f5; padding: 0.15rem 0.35rem; border-radius: 4px; }
      pre { padding: 1rem; overflow: auto; white-space: pre-wrap; word-break: break-all; }
      .ok { color: #166534; }
      .err { color: #991b1b; }
    </style>
  </head>
  <body>${body}</body>
</html>`,
  };
}

/**
 * GET /auth        → redirect to Spotify authorize
 * GET /auth?code=  → exchange code for tokens (refresh_token included)
 *
 * Add this Redirect URI in the Spotify Developer Dashboard:
 *   https://dev.chrisewart.com/auth
 */
export default async function (req: NowRequest, res: NowResponse) {
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI || absoluteUrl(req, "/auth");
  const query = req.query || {};
  const code = typeof query.code === "string" ? query.code : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;

  if (error) {
    const page = html(
      `<p class="err">Spotify authorize error: <code>${error}</code></p>
       <p><a href="/auth">Try again</a></p>`,
      400
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(page.status).send(page.body);
  }

  if (!code) {
    res.writeHead(302, { Location: getAuthorizeUrl(redirectUri) });
    return res.end();
  }

  try {
    const tokens = await exchangeAuthorizationCode(code, redirectUri);

    if (!tokens.refresh_token) {
      const page = html(
        `<p class="err">No refresh_token in Spotify response. Re-authorize and ensure the app uses Authorization Code flow.</p>
         <pre>${JSON.stringify(tokens, null, 2)}</pre>`,
        500
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(page.status).send(page.body);
    }

    const page = html(`
      <h1 class="ok">Spotify refresh token issued</h1>
      <p>Refresh tokens expire after <strong>6 months</strong>. Copy into <code>SPOTIFY_REFRESH_TOKEN</code> and redeploy.</p>
      <pre id="token">${tokens.refresh_token}</pre>
      <p>CLI (from <code>src/</code>):</p>
      <pre>printf '%s' "$(pbpaste)" | npx vercel env add SPOTIFY_REFRESH_TOKEN production --force
npx vercel --prod</pre>
      <p>Access token expires in ${
        tokens.expires_in
      }s. That is <em>not</em> the refresh-token lifetime.</p>
      <script>navigator.clipboard && navigator.clipboard.writeText(${JSON.stringify(
        tokens.refresh_token
      )}).catch(() => {})</script>
    `);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(page.status).send(page.body);
  } catch (err) {
    const message =
      err instanceof SpotifyAuthError
        ? `${err.code}: ${err.description || err.message}`
        : err instanceof Error
        ? err.message
        : String(err);
    const page = html(
      `<p class="err">Token exchange failed: <code>${message}</code></p>
       <p><a href="/auth">Try again</a></p>`,
      500
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(page.status).send(page.body);
  }
}
