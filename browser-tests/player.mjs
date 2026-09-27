import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {createMemoryStore} from '../store.js';

const server=createApp({}, {store:createMemoryStore()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:706,height:398}});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  // Deterministic media events: tests UI/network gating, not real codecs or Telegram.
  await page.addInitScript(()=>{
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this._paused!==false;}});
    Object.defineProperty(HTMLMediaElement.prototype,'duration',{get(){return 1216;}});
    Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{get(){return this._time||0;},set(v){this._time=v;this.dispatchEvent(new Event('timeupdate'));}});
    HTMLMediaElement.prototype.load=function(){queueMicrotask(()=>{this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('durationchange'));});};
    HTMLMediaElement.prototype.play=async function(){this._paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));};
    HTMLMediaElement.prototype.pause=function(){this._paused=true;this.dispatchEvent(new Event('pause'));};
  });
  let lookups=0;
  await page.route('**/api/telegram?**',route=>{lookups++;return route.fulfill({json:{title:'Rlep160 engsub+Indo CC [4K]',sources:[{height:2160,url:'/fake-4k.mp4',available:true},{height:480,url:'/fake-480.mp4',available:true}],subtitles:[]}});});
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/https://t.me/c/2617067511/22047?title=Rlep160%20engsub%2BIndo%20CC%20%5B4K%5D&autoplay=1`);
  assert.equal(lookups,0,'autoplay parameter must not bypass click-to-load');
  assert.ok(!requests.some(u=>u.includes('/api/')||u.includes('/media/')||u.includes('.mp4')));
  assert.equal(await page.locator('video').getAttribute('src'),null);
  await page.locator('#settings').click();assert.equal(await page.locator('#settings-panel').isVisible(),true);
  await page.locator('#settings-panel .close-panel').click();assert.equal(lookups,0);
  await page.locator('#center-play').click();await page.waitForFunction(()=>document.querySelector('#center-play').getAttribute('aria-label')==='Pause video');
  assert.equal(lookups,1);assert.match(await page.locator('video').getAttribute('src'),/480/);
  assert.equal(await page.locator('#duration').textContent(),'20:16');
  await page.locator('#next').click();assert.equal(await page.locator('#elapsed').textContent(),'0:10');
  await page.locator('#center-play').click();assert.equal(await page.locator('#center-play').getAttribute('aria-label'),'Play video');
  await page.locator('#settings').click();await page.locator('#quality').selectOption('1');
  assert.match(await page.locator('video').getAttribute('src'),/4k/);
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),10);
  await page.locator('#speed').selectOption('1.5');assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),1.5);
  await page.locator('#settings-panel .close-panel').click();
  await page.locator('#mute').click();await page.waitForFunction(()=>document.querySelector('#mute').getAttribute('aria-label')==='Unmute');assert.equal(await page.locator('#mute').getAttribute('aria-label'),'Unmute');
  await page.locator('#playlist').click();assert.equal(await page.locator('#playlist-panel').isVisible(),true);
  await page.locator('#playlist-panel .close-panel').click();
  if(process.env.SCREENSHOT_DIR){await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/player-mobile.png`});await page.setViewportSize({width:1568,height:706});await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/player-landscape.png`});}
  // Exercise orientation fallback separately from device-specific fullscreen permissions.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    let active=null;Object.defineProperty(document,'fullscreenElement',{get:()=>active,configurable:true});
    document.querySelector('#player').requestFullscreen=async()=>{active=document.querySelector('#player');document.dispatchEvent(new Event('fullscreenchange'));};
    document.exitFullscreen=async()=>{active=null;document.dispatchEvent(new Event('fullscreenchange'));};
    screen.orientation.lock=async()=>{throw new Error('Unsupported');};
  });
  await page.locator('#fullscreen').click();assert.equal(await page.locator('#player').evaluate(el=>el.classList.contains('landscape-fallback')),true);
  await page.locator('#fullscreen').click();assert.equal(await page.locator('#player').evaluate(el=>el.classList.contains('landscape-fallback')),false);
  assert.deepEqual(errors,[]);console.log('PASS: click-to-load, lowest quality, play/pause, seek/skip, settings, mute, video list and rotated fullscreen fallback');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
