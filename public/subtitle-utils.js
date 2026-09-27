export const MAX_SUBTITLE_BYTES=2*1024*1024;
export const MAX_SUBTITLE_CUES=10000;

export function decodeSubtitleBytes(buffer){
  const bytes=new Uint8Array(buffer);
  if(bytes.byteLength>MAX_SUBTITLE_BYTES)throw new Error('Subtitle files must be 2 MB or smaller.');
  let encoding='utf-8';
  if(bytes[0]===0xff&&bytes[1]===0xfe)encoding='utf-16le';
  else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be';
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{throw new Error('Unsupported subtitle encoding. Save the file as UTF-8 or UTF-16 with a BOM.');}
}

function timestamp(value){
  const match=/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if(!match)return NaN;
  const [,h='0',m,s,f]=match;
  if(Number(m)>59||Number(s)>59)return NaN;
  return Number(h)*3600+Number(m)*60+Number(s)+Number(f.padEnd(3,'0'))/1000;
}
function plain(text){
  return text.replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity]));
}
// Parsing only: no HTML insertion, server uploads, or FFmpeg. ASS styling/karaoke
// and positioning are intentionally reduced to readable plain text.
export function parseSubtitles(text,filename){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_SUBTITLE_BYTES)throw new Error('Subtitle files must be 2 MB or smaller.');
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const extension=filename.split('.').pop().toLowerCase();
  if(!['srt','vtt','ass','ssa'].includes(extension))throw new Error('Choose an SRT, WebVTT, ASS or SSA subtitle file.');
  const cues=[];
  const add=(start,end,text)=>{
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!text.trim())return;
    if(cues.length>=MAX_SUBTITLE_CUES)throw new Error('Subtitle file contains too many cues (maximum 10,000).');
    cues.push({start,end,text:text.trim()});
  };
  if(extension==='ass'||extension==='ssa'){
    let inEvents=false,fields=[];
    for(const line of text.split('\n')){
      if(/^\[.*\]$/.test(line.trim())){inEvents=/^\[Events\]$/i.test(line.trim());continue;}
      if(!inEvents)continue;
      if(/^Format:/i.test(line)){fields=line.slice(line.indexOf(':')+1).split(',').map(x=>x.trim().toLowerCase());continue;}
      if(!/^Dialogue:/i.test(line)||!fields.length)continue;
      // Text is the final standard ASS field and may itself contain commas.
      const values=line.slice(line.indexOf(':')+1).trimStart().split(',');
      if(fields.at(-1)!=='text')throw new Error('Unsupported ASS format: Text must be the last event field.');
      const raw=values.slice(fields.length-1).join(',');
      // Drawing-mode captions are not text and cannot become WebVTT cues.
      if(/\\p[1-9]/.test(raw))continue;
      const body=raw.replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ');
      add(timestamp(values[fields.indexOf('start')]||''),timestamp(values[fields.indexOf('end')]||''),plain(body));
    }
  }else{
    if(extension==='vtt'&&!/^WEBVTT(?:[ \t\n]|$)/.test(text))throw new Error('Invalid WebVTT header.');
    for(const block of text.split(/\n[ \t]*\n/)){
      const lines=block.split('\n');
      if(/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]))continue;
      const index=lines.findIndex(line=>line.includes('-->'));
      if(index<0)continue;
      const match=/^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[index]);
      if(match)add(timestamp(match[1]),timestamp(match[2]),plain(lines.slice(index+1).join('\n')));
    }
  }
  if(!cues.length)throw new Error('No supported text subtitles were found in this file.');
  return cues.sort((a,b)=>a.start-b.start||a.end-b.end);
}
