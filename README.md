# Telegram watch player · Koyeb + MongoDB

Player-only iframe based on the supplied mobile/landscape screenshots: title/avatar at top left, settings at top right, large center play/pause and next/skip control, white timeline with elapsed/total times, video list, mute, subtitles, audio-language selection where supported, and fullscreen. No ads, surrounding site navigation, or server-selection cards are included. This is an independent implementation, not Dailymotion's proprietary player or CDN.

> **Site-URL checks are now the default.** Existing plain iframes on `https://youngest-corabella-platinum0-23c07cdf.koyeb.app` work without playback keys, cookies, or a website token endpoint. This is basic hotlink deterrence, NOT authentication; technical users can bypass it. See [SECURITY_SETUP.md](SECURITY_SETUP.md).

## Deploy and configure

Deploy the Dockerfile on Koyeb, one instance, HTTP port **8000**, health check **GET /healthz**. Add these environment variables privately in Koyeb:

```dotenv
TELEGRAM_API_ID=your_numeric_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_BOT_TOKEN=your_botfather_token
TELEGRAM_CHANNEL_IDS=-1002617067511
MONGODB_URI=mongodb+srv://DB_USER:DB_PASSWORD@YOUR_CLUSTER/?retryWrites=true&w=majority
MONGODB_DATABASE=watch_player
PORT=8000
MAX_STREAMS=2
ALLOWED_SITE_ORIGIN=https://youngest-corabella-platinum0-23c07cdf.koyeb.app
PLAYBACK_AUTH_MODE=site
PLAYBACK_SESSION_TTL_SECONDS=600
```

`.env.example` includes all required/optional settings. Add the bot as an administrator to your DB channel. Obtain application credentials from `my.telegram.org`. **API ID + hash alone are not authorization**: the bot token is required, but no personal phone login/OTP/session string is used by the service. Credentials stay on the server; never put them in your site HTML or URLs.

For MongoDB, create a database user scoped to this database, configure network access for the service, and use its connection URI. Do not commit `.env`. Connections are lazy, use at most three pooled connections, and have bounded connection/operation timeouts. `/healthz` is liveness-only: it intentionally does not connect to MongoDB/Telegram until needed.

## Multiple Telegram DB channels

Set a comma-separated list in **the player service's Koyeb environment**:

```dotenv
TELEGRAM_CHANNEL_IDS=-1002617067511,-1001234567890,-1009876543210
```

Replace the example IDs with your real channel IDs and add the **same configured bot** as an administrator to every channel. For `https://t.me/c/2617067511/22047`, the full ID is `-1002617067511`. Update the list and restart/redeploy to add or remove channels. Whitespace/duplicates are accepted; URLs, wildcards and malformed IDs are rejected. There is no application-imposed channel-count limit, but Koyeb environment-size and Telegram membership/storage limits still apply.

A non-empty `TELEGRAM_CHANNEL_IDS` **replaces** the legacy `TELEGRAM_CHANNEL_ID`; the old variable is used only if the list is absent/blank. Clear both variables if no channels should be allowed. Direct post links, grants, webhook imports, metadata and media routes enforce the same list. Removing a channel also blocks new requests for its old MongoDB catalog sources; existing in-flight responses may finish. Legacy catalog sources missing channel references must be reimported before playback.

Post IDs, metadata cache keys and playback grants include the channel ID, so post `7` in one DB cannot collide with post `7` in another. Explicit `watch:episode-id` captions are still **global catalog IDs**: reuse them only when intentionally grouping the same episode's qualities across channels. One MongoDB catalog and one bot are used; this is not MongoDB sharding or separate per-channel bots. `MAX_STREAMS` remains a global safety limit across all channels, not a separate allowance for each DB.

## Telegram link workflow (inside your authorized site)

Use this URL for your example post:

```text
https://YOUR-KOYEB-URL/https://t.me/c/2617067511/22047
```

Use this URL in an iframe on your allowed website, or use the optional `embed.js` helper below. Direct top-level playback is blocked by the player. It displays the player immediately; **nothing is fetched from the catalog or Telegram until the user presses Play**. On Play, the service resolves that post, stores/caches its metadata in MongoDB, and streams its video. You do not need captions, webhooks, episode IDs or prior imports. Existing posts work when Telegram allows your bot to retrieve them.

```html
<script defer src="https://YOUR-KOYEB-URL/embed.js"
 ></script>
<div data-telegram-url="https://t.me/c/2617067511/22047"></div>
```

In default `site` mode, no website backend changes or `/api/playback-token` endpoint are needed. Existing keys can remain configured; they are ignored. The legacy signed integration is optional and only used when you explicitly set `PLAYBACK_AUTH_MODE=signed`.

For proxies that normalize double slashes in a path, use:

```text
https://YOUR-KOYEB-URL/watch?url=https%3A%2F%2Ft.me%2Fc%2F2617067511%2F22047
```

These return HTML, not `<video src>` data. A plain iframe works; `embed.js` can also create it. Raw media and metadata use basic same-player Referrer/Fetch Metadata checks, not tokens. CSP restricts framing to the allowed website, and the player checks its parent origin before loading video. These checks can be forged outside a browser.

Only canonical `https://t.me/c/CHANNEL/POST` links belonging to the `TELEGRAM_CHANNEL_IDS` allowlist are accepted. The linked post plays its exact file: choose the low-quality upload to start with low quality. A lone link cannot identify unrelated uploads as alternate resolutions. Public channel usernames, topic/album links, and arbitrary remote URLs are not supported.

## Embed all your site's video placeholders

After installing the website backend integration, add the script once; existing and dynamically inserted placeholders become players:

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

**Autoplay is disabled**, including legacy `autoplay=1` parameters. The middle Play button starts loading. If a browser rejects sound playback after asynchronous loading, it prompts for another tap instead of silently failing. Double-click/double-tap the video on the left to seek −10 seconds, or on the right to seek +10 seconds. Seeking clamps at the start/end; double-click no longer enters fullscreen. Quality, speed, volume, subtitles, seeking and PiP are available; PiP requires browser support and active playback.

## Landscape fullscreen

Control/icon sizing is held to the initial embed scale (and can shrink for a narrower viewport), rather than enlarging when the video rotates or enters fullscreen. Fullscreen requests landscape orientation lock when supported. When orientation lock is denied and the fullscreen viewport is portrait, a CSS fallback rotates the **entire player, including its controls**. Leaving fullscreen clears the rotation. The settings menu also includes Landscape fullscreen. Some browsers (notably iOS native fullscreen) use their own controls and cannot be forced into a custom orientation; rotate the device in that case. Your iframe must grant fullscreen permission.

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

**Embedded subtitle detection:** the player listens to the browser's native `video.textTracks` list and adds supported embedded caption/subtitle tracks to the selector as “Embedded / browser”, alongside external tracks and the viewer's own file. Tracks can be switched on/off without extra server processing or a separate video download. This works **only when the browser exposes that container/codec's subtitle tracks**; it is not an MKV/MP4 demuxer and cannot detect every embedded ASS/SRT/PGS track. If none are exposed, the player says so rather than claiming the file has no subtitles. For unsupported files, extract/convert subtitles once outside Koyeb into WebVTT and attach external tracks. No FFmpeg, repeated whole-video scans, WASM transcoding, or extra Telegram range downloads are added. Enable CORS on external **subtitle storage** for the player origin; serve WebVTT as `text/vtt`. Subtitles are fetched separately and converted into local text tracks, so adding subtitles no longer forces a cross-origin CORS request on the video itself. Recommend fast-start H.264/AAC MP4 with HTTP byte-range support. No HLS/DASH transcoding, quality generation, DRM, or Sora Box/TeraBox resolver is included.

### Subtitle selection and errors

Track selections use stable identities instead of changing list indices. Temporary browser track resets no longer turn the selection into Off; local/external selections and supported embedded-language preferences are restored after quality/source changes. The selector always includes **Other… Add subtitle file**, even when no embedded track is exposed.

External VTT/SRT/ASS/SSA files are fetched **only when selected**, parsed in the browser worker, and displayed as native text cues. Recognized file extensions identify the format; extensionless endpoints are inspected as small subtitle text responses. Requests have size/time limits. A failed HTTP/CORS/format load shows its error and a **Retry selected subtitles** button rather than silently selecting a non-working track. Choosing Off/another language cancels an in-progress load. Only two parsed external subtitle files are cached, plus one viewer-supplied file; old cue sets are released. All subtitle conversion remains client-side, not on Koyeb.

### Audio language (English, Hindi, etc.)

Settings → **Audio language** lists the embedded audio tracks supplied by the browser's `HTMLMediaElement.audioTracks` API, using their language tags/labels. Selection enables just the chosen track without changing the video URL, seeking or transcoding. A matching language preference is restored when switching to another quality. If that language is missing, the player reports the fallback rather than pretending it selected it.

**This is browser/container dependent.** Many default Chromium/Chrome builds (including many Android browsers) do not expose this API for an MP4/MKV file, even if the file contains multiple audio streams. In that case the selector shows Default audio, is disabled and explains why. Exposed-but-read-only track switching is likewise reported as unsupported. It cannot invent an English/Hindi list or force the browser to decode an unsupported codec. Use a compatible browser/container, or prepare separate language versions externally. Universal switching would require a prepared adaptive-streaming format and a compatible demuxing/player pipeline; that is not added here.

No FFmpeg, multi-GB scans, server-side audio extraction or additional media stream are added to the Koyeb service. Your particular Telegram file/device still needs testing.

### Viewer-supplied subtitle files (no uploads)

Open Settings → **Other… Add your subtitle file**. Choose UTF-8 or BOM-marked UTF-16 `.srt`, `.vtt`, `.ass`, or `.ssa`; the file is parsed in a browser Web Worker and activated as a local text track. Nothing is uploaded to Telegram, MongoDB, or Koyeb. The limit is **2 MB / 10,000 cues**, with a parsing timeout to protect the viewer's device. The worker script is fetched only when needed; video still does not load until Play.

The local track survives quality switching, can be selected alongside external/browser-exposed tracks, and has a Remove option. Selecting another file replaces the prior local track to avoid accumulating memory. Local files are session-only (refresh clears them). ASS/SSA and VTT/SRT formatting is reduced to plain text; karaoke, fonts, positioning, drawings, bitmap subtitles and advanced styling are not supported. Users must choose subtitles timed to their video.

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

Default `PLAYBACK_AUTH_MODE=site` uses exact-site CSP and parent-origin checks plus basic Referrer/Fetch Metadata checks on metadata and media. No signed grants, cookies, website token route, or playback keys are required. Plain iframes work. If the browser lacks `ancestorOrigins`, it must receive the website origin through `document.referrer`; avoid `referrerpolicy="no-referrer"` on the embed.

This is NOT authentication or DRM: non-browser clients can forge headers and download videos. Admin imports, Telegram webhook secrets and DB-channel restrictions remain enforced. Only publish media you can distribute. Optional `PLAYBACK_AUTH_MODE=signed` restores the previous stricter flow, requiring website backend integration; see [SECURITY_SETUP.md](SECURITY_SETUP.md).

```sh
npm ci
cp .env.example .env
# Set credentials privately in .env
node --env-file=.env server.js
npm test
```

Tests cover validation, authentication, private-reference redaction, channel restrictions, byte ranges including >2 GB offsets, chunk slicing, cancellation, mocked Telegram GET/HEAD/416 responses, direct-link routes and concurrency limits. Unit tests inject an in-memory store; real MongoDB/Telegram integration requires your configured services. Browser checks use mocked media/metadata but exercise real grant/session endpoints and signature verification through a virtual HTTPS origin, not a real Telegram episode. Koyeb free-plan availability, database quotas, network limits and sleep behaviour depend on your providers.

### Browser regression checks

```sh
npx playwright install chromium
npm run test:browser
# Alternatively, use an existing Chromium binary:
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run test:browser
```

The legacy signed-mode browser suite checks signed-grant/session setup, renewal without media reload, direct-link denial, wrong-site iframe blocking, and **zero video/API requests before Play**, lowest-quality selection, play/pause, quality switching, mute, speed, seeking, double-click/double-tap gestures, local subtitle files, simulated browser-exposed tracks, and stable icon sizes across a simulated denied-orientation-lock fallback. Actual mobile OS fullscreen behavior and real streaming still need device/service testing. Screenshots can optionally be written to an existing directory using `SCREENSHOT_DIR`; do not commit test artifacts.

A real MongoDB integration test is opt-in: set `TEST_MONGODB_URI` before `npm test`. It uses and drops a new randomly named `watch_test_...` database (never the configured production database). Without that variable, the integration test is skipped and MongoDB adapter tests use a mock client. Font files in `public/fonts` are self-hosted Roboto, with their included license.

The browser test transport intercepts HTTPS responses and cannot fully model CHIPS partition keys or provider-specific cookie policies. Unit tests verify the `Partitioned`, `Secure`, `HttpOnly`, and `SameSite=None` attributes; verify cookie compatibility on real target browsers before production. A mocked site-session test covers the website helper, but your site's actual session integration is required only in optional signed mode.

Only if opting into signed mode, the agent working on your separate website repository can use the integration prompt in [WEBSITE_AGENT_PROMPT.md](WEBSITE_AGENT_PROMPT.md). The instructions include backend discovery, protected embedding, multiple-channel links and secret handling.

### Real-media regression tests (development only)

With FFmpeg available locally, run:

```sh
npm run test:media
# Or specify existing binaries:
FFMPEG_BIN=/path/to/ffmpeg BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run test:media
```

This generates an 8-second H.264/AAC MP4 with two language-tagged audio streams (440 Hz English / 880 Hz Hindi) under ignored `.cache/media-fixtures`. It uses actual browser media playback—not mocked HTMLMediaElement methods—to verify subtitle active cues, English/Hindi selection, source reload persistence, Off, HTTP failure/retry, cancellation, UTF-16 local subtitles, and audio switching. The test measures decoded audio frequency to confirm the audio really changed, not just the dropdown.

Chromium's experimental `AudioVideoTracks` flag is enabled **only in the supported-API test**. A separate ordinary Chromium run verifies the unsupported/default-audio message. The production player cannot enable browser experimental flags and does not claim universal multi-audio support. FFmpeg and generated media are test tools only; they are neither installed nor executed in the production Docker image. The main protected-player browser suite still tests authorization and controls separately. Static module/worker URLs are versioned together at startup to prevent mixing cached old scripts after deployment.

### Default site-URL playback regression

Run `npm run test:site` with the same browser/FFmpeg setup as `test:media`. It plays a real generated MP4 through the full player in a **plain iframe**, with no website script, keys, token endpoint or cookies. It verifies zero metadata/media requests before Play, successful playback afterward, direct-opening denial and wrong-site CSP blocking. The virtual HTTPS transport tests the application, not a deployed Koyeb service or live Telegram file.

### Unsupported files and playback errors

The player distinguishes decode failures from interrupted transfers and, after a failed same-origin stream, makes at most one four-second HEAD diagnostic request per source load. This requests headers only, never a second video download. It does not probe external providers or run before Play. Server-busy/denied/missing-file responses get specific messages instead of the browser's generic “no supported source” message.

If playback time advances without video dimensions for three seconds, playback pauses with a no-picture explanation. Where frame callbacks are supported, a visible player with dimensions but no delivered/decoded frames receives an eight-second grace period. Seeking, buffering and background tabs do not count toward these thresholds. This cannot detect visually black frames that were successfully decoded (for example, a black intro).

Retry reloads the source. A separate alternate-quality button appears only when the existing metadata lists another source; no sibling Telegram posts are guessed or scanned. Unsupported codecs, audio-only files and corrupt files are not repaired or transcoded. Use a compatible version (commonly H.264/AAC MP4) or an external compatible player. Renaming MKV to MP4 is not conversion. Diagnosing a particular file/device still requires its post link and playback details.
