import fetch from "isomorphic-unfetch";
import { URLSearchParams } from "url";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";

export const SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-top-read",
];

export type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
};

export class SpotifyAuthError extends Error {
  status: number;
  code: string;
  description?: string;

  constructor(
    status: number,
    code: string,
    description?: string,
    message?: string
  ) {
    super(message || description || code);
    this.name = "SpotifyAuthError";
    this.status = status;
    this.code = code;
    this.description = description;
  }

  get isInvalidGrant() {
    return this.code === "invalid_grant";
  }
}

function getClientCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
  }

  return { clientId, clientSecret };
}

function basicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  )}`;
}

async function postToken(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  const result = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: body.toString(),
  });

  const response = await result.json();

  if (!result.ok) {
    throw new SpotifyAuthError(
      result.status,
      response.error || "token_error",
      response.error_description
    );
  }

  return response as SpotifyTokenResponse;
}

/**
 * Exchange a stored refresh token for a new access token.
 * Mirrors Spotify's Authorization Code "refreshing tokens" tutorial:
 * https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
 *
 * If Spotify returns a new refresh_token, callers should persist it and use
 * that going forward. When no refresh_token is returned, keep the existing one.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<SpotifyTokenResponse> {
  if (!refreshToken) {
    throw new SpotifyAuthError(
      400,
      "invalid_grant",
      "No refresh token available"
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return postToken(body);
}

/** Exchange an auth-code (from /authorize redirect) for access + refresh tokens. */
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string
): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  return postToken(body);
}

export function getAuthorizeUrl(redirectUri: string, state?: string) {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
  });

  if (state) {
    params.set("state", state);
  }

  return `${AUTHORIZE_URL}?${params}`;
}

/** Convenience: refresh using SPOTIFY_REFRESH_TOKEN from the environment. */
export async function getBearerAccessToken(): Promise<string | null> {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  try {
    const tokens = await refreshAccessToken(refreshToken || "");

    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      // Spotify may rotate the refresh token. Env vars are deploy-time only,
      // so log loudly — update SPOTIFY_REFRESH_TOKEN and redeploy.
      console.warn(
        "Spotify returned a new refresh_token. Update SPOTIFY_REFRESH_TOKEN in Vercel and redeploy.",
        { preview: `${tokens.refresh_token.slice(0, 8)}…` }
      );
    }

    return `Bearer ${tokens.access_token}`;
  } catch (err) {
    if (err instanceof SpotifyAuthError) {
      console.error("Spotify token refresh failed", {
        status: err.status,
        error: err.code,
        error_description: err.description,
      });
      return null;
    }
    throw err;
  }
}
