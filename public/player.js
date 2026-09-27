const $=id=>document.getElementById(id),video=$('video'),player=$('player');
const params=new URLSearchParams(location.search);
let postUrl=params.get('url');
if(!postUrl&&/^\/(?:watch\/)?https(?::|%3a)/i.test(location.pathname)){
  const raw=location.pathname.startsWith('/watch/')?location.pathname.slice(7):location.pathname.slice(1);
  try{postUrl=decodeURIComponent(raw);}catch{postUrl=raw;}
}
const id=postUrl?null:location.pathname.split('/')[2]||params.get('id');
let sources=[],selected=0,subtitle=-1,loadPromise,loaded=false,idleTimer,generation=0,landscapeRequested=false;
const time=n=>{if(!Number.isFinite(n))return '0:00';const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=Math.floor(n%60);return `${h?h+':':''}${h?String(m).padStart(2,'0'):m}:${String(s).padStart(2,'0')}`;};
function title(text){$('title').textContent=text;$('playlist-title').textContent=text;document.title=text;}
title((params.get('title')||'Telegram video').slice(0,250));
$('channel-label').textContent=(params.get('label')||'PLAYER').slice(0,40);
function imageURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const avatar=imageURL(params.get('avatar')),poster=imageURL(params.get('poster'));
if(avatar){$('avatar-image').src=avatar;$('avatar-image').hidden=false;$('avatar-image').onerror=()=>{$('avatar-image').hidden=true;};}
if(poster)video.poster=poster;
// A next post is explicit; never scan the DB channel or guess a related episode.
let nextURL;
if(/^https:\/\/t\.me\/c\/[1-9]\d*\/[1-9]\d*$/.test(params.get('next')||'')){
  nextURL=new URL('/watch',location.origin);nextURL.searchParams.set('url',params.get('next'));
  $('next').setAttribute('aria-label','Next video');$('next').title='Next video';$('next-video').hidden=false;
}
function notice(text,retry=false){$('notice').hidden=!text;$('status').textContent=text;$('retry').hidden=!retry;}
function busy(value){player.classList.toggle('busy',value);$('loading').hidden=!value;}
function panelsOpen(){return !$('settings-panel').hidden||!$('playlist-panel').hidden;}
function wake(){player.classList.remove('idle');clearTimeout(idleTimer);if(!video.paused&&!panelsOpen())idleTimer=setTimeout(()=>{if(!video.paused&&!panelsOpen())player.classList.add('idle');},3000);}
function closePanels(){for(const kind of ['settings','playlist']){$(`${kind}-panel`).hidden=true;$(kind).setAttribute('aria-expanded','false');}wake();}
function panel(kind){const open=$(`${kind}-panel`).hidden;closePanels();$(`${kind}-panel`).hidden=!open;$(kind).setAttribute('aria-expanded',String(open));wake();}
$('settings').onclick=()=>panel('settings');$('playlist').onclick=()=>panel('playlist');
for(const button of document.querySelectorAll('.close-panel'))button.onclick=closePanels;
$('captions').onclick=()=>{closePanels();panel('settings');$('subtitles').focus();};
for(const event of ['pointermove','keydown','focusin'])player.addEventListener(event,wake);
function applySubtitle(){Array.from(video.textTracks).forEach((track,i)=>track.mode=i===subtitle?'showing':'disabled');$('captions').style.opacity=subtitle<0?'1':'.7';}
$('subtitles').onchange=()=>{subtitle=Number($('subtitles').value);applySubtitle();};
function choose(index,position=0){
  const token=++generation,rate=Number($('speed').value);selected=index;
  video.src=sources[index].url;
  video.addEventListener('loadedmetadata',()=>{if(token!==generation)return;if(position&&Number.isFinite(video.duration))video.currentTime=Math.min(position,video.duration);video.playbackRate=rate;applySubtitle();},{once:true});
  video.load();
}
async function load(){
  if(loaded)return;
  if(loadPromise)return loadPromise;
  loadPromise=(async()=>{
    if(!id&&!postUrl)throw new Error('Add a Telegram post link after this Koyeb URL to load a video.');
    const res=await fetch(postUrl?`/api/telegram?url=${encodeURIComponent(postUrl)}`:`/api/videos/${encodeURIComponent(id)}`),item=await res.json();
    if(!res.ok)throw new Error(item.error||'Unable to load video.');
    title(item.title);
    sources=item.sources.filter(s=>s.available).sort((a,b)=>a.height-b.height);
    if(!sources.length)throw new Error(item.sources[0]?.reason||'No playable video source.');
    $('quality').replaceChildren(...sources.map((s,i)=>new Option(`${s.height}p`,String(i))));$('quality').disabled=false;
    const subtitles=item.subtitles||[];
    video.querySelectorAll('track').forEach(track=>track.remove());
    $('subtitles').replaceChildren(new Option('Off','-1'));
    if(subtitles.length)video.crossOrigin='anonymous';
    subtitles.forEach((sub,i)=>{
      const track=document.createElement('track');track.kind='subtitles';track.label=sub.label;track.srclang=sub.language;track.src=sub.url;
      track.addEventListener('error',()=>notice(`Subtitle unavailable: ${sub.label}.`));video.append(track);$('subtitles').add(new Option(sub.label,String(i)));
    });
    $('subtitles').disabled=!subtitles.length;
    if(!subtitles.length)$('subtitles').options[0].textContent='Not available';
    choose(0);loaded=true;
  })().finally(()=>{loadPromise=null;});
  return loadPromise;
}
let starting=false;
async function play(){
  if(starting)return;
  starting=true;notice('');busy(true);
  try{
    // The only bootstrap entry point: zero metadata/Telegram/media requests on page load.
    await load();
    await video.play();
  }catch(e){notice(e.name==='NotAllowedError'?'Press Play again to start playback with sound.':e.message||'Unable to play this video.',true);}
  finally{starting=false;busy(false);wake();}
}
function toggle(){if(video.paused)play();else video.pause();}
$('center-play').onclick=toggle;
video.onclick=()=>{closePanels();if(video.paused)play();else wake();};
video.ondblclick=()=>fullscreen();
$('next').onclick=()=>{if(nextURL){location.href=nextURL.href;return;}if(Number.isFinite(video.duration))video.currentTime=Math.min(video.duration,video.currentTime+10);};
$('next-video').onclick=()=>{if(nextURL)location.href=nextURL.href;};
$('current-video').onclick=()=>{closePanels();play();};
$('retry').onclick=()=>{notice('');if(loaded)choose(selected,video.currentTime||0);play();};
$('quality').onchange=()=>{const resume=!video.paused,position=video.currentTime||0;choose(Number($('quality').value),position);if(resume)play();};
$('speed').onchange=()=>video.playbackRate=Number($('speed').value);
video.addEventListener('play',()=>{$('play-icon').setAttribute('d','M9 5h8v30H9ZM24 5h8v30h-8Z');$('center-play').setAttribute('aria-label','Pause video');wake();});
video.addEventListener('pause',()=>{$('play-icon').setAttribute('d','M10 5 34 20 10 35Z');$('center-play').setAttribute('aria-label','Play video');player.classList.remove('idle');busy(false);wake();});
video.addEventListener('playing',()=>{notice('');busy(false);wake();});
video.addEventListener('waiting',()=>{if(!video.paused)busy(true);});
video.addEventListener('error',()=>{busy(false);notice('Video unavailable. The server may be busy, or this file may use an unsupported codec. Try again shortly.',true);});
function progress(){
  const valid=Number.isFinite(video.duration)&&video.duration>0,fraction=valid?video.currentTime/video.duration:0;
  $('seek').disabled=!valid;$('seek').value=String(Math.round(fraction*1000));$('seek').style.setProperty('--progress',`${fraction*100}%`);
  let buffered=fraction;if(valid)for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=video.currentTime&&video.buffered.end(i)>=video.currentTime)buffered=video.buffered.end(i)/video.duration;
  $('seek').style.setProperty('--buffered',`${buffered*100}%`);$('seek').setAttribute('aria-valuetext',`${time(video.currentTime)} of ${time(video.duration)}`);
  $('elapsed').textContent=time(video.currentTime);$('duration').textContent=time(video.duration);
}
for(const event of ['timeupdate','durationchange','progress'])video.addEventListener(event,progress);
$('seek').oninput=()=>{if(Number.isFinite(video.duration))video.currentTime=Number($('seek').value)/1000*video.duration;progress();wake();};
$('mute').onclick=()=>video.muted=!video.muted;
$('volume').oninput=()=>{video.volume=Number($('volume').value);video.muted=video.volume===0;};
video.addEventListener('volumechange',()=>{const muted=video.muted||video.volume===0;$('volume').value=String(muted?0:video.volume);$('mute').setAttribute('aria-label',muted?'Unmute':'Mute');$('sound-waves').toggleAttribute('hidden',muted);$('sound-muted').toggleAttribute('hidden',!muted);});
video.muted=params.get('muted')==='1';
function fitLandscape(){player.classList.toggle('landscape-fallback',!!document.fullscreenElement&&landscapeRequested&&window.innerHeight>window.innerWidth);}
async function fullscreen(){
  closePanels();
  try{
    if(document.fullscreenElement){await document.exitFullscreen();return;}
    landscapeRequested=true;
    if(player.requestFullscreen){await player.requestFullscreen();try{await screen.orientation?.lock('landscape');}catch{/* CSS fallback rotates both video and controls. */}fitLandscape();}
    else if(video.webkitEnterFullscreen){video.webkitEnterFullscreen();}
    else notice('Fullscreen is unavailable. Rotate your device to landscape.');
  }catch{notice('Your browser or iframe does not permit fullscreen. Enable allowfullscreen on the iframe.');}
}
$('fullscreen').onclick=fullscreen;
$('rotate').onclick=async()=>{if(!document.fullscreenElement)await fullscreen();else{landscapeRequested=!landscapeRequested;if(landscapeRequested){try{await screen.orientation?.lock('landscape');}catch{}}else{try{screen.orientation?.unlock();}catch{}}fitLandscape();}closePanels();};
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement){landscapeRequested=false;try{screen.orientation?.unlock();}catch{}}$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Fullscreen');fitLandscape();});
window.addEventListener('resize',fitLandscape);
$('pip').hidden=!document.pictureInPictureEnabled;
$('pip').onclick=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await video.requestPictureInPicture();closePanels();}catch{notice('Start playback before opening picture-in-picture.');}};
player.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closePanels();return;}
  if(['SELECT','INPUT','BUTTON'].includes(document.activeElement.tagName)||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key===' '||e.key==='k'){e.preventDefault();toggle();}
  else if(['ArrowLeft','ArrowRight'].includes(e.key)&&Number.isFinite(video.duration)){e.preventDefault();video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(e.key==='ArrowRight'?10:-10)));}
  else if(e.key==='f')fullscreen();else if(e.key==='m')$('mute').click();
});
// Deliberately no load() or autoplay here: click-to-load is the default and only startup mode.
