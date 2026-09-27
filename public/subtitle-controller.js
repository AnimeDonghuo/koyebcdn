import {MAX_SUBTITLE_BYTES} from './subtitle-utils.js';

// Keep the user's choice separate from transient TextTrack.mode changes. Loading
// and quality switches can temporarily disable a track without the user choosing Off.
export function setupSubtitles(video,{select,fileInput,fileButton,removeButton,retryButton,status}){
  let selected='-1',preferredNative=null,sourceChanging=false,metadataSeen=false,nextId=0;
  let localTrack=null,externalTrack=null,localCues=null,localName='',displayedExternal=null,task=null;
  const nativeKeys=new WeakMap(),managed=new Set(),external=new Map();
  const isText=track=>['subtitles','captions'].includes(track.kind);
  const tracks=()=>Array.from(video.textTracks).filter(isText);
  const nativeKey=track=>{if(!nativeKeys.has(track))nativeKeys.set(track,`native-${++nextId}`);return nativeKeys.get(track);};
  function nativeEntries(){return tracks().filter(t=>!managed.has(t)).map(track=>({key:nativeKey(track),track,label:track.label||track.language||'Embedded subtitles'}));}
  function clearTrack(track){if(!track)return;track.mode='hidden';for(const cue of Array.from(track.cues||[]))track.removeCue(cue);track.mode='disabled';}
  function fillTrack(track,cues){clearTrack(track);track.mode='hidden';for(const cue of cues)track.addCue(new VTTCue(cue.start,cue.end,cue.text));}
  function getManaged(kind){
    let track=kind==='local'?localTrack:externalTrack;
    if(!track||!tracks().includes(track)){
      track=video.addTextTrack('subtitles',kind==='local'?'Local subtitles':'External subtitles','');managed.add(track);
      if(kind==='local'){localTrack=track;if(localCues)fillTrack(track,localCues);}
      else{externalTrack=track;displayedExternal=null;}
    }
    return track;
  }
  function selectedTrack(){
    if(selected==='local'&&localCues)return getManaged('local');
    const entry=external.get(selected);
    if(entry?.cues){
      const track=getManaged('external');
      if(displayedExternal!==selected){fillTrack(track,entry.cues);displayedExternal=selected;}
      return track;
    }
    return nativeEntries().find(entry=>entry.key===selected)?.track;
  }
  function apply(){
    if(sourceChanging)return;
    const desired=selectedTrack();for(const track of tracks())track.mode=track===desired?'showing':'disabled';
  }
  function rebuild(){
    const live=tracks();
    for(const track of managed)if(!live.includes(track)){
      managed.delete(track);if(localTrack===track)localTrack=null;
      if(externalTrack===track){externalTrack=null;displayedExternal=null;}
    }
    const native=nativeEntries();
    if(preferredNative&&!native.some(entry=>entry.key===selected)){
      const match=native.find(({track})=>track.label===preferredNative.label&&track.language===preferredNative.language)
        ||(preferredNative.language?native.find(({track})=>track.language===preferredNative.language):null);
      if(match)selected=match.key;
    }
    const options=[new Option('Off','-1')];
    for(const entry of external.values())options.push(new Option(`${entry.label} · External${entry.error?' (retry)':''}`,entry.key));
    if(localCues)options.push(new Option(`${localName} · Your file`,'local'));
    for(const entry of native)options.push(new Option(`${entry.label} · Embedded / browser`,entry.key));
    options.push(new Option('Other… Add subtitle file','file'));
    select.replaceChildren(...options);select.disabled=false;
    // A native track may temporarily disappear during a quality change.
    if(!options.some(option=>option.value===selected)&&selected!=='-1')select.add(new Option('Restoring selected subtitles…',selected));
    select.value=selected;removeButton.hidden=!localCues;
    retryButton.hidden=!external.get(selected)?.error;
    apply();
  }
  function message(){
    if(task)return;
    const entry=external.get(selected);
    if(entry?.error){status.textContent=entry.error;return;}
    if(selected==='local'&&localCues){status.textContent=`${localName}: ${localCues.length} cues loaded. Nothing uploaded.`;return;}
    if(entry?.cues){status.textContent=`${entry.label}: ${entry.cues.length} cues loaded.`;return;}
    const native=nativeEntries();
    if(selected.startsWith('native-')){status.textContent=native.some(e=>e.key===selected)?'Embedded subtitle track selected.':'This quality does not expose your selected subtitle track. Choose another track or add a file.';return;}
    status.textContent=!metadataSeen?'Press Play to discover embedded subtitles, or add a subtitle file now.':!native.length&&!external.size?'No embedded subtitle tracks are exposed by this browser. Add your own file; MKV/ASS/PGS may require extraction outside Koyeb.':'Subtitles are off. Choose a language or add your own file.';
  }
  function cancel(){task?.controller.abort();task=null;}
  function parse(buffer,name,signal){
    return new Promise((resolve,reject)=>{
      if(signal.aborted)return reject(new DOMException('Cancelled','AbortError'));
      const worker=new Worker('/subtitle-worker.js',{type:'module'});
      const finish=(error,cues)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(cues);};
      const abort=()=>finish(new DOMException('Cancelled','AbortError'));
      const timer=setTimeout(()=>finish(new Error('Subtitle parsing took too long. Try a smaller file.')),10000);
      signal.addEventListener('abort',abort,{once:true});
      worker.onerror=()=>finish(new Error('The subtitle reader could not start. Reload the player and try again.'));
      worker.onmessage=event=>finish(event.data.error?new Error(event.data.error):null,event.data.cues);
      worker.postMessage({buffer,name},[buffer]);
    });
  }
  async function readRemote(entry,signal){
    const response=await fetch(entry.url,{credentials:'same-origin',signal});
    if(!response.ok)throw new Error(`Subtitle server returned HTTP ${response.status}.`);
    if(Number(response.headers.get('content-length'))>MAX_SUBTITLE_BYTES){await response.body?.cancel();throw new Error('Subtitle file exceeds 2 MB.');}
    if(!response.body)throw new Error('Subtitle response is empty.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{
      for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_SUBTITLE_BYTES)throw new Error('Subtitle file exceeds 2 MB.');chunks.push(value);}
    }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const path=new URL(entry.url,location.href).pathname;
    const name=/\.(vtt|srt|ass|ssa)$/i.test(path)?path:null;
    return parse(bytes.buffer,name,signal);
  }
  async function selectEntry(key,force=false){
    cancel();selected=key;preferredNative=null;
    const native=nativeEntries().find(entry=>entry.key===key);
    if(native)preferredNative={label:native.track.label,language:native.track.language};
    const entry=external.get(key);
    if(!entry||entry.cues&&!force){rebuild();message();return;}
    if(force){entry.cues=null;displayedExternal=null;}
    entry.error=null;const operation={kind:'external',controller:new AbortController()};task=operation;
    rebuild();status.textContent=`Loading ${entry.label}…`;
    const timeout=setTimeout(()=>operation.controller.abort(new Error('Subtitle request timed out.')),15000);
    try{
      const cues=await readRemote(entry,operation.controller.signal);
      if(task!==operation)return;
      if(typeof VTTCue!=='function')throw new Error('This browser cannot render text subtitles.');
      entry.cues=cues;
      // Bound parsed subtitle memory: retain only the last two external files.
      const cached=[...external.values()].filter(e=>e.cues&&e!==entry);while(cached.length>1)cached.shift().cues=null;
    }catch(error){
      if(task!==operation)return;
      entry.error=`Cannot load ${entry.label}: ${error.name==='TypeError'?'check the subtitle URL and its CORS settings.':error.message||'request failed.'} Use Retry or add a local file.`;
    }finally{
      clearTimeout(timeout);if(task===operation){task=null;rebuild();message();}
    }
  }
  select.onchange=()=>{if(select.value==='file'){select.value=selected;fileInput.click();}else selectEntry(select.value);};
  retryButton.onclick=()=>selectEntry(selected,true);
  fileButton.onclick=()=>fileInput.click();
  removeButton.onclick=()=>{
    if(task?.kind==='local')cancel();clearTrack(localTrack);localCues=null;localName='';
    if(selected==='local')selected='-1';rebuild();status.textContent='Local subtitles removed.';
  };
  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];fileInput.value='';if(!file)return;
    cancel();const operation={kind:'local',controller:new AbortController()};task=operation;
    try{
      if(file.size>MAX_SUBTITLE_BYTES)throw new Error('Choose a subtitle file of 2 MB or smaller.');
      status.textContent='Reading subtitles on your device…';
      const buffer=await file.arrayBuffer();if(task!==operation)return;
      const cues=await parse(buffer,file.name,operation.controller.signal);if(task!==operation)return;
      if(typeof VTTCue!=='function')throw new Error('This browser cannot render text subtitles.');
      const existing=localTrack&&tracks().includes(localTrack);
      localCues=cues;localName=file.name;const track=getManaged('local');if(existing)fillTrack(track,cues);selected='local';preferredNative=null;task=null;
      rebuild();message();
    }catch(error){if(task===operation){task=null;status.textContent=error.message||'Could not read the subtitle file.';}}
  };
  video.textTracks.addEventListener('addtrack',rebuild);
  video.textTracks.addEventListener('removetrack',rebuild);
  video.textTracks.addEventListener('change',()=>{
    if(sourceChanging||task)return;
    const showing=tracks().find(t=>t.mode==='showing'),desired=selectedTrack();
    // A transient all-disabled event must not erase the user's selection. Only
    // adopt a different showing track, or Off from native iOS fullscreen UI.
    if(showing&&showing!==desired){
      if(showing===localTrack)selected='local';
      else if(showing===externalTrack&&displayedExternal)selected=displayedExternal;
      else{selected=nativeKey(showing);preferredNative={label:showing.label,language:showing.language};}
      rebuild();message();
    }else if(!showing&&video.webkitDisplayingFullscreen){selected='-1';preferredNative=null;rebuild();message();}
  });
  video.addEventListener('loadedmetadata',()=>{metadataSeen=true;sourceChanging=false;rebuild();message();});
  window.addEventListener('pagehide',cancel);
  rebuild();message();
  return {
    sourceChanging(){sourceChanging=true;},
    setExternal(subtitles){
      if(task?.kind==='external')cancel();
      const old=new Map(external);external.clear();
      for(const sub of subtitles){const key=`external:${sub.language}:${sub.url}`;external.set(key,old.get(key)||{key,label:sub.label,language:sub.language,url:sub.url,cues:null,error:null});}
      if(selected.startsWith('external:')&&!external.has(selected)){selected='-1';clearTrack(externalTrack);displayedExternal=null;}
      rebuild();message();
    },
    refresh(){rebuild();message();},
  };
}
