// Real video in a plain iframe: no embed.js, website backend, keys or cookies.
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {createMemoryStore} from '../store.js';
import {DEFAULT_SITE_ORIGIN} from '../playback-auth.js';
import {byteRange} from '../mtproto.js';
import {generateMedia} from './generate-media.mjs';
const directory=generateMedia(),normalFile=readFileSync(`${directory}/dual-audio.mp4`);
let file=normalFile,unavailable=false;
execFileSync(process.env.FFMPEG_BIN||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:a','aac','-b:a','32k','-movflags','+faststart','-y',`${directory}/audio-only.mp4`]);
let lookups=0,streams=0;
const server=createApp({TELEGRAM_CHANNEL_ID:'-1002617067511'},{store:createMemoryStore(),mtproto:{enabled:true,
  async describe(){lookups++;return {title:'Plain iframe test',height:180,type:'video/mp4'};},
  async stream(req,res){streams++;if(unavailable)throw Object.assign(new Error('Busy'),{status:503});const range=byteRange(req.headers.range,file.length);res.statusCode=range.partial?206:200;res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',range.end-range.start+1);if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${file.length}`);res.end(req.method==='HEAD'?undefined:file.subarray(range.start,range.end+1));},async close(){},
}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,playerOrigin='https://player.example',watch=playerOrigin+'/watch?url=https%3A%2F%2Ft.me%2Fc%2F2617067511%2F7';
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext(),requests=[],errors=[];
  context.on('request',r=>requests.push(r.url()));context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route(playerOrigin+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),headers={...await req.allHeaders(),host:url.host};
    for(const name of ['connection','content-length','accept-encoding'])delete headers[name];
    if(req.isNavigationRequest())headers['sec-fetch-mode']='navigate';
    const result=await new Promise((resolve,reject)=>{const upstream=http.request(base+url.pathname+url.search,{method:req.method(),headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});upstream.on('error',reject);upstream.end(req.postData());});
    const responseHeaders={};for(const [k,v] of Object.entries(result.headers))if(v!==undefined)responseHeaders[k]=Array.isArray(v)?v.join('\n'):v;
    await route.fulfill({...result,headers:responseHeaders});
  });
  const page=await context.newPage();
  await context.route(DEFAULT_SITE_ORIGIN+'/plain-test',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><iframe src="${watch}" width="706" height="398" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>`}));
  await page.goto(DEFAULT_SITE_ORIGIN+'/plain-test');
  const frame=await (await page.waitForSelector('iframe')).contentFrame();await frame.waitForSelector('#center-play');
  assert.equal(lookups,0);assert.equal(streams,0);assert.ok(!requests.some(u=>u.includes('/api/')));
  await frame.locator('#center-play').click();
  await frame.waitForFunction(()=>document.querySelector('video').currentTime>0.2,{},{timeout:15000});
  assert.equal(lookups,1);assert.ok(streams>0);assert.equal(await frame.locator('#notice').isVisible(),false);
  assert.ok(!requests.some(u=>u.includes('/api/playback')||u.includes('/api/playback-token')));
  assert.deepEqual(await context.cookies(),[]);assert.deepEqual(errors,[]);
  await frame.locator('video').evaluate(v=>v.pause());
  console.log('PASS: plain iframe plays real MP4 with no keys, handshake, token endpoint or cookies; no video/metadata before Play');
  async function openAndPlay(){
    await page.goto(DEFAULT_SITE_ORIGIN+'/plain-test');const frame=await (await page.waitForSelector('iframe')).contentFrame();await frame.locator('#center-play').click();return frame;
  }
  unavailable=true;
  let failed=await openAndPlay();await failed.waitForFunction(()=>document.querySelector('#status').textContent.includes('busy or temporarily unavailable'));
  unavailable=false;await failed.locator('#retry').click();await failed.waitForFunction(()=>document.querySelector('video').currentTime>0.2);
  assert.equal(await failed.locator('#notice').isVisible(),false);
  file=Buffer.from('This is not a video file.');
  failed=await openAndPlay();await failed.waitForFunction(()=>document.querySelector('#status').textContent.includes('H.264'));
  assert.equal(await failed.locator('#settings-panel').isVisible(),false);
  file=readFileSync(`${directory}/audio-only.mp4`);
  failed=await openAndPlay();await failed.waitForFunction(()=>document.querySelector('#status').textContent.includes('no video picture'),{},{timeout:15000});
  assert.equal(await failed.locator('video').evaluate(v=>v.paused),true);
  assert.equal(await failed.locator('#try-quality').isVisible(),false,'do not invent another quality for a direct post');
  file=normalFile;await failed.locator('#retry').click();await failed.waitForFunction(()=>document.querySelector('video').videoWidth>0&&!document.querySelector('video').paused);
  assert.equal(await failed.locator('#notice').isVisible(),false);
  console.log('PASS: HTTP 503 identified, retry recovers, invalid media has codec guidance, audio-only timer pauses and healthy retry plays video');
  const before=streams;
  await page.goto(watch);await page.locator('#center-play').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Direct-link playback is disabled'));
  assert.equal(streams,before);
  await context.route('https://evil.example/test',r=>r.fulfill({contentType:'text/html',body:`<iframe src="${watch}"></iframe>`}));
  await page.goto('https://evil.example/test');
  const blocked=await (await page.waitForSelector('iframe')).contentFrame();assert.equal(await blocked.locator('#center-play').count(),0);assert.equal(streams,before);
  console.log('PASS: direct top-level playback denied and wrong-site iframe blocked by CSP');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
