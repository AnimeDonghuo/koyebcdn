import {parseSubtitles,decodeSubtitleBytes} from './subtitle-utils.js';
self.onmessage=event=>{
  try{
    const text=event.data.buffer?decodeSubtitleBytes(event.data.buffer):event.data.text;
    // Extensionless subtitle endpoints are common. Inspect only this small text
    // response, never the video/container; local files still require an extension.
    const name=event.data.name||(/^\uFEFF?WEBVTT(?:\s|$)/.test(text)?'remote.vtt':/^\[Events\]\s*$/mi.test(text)?'remote.ass':'remote.srt');
    self.postMessage({cues:parseSubtitles(text,name)});
  }catch(error){self.postMessage({error:error.message||'Could not read subtitle file.'});}
};
