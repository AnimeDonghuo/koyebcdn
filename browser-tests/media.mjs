import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {generateMedia} from './generate-media.mjs';
import {byteRange} from '../mtproto.js';

const directory=generateMedia();
let subtitleRequests=0,failSubtitle=true;
const html=`<!doctype html><meta charset="utf-8"><video id="video" width="480" height="270" preload="none"></video><button id="play">Play</button><select id="subtitles"></select><input id="file" type="file"><button id="add">Add</button><button id="remove">Remove</button><button id="retry">Retry</button><p id="substatus"></p><select id="audio"></select><p id="audio-status"></p><script type="module">
import {setupSubtitles} from '/subtitle-controller.js';import {setupAudio} from '/audio-controller.js';
const v=document.querySelector('video'),$=id=>document.getElementById(id);
window.subs=setupSubtitles(v,{select:$('subtitles'),fileInput:$('file'),fileButton:$('add'),removeButton:$('remove'),retryButton:$('retry'),status:$('substatus')});
window.audio=setupAudio(v,{select:$('audio'),status:$('audio-status')});
subs.setExternal([{label:'English',language:'en',url:'/english.vtt'},{label:'Hindi',language:'hi',url:'/hindi.srt'},{label:'Unavailable',language:'en',url:'/retry.vtt'},{label:'Slow',language:'en',url:'/slow.vtt'},{label:'Extensionless',language:'en',url:'/subtitle-download'}]);
window.sourceChanges=0;window.loadSource=()=>{subs.sourceChanging();audio.sourceChanging();v.src='/dual-audio.mp4?v='+ ++window.sourceChanges;v.load();};
$('play').onclick=async()=>{loadSource();window.context=new AudioContext();window.analyser=context.createAnalyser();analyser.fftSize=2048;context.createMediaElementSource(v).connect(analyser);analyser.connect(context.destination);await context.resume();await v.play();};
window.frequency=()=>{const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(data);let peak=0;for(let i=1;i<data.length;i++)if(data[i]>data[peak])peak=i;return peak*context.sampleRate/analyser.fftSize;};
window.ready=true;</script>`;
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
  if(['subtitle-controller.js','subtitle-utils.js','subtitle-worker.js','audio-controller.js'].includes(path.slice(1))){res.setHeader('Content-Type','text/javascript');return res.end(readFileSync(`public/${path.slice(1)}`));}
  if(path.endsWith('.vtt')||path.endsWith('.srt')||path==='/subtitle-download'){
    subtitleRequests++;
    if(path==='/retry.vtt'&&failSubtitle){res.statusCode=503;return res.end('not available');}
    res.setHeader('Content-Type',path.endsWith('vtt')?'text/vtt':'text/plain; charset=utf-8');
    if(path==='/slow.vtt')return setTimeout(()=>{if(!res.destroyed)res.end(readFileSync(`${directory}/english.vtt`));},400);
    return res.end(readFileSync(`${directory}/${path==='/hindi.srt'?'hindi.srt':'english.vtt'}`));
  }
  if(path==='/dual-audio.mp4'){
    const file=readFileSync(`${directory}/dual-audio.mp4`),range=byteRange(req.headers.range,file.length);
    res.statusCode=range.partial?206:200;res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Type','video/mp4');
    if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${file.length}`);
    res.setHeader('Content-Length',range.end-range.start+1);return res.end(file.subarray(range.start,range.end+1));
  }
  res.statusCode=404;res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  const launch={headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']};
  // Chromium normally hides AudioTrackList; explicitly enable it to test real
  // switching where the API exists. This is NOT enabled by the production page.
  browser=await chromium.launch({...launch,args:[...launch.args,'--enable-blink-features=AudioVideoTracks']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready);
  assert.equal(subtitleRequests,0,'external subtitle files load only on selection');
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2&&document.querySelector('#audio').options.length===2);
  assert.match(await page.locator('#audio').textContent(),/English/);assert.match(await page.locator('#audio').textContent(),/Hindi/);
  await page.waitForFunction(()=>Math.abs(window.frequency()-440)<30);
  await page.locator('video').evaluate(v=>v.pause());
  const position=await page.locator('video').evaluate(v=>v.currentTime),src=await page.locator('video').getAttribute('src');
  const hindiAudio=await page.locator('#audio').evaluate(s=>Array.from(s.options).find(o=>o.textContent.includes('Hindi')).value);
  await page.locator('#audio').selectOption(hindiAudio);
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),position);
  assert.equal(await page.locator('video').getAttribute('src'),src);
  await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>Math.abs(window.frequency()-880)<30);
  console.log('PASS: real MP4 audio changes from 440 Hz (English) to 880 Hz (Hindi), without source reload');
  await page.locator('video').evaluate(v=>{v.pause();v.currentTime=2;});
  const selectLabel=async label=>{const value=await page.locator('#subtitles').evaluate((s,label)=>Array.from(s.options).find(o=>o.textContent.startsWith(label)).value,label);await page.locator('#subtitles').selectOption(value);};
  const activeText=()=>page.locator('video').evaluate(v=>Array.from(v.textTracks).filter(t=>t.mode==='showing').flatMap(t=>Array.from(t.activeCues||[]).map(c=>c.text)).join('\n'));
  await selectLabel('English');await page.waitForFunction(()=>document.querySelector('#substatus').textContent.includes('cues loaded'));
  await page.waitForFunction(()=>Array.from(document.querySelector('video').textTracks).some(t=>t.mode==='showing'&&t.activeCues?.length));
  assert.equal(await activeText(),'English subtitle test');
  await selectLabel('Hindi');await page.waitForFunction(()=>document.querySelector('#substatus').textContent.startsWith('Hindi:'));
  assert.equal(await activeText(),'हिन्दी उपशीर्षक परीक्षण');
  assert.equal(await page.locator('video').getAttribute('crossorigin'),null,'external subtitles must not force CORS onto the video');
  await selectLabel('Extensionless');await page.waitForFunction(()=>document.querySelector('#substatus').textContent.startsWith('Extensionless:'));assert.equal(await activeText(),'English subtitle test');
  await selectLabel('Hindi');await page.waitForFunction(()=>document.querySelector('#substatus').textContent.startsWith('Hindi:'));
  // Transient mode resets must not turn the user's selection into Off.
  const selected=await page.locator('#subtitles').inputValue();
  await page.locator('video').evaluate(v=>{for(const t of v.textTracks)t.mode='disabled';});
  await page.evaluate(()=>subs.refresh());assert.equal(await page.locator('#subtitles').inputValue(),selected);
  // Real source reload clears/rebuilds media track lists; restore language/choice.
  await page.evaluate(()=>loadSource());await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await page.locator('video').evaluate(v=>v.currentTime=2);
  assert.equal(await page.locator('#subtitles').inputValue(),selected);
  await page.waitForFunction(()=>Array.from(document.querySelector('video').textTracks).some(t=>t.mode==='showing'&&t.activeCues?.length));
  assert.equal(await activeText(),'हिन्दी उपशीर्षक परीक्षण');
  assert.equal(await page.locator('video').evaluate(v=>Array.from(v.audioTracks).find(t=>t.enabled).language),'hin');
  await page.locator('#subtitles').selectOption('-1');assert.equal(await activeText(),'');
  await selectLabel('Unavailable');await page.waitForFunction(()=>!document.querySelector('#retry').hidden);assert.match(await page.locator('#substatus').textContent(),/503/);
  failSubtitle=false;await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#substatus').textContent.startsWith('Unavailable:'));assert.equal(await activeText(),'English subtitle test');
  await selectLabel('Slow');await page.locator('#subtitles').selectOption('-1');
  await page.waitForFunction(()=>document.querySelector('#substatus').textContent.startsWith('Subtitles are off'));
  // A later successful file read must never overwrite Off after cancellation.
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,500)));assert.equal(await activeText(),'');
  const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('1\n00:00:00,000 --> 00:00:08,000\nLocal Hindi हिन्दी\n','utf16le')]);
  await page.locator('#file').setInputFiles({name:'local.srt',mimeType:'text/plain',buffer:utf16});await page.waitForFunction(()=>document.querySelector('#substatus').textContent.includes('Nothing uploaded'));
  assert.equal(await activeText(),'Local Hindi हिन्दी');
  await page.locator('#subtitles').selectOption('-1');await page.locator('#subtitles').selectOption('local');assert.equal(await activeText(),'Local Hindi हिन्दी');
  await page.locator('#remove').click();assert.equal(await activeText(),'');
  if(process.env.SCREENSHOT_DIR){await selectLabel('Hindi');await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/subtitle-render.png`});}
  assert.deepEqual(errors,[]);console.log('PASS: real subtitle cues, English/Hindi selection, source reload, Off, HTTP error/retry, cancel and UTF-16 local file');
  await browser.close();browser=await chromium.launch(launch);
  const unsupported=await browser.newPage();await unsupported.goto(`http://127.0.0.1:${server.address().port}/`);await unsupported.waitForFunction(()=>window.ready);await unsupported.locator('#play').click();await unsupported.waitForFunction(()=>document.querySelector('video').readyState>=2);
  if(!await unsupported.locator('video').evaluate(v=>!!v.audioTracks)){
    assert.equal(await unsupported.locator('#audio').isDisabled(),true);assert.match(await unsupported.locator('#audio-status').textContent(),/does not provide/);
    console.log('PASS: default Chromium exposes no AudioTrackList; selector explains the limitation instead of pretending to switch');
  }
  // Exposed but read-only tracks must not pretend that a language switch worked.
  await unsupported.locator('video').evaluate(v=>{
    const list=new EventTarget();list.length=2;
    for(const [i,language] of ['eng','hin'].entries()){
      const track={label:language,language,kind:'main'};Object.defineProperty(track,'enabled',{get:()=>i===0});list[i]=track;
    }
    Object.defineProperty(v,'audioTracks',{value:list,configurable:true});window.audio.refresh();
  });
  const failedValue=await unsupported.locator('#audio').evaluate(s=>s.options[1].value);
  await unsupported.locator('#audio').selectOption(failedValue);
  assert.equal(await unsupported.locator('#audio').isDisabled(),true);
  assert.match(await unsupported.locator('#audio-status').textContent(),/could not switch/);
  console.log('PASS: rejected audio switching is reported and disabled');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
