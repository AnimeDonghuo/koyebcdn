# Telegram watch player · Koyeb + MongoDB

Player-only iframe based on the supplied mobile/landscape screenshots: title/avatar at top left, settings at top right, large center play/pause and next/skip control, white timeline with elapsed/total times, video list, mute, subtitles, and fullscreen. No ads, surrounding site navigation, or server-selection cards are included. This is an independent implementation, not Dailymotion's proprietary player or CDN.

## Deploy and configure

Deploy the Dockerfile on Koyeb, one instance, HTTP port **8000**, health check **GET /healthz**. Add these environment variables privately in Koyeb:

```dotenv
TELEGRAM_API_ID=your_numeric_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_BOT_TOKEN=your_botfather_token
TELEGRAM_CHANNEL_ID=-1002617067511
MONGODB_URI=mongodb+srv://DB_USER:DB_PASSWORD@YOUR_CLUSTER/?retryWrites=true&w=majority
MONGODB_DATABASE=watch_player
PORT=8000
MAX_STREAMS=2
```

`.env.example` includes all required/optional settings. Add the bot as an administrator to your DB channel. Obtain application credentials from `my.telegram.org`. **API ID + hash alone are not authorization**: the bot token is required, but no personal phone login/OTP/session string is used by the service. Credentials stay on the server; never put them in your site HTML or URLs.

For MongoDB, create a database user scoped to this database, configure network access for the service, and use its connection URI. Do not commit `.env`. Connections are lazy, use at most three pooled connections, and have bounded connection/operation timeouts. `/healthz` is liveness-only: it intentionally does not connect to MongoDB/Telegram until needed.

## The one-link workflow

Use this URL for your example post:

```text
https://YOUR-KOYEB-URL/https://t.me/c/2617067511/22047
```

It displays the player immediately; **nothing is fetched from the catalog or Telegram until the user presses Play**. On Play, the service resolves that post, stores/caches its metadata in MongoDB, and streams its video. You do not need captions, webhooks, episode IDs or prior imports. Existing posts work when Telegram allows your bot to retrieve them.

```html
<iframe
  src="https://YOUR-KOYEB-URL/https://t.me/c/2617067511/22047"
  title="Video player"
  style="display:block;width:100%;aspect-ratio:16/9;border:0"
  allow="fullscreen; picture-in-picture"
  allowfullscreen>
</iframe>
```

For proxies that normalize double slashes in a path, use:

```text
https://YOUR-KOYEB-URL/watch?url=https%3A%2F%2Ft.me%2Fc%2F2617067511%2F22047
```

These return HTML, so use an iframe/embed field, **not** `<video src>`. If your site already has a video player, the raw media URL is `/telegram/media/2617067511/22047`. The metadata API is `GET /api/telegram?url=<encoded-post-link>`.

Only canonical `https://t.me/c/CHANNEL/POST` links belonging to `TELEGRAM_CHANNEL_ID` are accepted. The linked post plays its exact file: choose the low-quality upload to start with low quality. A lone link cannot identify unrelated uploads as alternate resolutions. Public channel usernames, topic/album links, and arbitrary remote URLs are not supported.

## Embed all your site's video placeholders

Add the script once; existing and dynamically inserted placeholders become players:

```html
<script defer src="https://YOUR-KOYEB-URL/embed.js"></script>
<div
  data-telegram-url="https://t.me/c/2617067511/22047"
  data-title="Episode 160 · English + Indonesian"
  data-label="YOUR CHANNEL"
  data-avatar="https://your-site.example/avatar.jpg"
  data-poster="https://your-site.example/poster.jpg">
</div>
```

`title`, `label`, `avatar`, `poster`, `next` can also be query parameters on the player URL. Avatar/poster URLs must be HTTPS. These optional images are fetched by the browser before Play; no video bytes, Telegram thumbnail requests, MongoDB reads or Telegram metadata lookups occur while the embed is idle. Without provided metadata, the initial title is “Telegram video”, with a generic avatar; the actual title replaces it on Play.

`next` / `data-next` is an optional next Telegram post URL. It enables Next and adds the next item to the video list. Without it, the next-shaped center button skips forward **10 seconds** and is labelled accordingly. The video-list button shows the current video and the optional next item; it is not a channel-history scan or recommendation service.

**Autoplay is disabled**, including legacy `autoplay=1` parameters. The middle Play button starts loading. If a browser rejects sound playback after asynchronous loading, it prompts for another tap instead of silently failing. Quality, speed, volume, subtitles, seeking and PiP are available; PiP requires browser support and active playback.

## Landscape fullscreen

Fullscreen requests landscape orientation lock when supported. When orientation lock is denied and the fullscreen viewport is portrait, a CSS fallback rotates the **entire player, including its controls**. Leaving fullscreen clears the rotation. The settings menu also includes Landscape fullscreen. Some browsers (notably iOS native fullscreen) use their own controls and cannot be forced into a custom orientation; rotate the device in that case. Your iframe must grant fullscreen permission.

## MongoDB storage versus active streams

- There is **no application-imposed limit on the number of saved videos/post records**. MongoDB `videos` stores manifests and `telegram_posts` stores resolved post metadata, keyed by unique IDs. Records are upserted, not duplicated for every viewer. MongoDB storage quotas, document limits and billing still apply.
- **Video files remain in Telegram/direct storage**, not MongoDB and not the Koyeb filesystem. MongoDB stores metadata/references only. Do not put multi-gigabyte video blobs into catalog documents.
- There is no background channel scanning, video prefetching, thumbnail extraction, or transcoding. Telegram bot authorization and MongoDB connections are lazy. RAM metadata cache is limited to 128 entries; MongoDB records have no TTL deletion. Metadata is refreshed after 60 seconds when requested.
- **Concurrent active transfers remain limited** by `MAX_STREAMS` (default 2, supported 1–8). Saved links do not consume transfer slots. A free Koyeb instance cannot safely support unlimited simultaneous video transfers. Excess transfers get `503` with `Retry-After`; the player offers retry. MongoDB cannot remove CPU/network/bandwidth limits. Use direct storage URLs or a larger/edge streaming service for a high audience.
- Streaming uses 512 KB Telegram chunks and HTTP backpressure, with no full-file buffering. Range requests, seeking, HEAD, 206 and 416 are supported. Disconnects stop iteration. MTProto requests have a 15-minute HTTP transfer deadline; a long transfer may need retrying. Hosted Bot API fallback has a 2-minute deadline.
- The MTProto transport avoids hosted Bot API `getFile`'s 20 MB download ceiling. Bots must still have access to the file. Telegram rate limits, deleted posts, permissions, file-CDN redirect limitations in the streaming library, and browser codec support can prevent playback. No actual 2 GB Telegram transfer or Koyeb capacity test has been performed.

This replaces the prior SQLite catalog. There is no automatic SQLite migration: re-import old manifests or use direct Telegram post links. MongoDB catalog records survive Koyeb redeployment when the external database remains available. Telegram access credentials are not persisted in MongoDB.

## Optional multi-quality catalog and subtitles

Use a catalog manifest for multiple resolutions/external subtitle tracks. The lowest available resolution is selected first and switching preserves position. `POST /api/videos` requires the server-side `ADMIN_TOKEN`:

```json
{
  "id": "episode-01",
  "title": "Episode 01",
  "sources": [
    {"height": 480, "url": "https://storage.example/episode-01-480.mp4"},
    {"height": 2160, "url": "https://storage.example/episode-01-4k.mp4"}
  ],
  "subtitles": [
    {"label": "English", "language": "en", "url": "https://storage.example/episode-01-en.vtt"}
  ]
}
```

Watch at `/watch/episode-01`, fetch JSON at `/api/videos/episode-01`, or use `<div data-watch-id="episode-01"></div>` with `embed.js`. API paths are relative to the Koyeb origin. Full-manifest imports replace the existing video. Use HTTPS URLs, unique numeric heights and IDs consisting of letters/digits/hyphens/underscores (max 100). Provider-signed URLs are not automatically renewed.

**Embedded softsubs in MKV/MP4 are not automatically extracted.** Convert/extract ASS/SRT to external WebVTT outside Koyeb. The browser generally cannot enumerate these embedded tracks. The player lists provided external tracks; no tracks means “Not available”. Enable CORS on video and subtitle storage for the player origin; serve WebVTT as `text/vtt`. Recommend fast-start H.264/AAC MP4 with HTTP byte-range support. No HLS/DASH transcoding, quality generation, DRM, or Sora Box/TeraBox resolver is included.

### Optional Telegram webhook catalog importer

For this mode only, set `TELEGRAM_WEBHOOK_SECRET` to a long random secret and register:

```sh
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode 'url=https://YOUR-KOYEB-URL/telegram/webhook' \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["channel_post","edited_channel_post"]'
```

New video posts with captions `watch:episode-01 quality:480 Episode 01` and `watch:episode-01 quality:1080 Episode 01` are grouped under the same catalog ID. Posts without this format get their own `tg-<channel-id-without-minus>-<message-id>` ID. Video documents require a `video/*` MIME type. Height comes from caption, filename (`480p`), Telegram metadata, then 480 fallback. Concurrent resolutions merge atomically in MongoDB. Edits upsert; Telegram deletion does not delete the catalog. Old history is not scanned.

A JSON manifest can also be posted as a plain channel text post. Invalid manifests/other channels are ignored. Database failures return an error so Telegram can retry. To attach external subtitle tracks to a Telegram catalog entry, import a manifest with that ID/tracks then repost/edit the Telegram resolutions: subtitle metadata is retained.

## Security and tests

The configured channel's linked videos become **public through this API**. IDs are not access control. CORS is not hotlink protection. Only publish media you have permission to distribute. Configure edge rate limiting for a public deployment. `ALLOWED_ORIGINS` optionally allows cross-origin JSON reads for exact site origins; iframe embedding itself does not require it. Viewer authentication/DRM is not implemented.

```sh
npm ci
cp .env.example .env
# Set credentials privately in .env
node --env-file=.env server.js
npm test
```

Tests cover validation, authentication, private-reference redaction, channel restrictions, byte ranges including >2 GB offsets, chunk slicing, cancellation, mocked Telegram GET/HEAD/416 responses, direct-link routes and concurrency limits. Unit tests inject an in-memory store; real MongoDB/Telegram integration requires your configured services. Browser checks use mocked media/API responses, not a real Telegram episode. Koyeb free-plan availability, database quotas, network limits and sleep behaviour depend on your providers.

### Browser regression checks

```sh
npx playwright install chromium
npm run test:browser
# Alternatively, use an existing Chromium binary:
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run test:browser
```

The browser suite checks **zero video/API requests before Play**, lowest-quality selection, play/pause, quality switching, mute, speed, seeking, menus and a simulated denied-orientation-lock fallback. Actual mobile OS fullscreen behavior and real streaming still need device/service testing. Screenshots can optionally be written to an existing directory using `SCREENSHOT_DIR`; do not commit test artifacts.

A real MongoDB integration test is opt-in: set `TEST_MONGODB_URI` before `npm test`. It uses and drops a new randomly named `watch_test_...` database (never the configured production database). Without that variable, the integration test is skipped and MongoDB adapter tests use a mock client. Font files in `public/fonts` are self-hosted Roboto, with their included license.
