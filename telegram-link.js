// Parse only private-channel post links. Never fetch a user-supplied URL.
export function parseTelegramLink(value, allowedChannel) {
  let url;
  try { url=new URL(value); } catch { throw Object.assign(new Error('Use a Telegram post URL such as https://t.me/c/2617067511/22047'),{status:400}); }
  const match=/^\/c\/([1-9]\d{0,14})\/([1-9]\d{0,9})\/?$/.exec(url.pathname);
  if(url.protocol!=='https:' || url.hostname!=='t.me' || url.port || url.username || url.password || !match || url.search || url.hash) {
    throw Object.assign(new Error('Only https://t.me/c/CHANNEL/POST links are supported'),{status:400});
  }
  const channelId=`-100${match[1]}`,messageId=Number(match[2]);
  if(messageId>2147483647)throw Object.assign(new Error('Invalid Telegram post number'),{status:400});
  if(!allowedChannel)throw Object.assign(new Error('Set TELEGRAM_CHANNEL_ID to your DB channel ID in Koyeb'),{status:503});
  if(channelId!==allowedChannel)throw Object.assign(new Error('This post is not in the configured DB channel'),{status:403});
  return {channelId,messageId};
}
export function linkFromPath(path) {
  const value=path.startsWith('/watch/https')?path.slice(7):path.slice(1);
  try { return decodeURIComponent(value); } catch { return value; }
}
export function isTelegramPlayerPath(path) {
  return /^\/(?:watch\/)?https(?::|%3a)/i.test(path);
}
