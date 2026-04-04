import type {
  LegacyTweetRaw,
  TimelineMediaExtendedRaw,
} from "./api-types";
import { TweetPhoto, TweetVideo } from "./tweet-detail-model";

// ---------------------------------------------------------------------------
// Shared numeric parsing
// ---------------------------------------------------------------------------

export const parseHeaderNumber = (value: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ---------------------------------------------------------------------------
// Shared timeline helpers
// ---------------------------------------------------------------------------

export const getInstructionEntries = <TEntry>(instruction: {
  readonly entries?: ReadonlyArray<TEntry>;
  readonly entry?: TEntry;
}) => [
  ...(instruction.entries ?? []),
  ...(instruction.entry ? [instruction.entry] : []),
];

// ---------------------------------------------------------------------------
// Regex constants used by reconstructTweetHtml
// ---------------------------------------------------------------------------

const HASH_TAG_RE = /\B(\#\S+\b)/g;
const CASH_TAG_RE = /\B(\$\S+\b)/g;
const TWITTER_URL_RE = /https:(\/\/t\.co\/([A-Za-z0-9]|[A-Za-z]){10})/g;
const USERNAME_RE = /\B(\@\S{1,15}\b)/g;
const HTML_ESCAPE_RE = /[&<>"']/g;

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "\"": "&quot;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};

// ---------------------------------------------------------------------------
// HTML link helpers
// ---------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(HTML_ESCAPE_RE, (char) => HTML_ESCAPE_MAP[char] ?? char);

const safeHtmlUrl = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return escapeHtml(url.toString());
  } catch {
    return undefined;
  }
};

const linkHashtagHtml = (value: string) =>
  `<a href="https://x.com/hashtag/${encodeURIComponent(value.replace("#", ""))}">${value}</a>`;

const linkCashtagHtml = (value: string) =>
  `<a href="https://x.com/search?q=${encodeURIComponent(value)}">${value}</a>`;

const linkUsernameHtml = (value: string) =>
  `<a href="https://x.com/${encodeURIComponent(value.replace("@", ""))}">${value}</a>`;

// ---------------------------------------------------------------------------
// parseTimestamp
// ---------------------------------------------------------------------------

export const parseTimestamp = (createdAt: string | undefined) => {
  if (!createdAt) {
    return {
      timeParsed: undefined,
      timestamp: undefined,
    };
  }

  const timeParsed = new Date(Date.parse(createdAt));
  if (Number.isNaN(timeParsed.valueOf())) {
    return {
      timeParsed: undefined,
      timestamp: undefined,
    };
  }

  return {
    timeParsed,
    timestamp: Math.floor(timeParsed.valueOf() / 1000),
  };
};

// ---------------------------------------------------------------------------
// parseMediaGroups
// ---------------------------------------------------------------------------

export const parseMediaGroups = (media: ReadonlyArray<TimelineMediaExtendedRaw>) => {
  let sensitiveContent = false;
  const photos: Array<TweetPhoto> = [];
  const videos: Array<TweetVideo> = [];

  for (const item of media) {
    if (!item.id_str || !item.media_url_https) {
      continue;
    }

    if (item.type === "photo") {
      photos.push(
        new TweetPhoto({
          ...(item.ext_alt_text ? { altText: item.ext_alt_text } : {}),
          id: item.id_str,
          url: item.media_url_https,
        }),
      );
    } else if (item.type === "animated_gif" || item.type === "video") {
      let preview = item.media_url_https;
      let selectedUrl: string | undefined;
      let maxBitrate = 0;

      for (const variant of item.video_info?.variants ?? []) {
        if (
          variant.content_type === "video/mp4" &&
          variant.url &&
          (variant.bitrate ?? 0) >= maxBitrate
        ) {
          selectedUrl = variant.url;
          maxBitrate = variant.bitrate ?? 0;
        }
      }

      if (item.type === "animated_gif" && selectedUrl) {
        preview = selectedUrl;
      }

      videos.push(
        new TweetVideo({
          id: item.id_str,
          preview,
          ...(selectedUrl ? { url: selectedUrl } : {}),
        }),
      );
    }

    const warning = item.ext_sensitive_media_warning;
    if (
      warning?.adult_content ||
      warning?.graphic_violence ||
      warning?.other
    ) {
      sensitiveContent = true;
    }
  }

  return {
    photos,
    sensitiveContent,
    videos,
  };
};

// ---------------------------------------------------------------------------
// reconstructTweetHtml
// ---------------------------------------------------------------------------

export const reconstructTweetHtml = (
  legacy: LegacyTweetRaw,
  text: string | undefined,
  photos: ReadonlyArray<TweetPhoto>,
  videos: ReadonlyArray<TweetVideo>,
) => {
  const includedMedia = new Set<string>();
  let html = escapeHtml(text ?? "");

  html = html.replace(HASH_TAG_RE, linkHashtagHtml);
  html = html.replace(CASH_TAG_RE, linkCashtagHtml);
  html = html.replace(USERNAME_RE, linkUsernameHtml);
  html = html.replace(TWITTER_URL_RE, (tco) => {
    for (const url of legacy.entities?.urls ?? []) {
      if (url.url === tco && url.expanded_url) {
        const safeExpandedUrl = safeHtmlUrl(url.expanded_url);
        if (safeExpandedUrl) {
          return `<a href="${safeExpandedUrl}">${tco}</a>`;
        }
      }
    }

    for (const media of legacy.extended_entities?.media ?? []) {
      if (media.url === tco && media.media_url_https) {
        const safeMediaUrl = safeHtmlUrl(media.media_url_https);
        const safeTcoUrl = safeHtmlUrl(tco);

        if (safeMediaUrl && safeTcoUrl) {
          includedMedia.add(media.media_url_https);
          return `<br><a href="${safeTcoUrl}"><img src="${safeMediaUrl}"/></a>`;
        }
      }
    }

    return tco;
  });

  for (const photo of photos) {
    const safePhotoUrl = safeHtmlUrl(photo.url);
    if (safePhotoUrl && !includedMedia.has(photo.url)) {
      html += `<br><img src="${safePhotoUrl}"/>`;
    }
  }

  for (const video of videos) {
    const safePreviewUrl = safeHtmlUrl(video.preview);
    if (safePreviewUrl && !includedMedia.has(video.preview)) {
      html += `<br><img src="${safePreviewUrl}"/>`;
    }
  }

  return html.replace(/\n/g, "<br>");
};
