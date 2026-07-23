import { NowRequest, NowResponse } from "@vercel/node";
import { renderToString } from "react-dom/server";
import { decode } from "querystring";
import { Player } from "../components/NowPlaying";
import fetch from "isomorphic-unfetch";
import { URLSearchParams } from "url";
import { getBearerAccessToken } from "../utils/spotifyTokens";

export default async function (req: NowRequest, res: NowResponse) {
  const {
    item = {} as any,
    is_playing: isPlaying = false,
    progress_ms: progress = 0,
  } = (await nowPlaying()) || {};

  const params = decode((req.url || "").split("?")[1] || "") as any;

  if (params && typeof params.open !== "undefined") {
    if (item && item.external_urls) {
      res.writeHead(302, {
        Location: item.external_urls.spotify,
      });
      return res.end();
    }
    return res.status(200).end();
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate");

  const { duration_ms: duration, name: track } = item;
  const { images = [] } = item.album || {};

  const cover = images[images.length - 1]?.url;
  let coverImg = null;
  if (cover) {
    const buff = await (await fetch(cover)).arrayBuffer();
    coverImg = `data:image/jpeg;base64,${Buffer.from(buff).toString("base64")}`;
  }

  const artist = (item.artists || []).map(({ name }) => name).join(", ");
  const text = renderToString(
    Player({ cover: coverImg, artist, track, isPlaying, progress, duration })
  );
  return res.status(200).send(text);
}

const BASE_URL = `https://api.spotify.com/v1`;

const NOW_PLAYING_ENDPOINT = `/me/player/currently-playing`;
export async function nowPlaying(): Promise<
  Partial<SpotifyApi.CurrentlyPlayingResponse>
> {
  const Authorization = await getBearerAccessToken();
  if (!Authorization) {
    return {};
  }
  const response = await fetch(`${BASE_URL}${NOW_PLAYING_ENDPOINT}`, {
    headers: {
      Authorization,
    },
  });
  const { status } = response;
  if (status === 204) {
    return {};
  } else if (status === 200) {
    const data = await response.json();
    return data;
  }
  return {};
}

const TOP_TRACKS_ENDPOINT = `/me/top/tracks`;
export async function topTrack({
  index,
  timeRange = "short_term",
}: {
  index: number;
  timeRange?: "long_term" | "medium_term" | "short_term";
}): Promise<SpotifyApi.TrackObjectFull> {
  const Authorization = await getBearerAccessToken();
  if (!Authorization) {
    return null;
  }
  const params = new URLSearchParams();
  params.set("limit", "1");
  params.set("offset", `${index}`);
  params.set("time_range", `${timeRange}`);
  const response = await fetch(`${BASE_URL}${TOP_TRACKS_ENDPOINT}?${params}`, {
    headers: {
      Authorization,
    },
  });
  const { status } = response;
  if (status === 204) {
    return null;
  } else if (status === 200) {
    const data = (await response.json()) as SpotifyApi.UsersTopTracksResponse;
    return data.items[0];
  }
  return null;
}
