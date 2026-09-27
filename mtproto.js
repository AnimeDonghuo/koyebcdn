import {TelegramClient} from 'teleproto';
import {StringSession} from 'teleproto/sessions/index.js';
import bigInt from 'big-integer';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Single ranges only. Sizes and offsets are numbers, never 32-bit bitwise values.
export function byteRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid media size');
  if (!header) return {start:0,end:size-1,partial:false};
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  const invalid=()=>{throw Object.assign(new Error('Unsatisfiable range'),{status:416});};
  if (!match || (!match[1]&&!match[2])) return invalid();
  let start,end;
  if (!match[1]) {const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return invalid();start=Math.max(0,size-suffix);end=size-1;}
  else {start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return invalid();
  return {start,end:Math.min(size-1,end),partial:true};
}

// At most one download chunk buffered; backpressure from the HTTP socket controls reads.
export async function* sliceChunks(chunks,skip,length,signal) {
  for await(const chunk of chunks) {
    signal?.throwIfAborted();
    if(skip>=chunk.length){skip-=chunk.length;continue;}
    const part=chunk.subarray(skip,Math.min(chunk.length,skip+length));skip=0;
    length-=part.length;yield part;
    if(!length)return;
  }
  if(length)throw new Error('Incomplete Telegram transfer');
}

export function createMTProto(env, makeClient=(...args)=>new TelegramClient(...args)) {
  const enabled=!!(env.TELEGRAM_API_ID&&env.TELEGRAM_API_HASH&&env.TELEGRAM_BOT_TOKEN);
  let client,pending,retryAfter=0;
  async function connect() {
    if(Date.now()<retryAfter)throw Object.assign(new Error('Telegram connection unavailable; retry shortly'),{status:503});
    if(!pending) pending=(async()=>{
      client=makeClient(new StringSession(''),Number(env.TELEGRAM_API_ID),env.TELEGRAM_API_HASH,{
        connectionRetries:2,requestRetries:2,timeout:10,floodSleepThreshold:0,autoReconnect:true,
      });
      client.setLogLevel('none');
      // Bot authorization only: no interactive phone / OTP / user session.
      await client.start({botAuthToken:env.TELEGRAM_BOT_TOKEN,onError:()=>{throw new Error('Bot authorization failed');}});
      return client;
    })().catch(async()=>{retryAfter=Date.now()+30000;await client?.destroy().catch(()=>{});pending=null;throw Object.assign(new Error('Telegram bot authorization failed; check server configuration'),{status:503});});
    return pending;
  }
  async function getMessage(source) {
    const client=await connect();
    const messages=await client.getMessages(bigInt(source.channelId),{ids:[source.messageId]});
    const message=messages[0],document=message?.media?.document;
    if(!document)throw Object.assign(new Error('Telegram message is deleted or inaccessible to this bot'),{status:404});
    if(!document.mimeType?.startsWith('video/'))throw Object.assign(new Error('This Telegram post is not a video file'),{status:415});
    return {client,message,document};
  }
  return {
    enabled,
    async describe(source) {
      const {message,document}=await getMessage(source);
      const attributes=document.attributes||[];
      const name=attributes.find(a=>typeof a.fileName==='string')?.fileName;
      const video=attributes.find(a=>Number.isFinite(a.h)&&a.h>0);
      const caption=message.message||'';
      const height=Number(caption.match(/\bquality:(\d{3,4})\b/)?.[1] ?? name?.match(/\b(\d{3,4})p\b/i)?.[1] ?? video?.h ?? 480);
      return {title:(caption||name||`Video ${source.messageId}`).slice(0,250),height,type:document.mimeType};
    },
    async stream(req,res,source,signal) {
      signal.throwIfAborted();
      // Refresh file references at playback time rather than persisting expiring references.
      const {client,message,document}=await getMessage(source);
      signal.throwIfAborted();
      const size=Number(document.size.toString());
      let range;
      try{range=byteRange(req.headers.range,size);}catch(e){if(e.status===416)res.setHeader('Content-Range',`bytes */${size}`);throw e;}
      const length=range.end-range.start+1;
      res.statusCode=range.partial?206:200;
      res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',length);
      res.setHeader('Content-Type',document.mimeType||'video/mp4');res.setHeader('Cache-Control','private, no-store');
      if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${size}`);
      if(req.method==='HEAD')return res.end();
      // Telegram requires 4 KB offsets; start at a 512 KB boundary then trim.
      const requestSize=512*1024,offset=Math.floor(range.start/requestSize)*requestSize,skip=range.start-offset;
      const chunks=client.iterDownload(message,{offset,limit:skip+length,requestSize,signal});
      await pipeline(Readable.from(sliceChunks(chunks,skip,length,signal),{objectMode:false,highWaterMark:requestSize}),res,{signal});
    },
    async close(){await client?.destroy();},
  };
}
