import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {createMemoryStore} from '../store.js';
import {DEFAULT_SITE_ORIGIN} from '../playback-auth.js';

const security={PLAYBACK_AUTH_MODE:'signed',PLAYBACK_SIGNING_SECRET:'browser-test-signing-secret-'.repeat(2),PLAYBACK_ISSUER_KEY:'browser-test-issuer-key-'.repeat(2),TELEGRAM_CHANNEL_ID:'-1002617067511'};
const server=createApp(security, {store:createMemoryStore()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:706,height:398}});
  const outer=await context.newPage();
  const errors=[],requests=[];
  outer.on('pageerror',e=>errors.push(e.message));outer.on('request',r=>requests.push(r.url()));
  // Deterministic media events: tests UI/network gating, not real codecs or Telegram.
  await outer.addInitScript(()=>{
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this._paused!==false;}});
    Object.defineProperty(HTMLMediaElement.prototype,'duration',{get(){return 1216;}});
    Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{get(){return this._time||0;},set(v){this._time=v;this.dispatchEvent(new Event('timeupdate'));}});
    HTMLMediaElement.prototype.load=function(){queueMicrotask(()=>{this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('durationchange'));});};
    HTMLMediaElement.prototype.play=async function(){this._paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));};
    HTMLMediaElement.prototype.pause=function(){this._paused=true;this.dispatchEvent(new Event('pause'));};
  });
  let lookups=0,grantsIssued=0,sessionsOpened=0;
  await outer.context().route('**/api/telegram?**',route=>{lookups++;return route.fulfill({json:{title:'Rlep160 engsub+Indo CC [4K]',sources:[{height:2160,url:'/fake-4k.mp4',available:true},{height:480,url:'/fake-480.mp4',available:true}],subtitles:[]}});});
  const base=`http://127.0.0.1:${server.address().port}`,playerOrigin='https://player.example';
  // HTTPS virtual origin avoids mixed-content/localhost permissions in tests.
  // Requests still exercise the real server, signatures and Set-Cookie handling.
  await outer.context().route(`${playerOrigin}/**`,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/playback/session'&&request.method()==='POST')sessionsOpened++;
    if(url.pathname==='/api/telegram')return route.fallback();
    const headers={...await request.allHeaders()};for(const key of ['host','connection','content-length','accept-encoding'])delete headers[key];
    // Playwright intercepts before Chromium appends Fetch Metadata headers.
    if(request.isNavigationRequest())headers['sec-fetch-mode']='navigate';
    const response=await new Promise((resolve,reject)=>{
      const upstream=http.request(base+url.pathname+url.search,{method:request.method(),headers},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
      });upstream.on('error',reject);upstream.end(request.postData());
    });
    const responseHeaders={};for(const [key,value] of Object.entries(response.headers))if(value!==undefined)responseHeaders[key]=Array.isArray(value)?value.join('\n'):value;
    await route.fulfill({status:response.status,headers:responseHeaders,body:response.body});
  });
  await outer.context().route(`${DEFAULT_SITE_ORIGIN}/api/playback-token`,async route=>{
    grantsIssued++;
    const res=await fetch(base+'/api/playback/grant',{method:'POST',headers:{Authorization:`Bearer ${security.PLAYBACK_ISSUER_KEY}`,'Content-Type':'application/json'},body:route.request().postData()});
    await route.fulfill({status:res.status,json:await res.json()});
  });
  await outer.context().route(`${DEFAULT_SITE_ORIGIN}/player-test`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body{margin:0;height:100%}#embed{width:100%;height:100%}</style><script defer src="${playerOrigin}/embed.js"></script><div id="embed" data-telegram-url="https://t.me/c/2617067511/22047" data-title="Rlep160 engsub+Indo CC [4K]"></div>`}));
  await outer.goto(`${DEFAULT_SITE_ORIGIN}/player-test`);
  const frameHandle=await outer.waitForSelector('iframe');
  const page=await frameHandle.contentFrame();await page.waitForSelector('#center-play');
  assert.equal(lookups,0,'autoplay parameter must not bypass click-to-load');
  assert.ok(!requests.some(u=>u.includes('/api/')||u.includes('/media/')||u.includes('.mp4')));
  assert.equal(await page.locator('video').getAttribute('src'),null);
  await page.locator('#settings').click();assert.equal(await page.locator('#settings-panel').isVisible(),true);
  await page.locator('#settings-panel .close-panel').click();assert.equal(lookups,0);
  // Local subtitle import happens entirely in the browser, even before playback.
  await page.locator('#settings').click();
  await page.locator('#subtitle-file').setInputFiles({name:'viewer.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:15,000\nViewer subtitle\n')});
  await page.waitForFunction(()=>document.querySelector('#subtitle-status').textContent.includes('Nothing uploaded'));
  assert.equal(lookups,0);assert.ok(!requests.some(u=>u.includes('/api/')||u.includes('/media/')||u.includes('.mp4')));
  assert.equal(await page.locator('video').evaluate(v=>Array.from(v.textTracks).find(t=>t.label==='Local subtitles').cues[0].text),'Viewer subtitle');
  // Off must not hide the local option; another file replaces rather than adds a track.
  await page.locator('#subtitles').selectOption('-1');
  assert.ok(await page.locator('#subtitles').evaluate(s=>Array.from(s.options).some(o=>o.textContent.includes('Your file'))));
  await page.locator('#subtitle-file').setInputFiles({name:'replacement.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:15,000\nReplacement subtitle\n')});
  await page.waitForFunction(()=>document.querySelector('#subtitle-status').textContent.startsWith('replacement.srt:'));
  assert.equal(await page.locator('video').evaluate(v=>Array.from(v.textTracks).filter(t=>t.label==='Local subtitles').length),1);
  assert.equal(await page.locator('video').evaluate(v=>Array.from(v.textTracks).find(t=>t.label==='Local subtitles').cues.length),1);
  await page.locator('#settings-panel .close-panel').click();
  await page.locator('#center-play').click();await page.waitForFunction(()=>document.querySelector('#center-play').getAttribute('aria-label')==='Pause video');
  assert.equal(lookups,1);assert.match(await page.locator('video').getAttribute('src'),/480/);
  assert.equal(await page.locator('#duration').textContent(),'20:16');
  await page.locator('#next').click();assert.equal(await page.locator('#elapsed').textContent(),'0:10');
  await page.locator('#center-play').click();assert.equal(await page.locator('#center-play').getAttribute('aria-label'),'Play video');
  await page.locator('#settings').click();await page.locator('#quality').selectOption('1');
  assert.match(await page.locator('video').getAttribute('src'),/4k/);
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),10);
  assert.equal(await page.locator('video').evaluate(v=>Array.from(v.textTracks).find(t=>t.label==='Local subtitles').mode),'showing','local subtitles survive quality changes');
  await page.locator('#speed').selectOption('1.5');assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),1.5);
  await page.locator('#settings-panel .close-panel').click();
  await page.locator('#mute').click();await page.waitForFunction(()=>document.querySelector('#mute').getAttribute('aria-label')==='Unmute');assert.equal(await page.locator('#mute').getAttribute('aria-label'),'Unmute');
  await page.locator('#playlist').click();assert.equal(await page.locator('#playlist-panel').isVisible(),true);
  await page.locator('#playlist-panel .close-panel').click();
  // Mouse double-click seeking, including clamping at both ends.
  await page.locator('video').evaluate(v=>v.currentTime=50);
  await page.locator('video').dblclick({position:{x:600,y:140}});
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),60);
  await page.locator('video').dblclick({position:{x:100,y:140}});
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),50);
  await page.locator('video').evaluate(v=>v.currentTime=5);
  await page.locator('video').dblclick({position:{x:100,y:140}});
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),0);
  await page.locator('video').evaluate(v=>v.currentTime=1214);
  await page.locator('video').dblclick({position:{x:600,y:140}});
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),1216);
  // Simulate browser-exposed embedded tracks; do not pretend this demuxes MKV.
  await page.locator('video').evaluate(v=>{const t=v.addTextTrack('subtitles','Embedded English','en');t.addCue(new VTTCue(0,10,'Embedded cue'));});
  await page.waitForFunction(()=>Array.from(document.querySelector('#subtitles').options).some(o=>o.textContent.includes('Embedded English')));
  await page.locator('#settings').click();
  const embedded=await page.locator('#subtitles').evaluate(s=>Array.from(s.options).find(o=>o.textContent.includes('Embedded English')).value);
  await page.locator('#subtitles').selectOption(embedded);
  assert.equal(await page.locator('video').evaluate(v=>Array.from(v.textTracks).find(t=>t.label==='Embedded English').mode),'showing');
  await page.locator('#subtitles').selectOption('-1');
  assert.ok(await page.locator('video').evaluate(v=>Array.from(v.textTracks).every(t=>t.mode==='disabled')));
  await page.locator('#remove-subtitles').click();
  assert.equal(await page.locator('video').evaluate(v=>{const t=Array.from(v.textTracks).find(t=>t.label==='Local subtitles');t.mode='hidden';const n=t.cues?.length||0;t.mode='disabled';return n;}),0);
  // Invalid replacement is reported without crashing the player.
  await page.locator('#subtitle-file').setInputFiles({name:'bad.srt',mimeType:'text/plain',buffer:Buffer.from('not subtitles')});
  await page.waitForFunction(()=>document.querySelector('#subtitle-status').textContent.includes('No supported'));
  await page.locator('#settings-panel .close-panel').click();
  if(process.env.SCREENSHOT_DIR){await outer.screenshot({path:`${process.env.SCREENSHOT_DIR}/player-mobile.png`});await outer.setViewportSize({width:1568,height:706});await outer.screenshot({path:`${process.env.SCREENSHOT_DIR}/player-landscape.png`});}
  // An active viewer renews the cookie without reloading the media URL.
  await outer.clock.install();
  const mediaBefore=await page.locator('video').getAttribute('src');
  await page.locator('video').evaluate(v=>v.play());
  await outer.clock.fastForward(550000);
  await outer.waitForResponse(response=>response.url().startsWith(playerOrigin+'/api/playback/session?')&&response.status()===200);
  assert.ok(grantsIssued>=2);assert.ok(sessionsOpened>=2);
  assert.equal(await page.locator('video').getAttribute('src'),mediaBefore);
  await page.locator('video').evaluate(v=>v.pause());
  await outer.clock.resume();
  // Exercise orientation fallback separately from device-specific fullscreen permissions.
  await outer.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    let active=null;Object.defineProperty(document,'fullscreenElement',{get:()=>active,configurable:true});
    document.querySelector('#player').requestFullscreen=async()=>{active=document.querySelector('#player');document.dispatchEvent(new Event('fullscreenchange'));};
    document.exitFullscreen=async()=>{active=null;document.dispatchEvent(new Event('fullscreenchange'));};
    screen.orientation.lock=async()=>{throw new Error('Unsupported');};
  });
  const beforeSize=await page.locator('#fullscreen').evaluate(el=>parseFloat(getComputedStyle(el).width));
  await page.locator('#fullscreen').click();assert.equal(await page.locator('#player').evaluate(el=>el.classList.contains('landscape-fallback')),true);
  await page.waitForFunction(()=>document.querySelector('#stage').clientWidth>700);
  const afterSize=await page.locator('#fullscreen').evaluate(el=>parseFloat(getComputedStyle(el).width));
  assert.ok(afterSize<=beforeSize+.5,`rotation should not enlarge icons: ${beforeSize} -> ${afterSize}`);
  // Touch seeking respects the rotated stage's horizontal (screen-Y) axis.
  await page.locator('video').evaluate(v=>{
    v.currentTime=50;const r=v.getBoundingClientRect();
    const options={bubbles:true,pointerType:'touch',isPrimary:true,pointerId:7,clientX:r.left+r.width/2,clientY:r.top+r.height*.8};
    for(let i=0;i<2;i++){v.dispatchEvent(new PointerEvent('pointerdown',options));v.dispatchEvent(new PointerEvent('pointerup',options));}
    v.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:options.clientX,clientY:options.clientY}));
  });
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),60,'double tap seeks once; synthetic dblclick is ignored');

  await page.locator('#fullscreen').click();assert.equal(await page.locator('#player').evaluate(el=>el.classList.contains('landscape-fallback')),false);
  const savedGrants=grantsIssued;
  const direct=await outer.context().newPage();
  await direct.goto(playerOrigin+'/watch?url=https%3A%2F%2Ft.me%2Fc%2F2617067511%2F22047');
  await direct.locator('#center-play').click();
  await direct.waitForFunction(()=>document.querySelector('#status').textContent.includes('Direct-link playback is disabled'));
  assert.equal(grantsIssued,savedGrants);
  const copied=await direct.goto(playerOrigin+'/telegram/media/2617067511/22047');
  assert.equal(copied.status(),403);
  await direct.close();
  const outsider=await outer.context().newPage();
  await outsider.route('https://copy.example/test',route=>route.fulfill({contentType:'text/html',body:`<iframe src="${playerOrigin}/watch/episode"></iframe>`}));
  await Promise.all([
    outsider.waitForEvent('console',{predicate:msg=>msg.text().includes('frame-ancestors'),timeout:10000}),
    outsider.goto('https://copy.example/test'),
  ]);
  await outsider.close();
  // route.fulfill's cookie handling does not model CHIPS partition keys. The
  // unit suite verifies Partitioned is emitted; real browser/provider testing
  // is still needed for partitioning and third-party-cookie compatibility.
  const cookies=await outer.context().cookies(playerOrigin);
  assert.ok(cookies.some(cookie=>cookie.name.startsWith('__Host-watch-')&&cookie.httpOnly&&cookie.secure));
  assert.deepEqual(errors,[]);console.log('PASS: click-to-load, playback controls, double-click/tap seeking, local subtitles, browser-exposed tracks rotation stability, signed sessions, renewal, CSP and copied-link denial');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
