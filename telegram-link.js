// IDs stay strings; never convert Telegram channel IDs to floating-point numbers.
export function parseChannelIds(value='') {
  if(typeof value!=='string')throw new Error('Telegram DB channel IDs must be a comma-separated string');
  const channels=new Set(value.split(/[,\s]+/).filter(Boolean));
  for(const id of channels)if(!/^-100[1-9]\d{0,14}$/.test(id))throw new Error('Invalid Telegram DB channel ID; use complete -100… numeric IDs, not URLs or wildcards');
  return channels;
}
export function configuredTelegramChannels(env) {
  // Explicit non-empty plural config REPLACES the legacy singular setting.
  // Removing a channel from the list must not silently retain it via an old env.
  return parseChannelIds(env.TELEGRAM_CHANNEL_IDS?.trim() || env.TELEGRAM_CHANNEL_ID?.trim() || '');
}

// Parse only private-channel post links. Never fetch a user-supplied URL.
export function parseTelegramLink(value, allowedChannels) {
  let url;
  try { url=new URL(value); } catch { throw Object.assign(new Error('Use a Telegram post URL such as https://t.me/c/2617067511/22047'),{status:400}); }
  const match=/^\/c\/([1-9]\d{0,14})\/([1-9]\d{0,9})\/?$/.exec(url.pathname);
  if(url.protocol!=='https:' || url.hostname!=='t.me' || url.port || url.username || url.password || !match || url.search || url.hash) {
    throw Object.assign(new Error('Only https://t.me/c/CHANNEL/POST links are supported'),{status:400});
  }
  const channelId=`-100${match[1]}`,messageId=Number(match[2]);
  if(messageId>2147483647)throw Object.assign(new Error('Invalid Telegram post number'),{status:400});
  const channels=allowedChannels instanceof Set?allowedChannels:parseChannelIds(allowedChannels||'');
  if(!channels.size)throw Object.assign(new Error('Set TELEGRAM_CHANNEL_IDS to your allowed DB channel IDs in Koyeb'),{status:503});
  if(!channels.has(channelId))throw Object.assign(new Error('This post is not in an allowed DB channel'),{status:403});
  return {channelId,messageId};
}
export function linkFromPath(path) {
  const value=path.startsWith('/watch/https')?path.slice(7):path.slice(1);
  try { return decodeURIComponent(value); } catch { return value; }
}
export function isTelegramPlayerPath(path) {
  return /^\/(?:watch\/)?https(?::|%3a)/i.test(path);
}
