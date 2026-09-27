export const MAX_TELEGRAM_BYTES = 20 * 1024 * 1024;
export function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
export function httpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
export function validateVideo(input) {
  if (!input || !validId(input.id)) throw new Error('Invalid video id');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 250) throw new Error('Title required (max 250 characters)');
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 12) throw new Error('Supply 1–12 sources');
  const sources = input.sources.map(s => {
    if (!s || !Number.isInteger(s.height) || s.height < 1 || s.height > 8640 || !httpsUrl(s.url)) throw new Error('Each source needs an HTTPS URL and numeric height');
    return {height:s.height, url:s.url, type:'video/mp4'};
  });
  if (new Set(sources.map(s => s.height)).size !== sources.length) throw new Error('Duplicate quality');
  const subtitles = input.subtitles ?? [];
  if (!Array.isArray(subtitles) || subtitles.length > 30) throw new Error('Too many subtitles');
  return {id:input.id, title:input.title.trim(), sources:sources.sort((a,b)=>a.height-b.height), subtitles:subtitles.map(s=> {
    if (!s || !httpsUrl(s.url) || typeof s.label !== 'string' || s.label.length > 80 || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(s.language)) throw new Error('Subtitle needs HTTPS WebVTT URL, label and language');
    return {url:s.url,label:s.label,language:s.language};
  })};
}
export function telegramVideo(message) {
  const file = message.video ?? message.document;
  if (!file || !(message.video || file.mime_type?.startsWith('video/'))) return null;
  // Caption: watch:episode-01 quality:480 Title of episode
  const caption = message.caption ?? '';
  const id = caption.match(/\bwatch:([a-zA-Z0-9_-]{1,100})\b/)?.[1] ?? `tg-${String(message.chat.id).replace('-', '')}-${message.message_id}`;
  const height = Number(caption.match(/\bquality:(\d{3,4})\b/)?.[1] ?? file.file_name?.match(/\b(\d{3,4})p\b/i)?.[1] ?? file.height ?? 480);
  return {id,title:caption.replace(/\b(?:watch:[\w-]+|quality:\d+)\b/g,'').trim().slice(0,250) || file.file_name || 'Telegram video',source:{height,channelId:String(message.chat.id),messageId:message.message_id,fileId:file.file_id,size:file.file_size ?? null,type:file.mime_type ?? 'video/mp4'}};
}
export function publicVideo(video, mtprotoEnabled=false) {
  return {...video, sources:video.sources.map(({fileId,size,channelId,messageId,...s})=> {
    if(!fileId)return {...s,available:true};
    const mtproto=mtprotoEnabled && !!channelId && Number.isInteger(messageId);
    const available=mtproto || (typeof size==='number' && size<=MAX_TELEGRAM_BYTES);
    return {...s,url:`/media/${video.id}/${s.height}`,available,reason:available?undefined:
      'Large Telegram files require MTProto bot authorization (API ID, API hash, bot token) and a newly imported channel post, or a direct media URL.'};
  }).sort((a,b)=>a.height-b.height)};
}
