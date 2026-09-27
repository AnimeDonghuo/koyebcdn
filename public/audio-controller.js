// Browser-native audio selection only: no second decoder, downloads or transcoding.
export function setupAudio(video,{select,status}){
  let list=null,preferred=null,changing=false,metadataSeen=false,applying=false,switchRejected=false,nextId=0;
  const ids=new WeakMap();
  const key=track=>{if(!ids.has(track))ids.set(track,`audio-${++nextId}`);return ids.get(track);};
  const tracks=()=>list?Array.from(list):[];
  function label(track,index){
    let language=track.language||'';
    try{if(language&&language!=='und')language=new Intl.DisplayNames(['en'],{type:'language'}).of(language);}catch{}
    return [track.label,language&&language!=='und'?language:null].filter((part,i,all)=>part&&all.indexOf(part)===i).join(' — ')||`Audio ${index+1}`;
  }
  function enabled(){return tracks().find(track=>track.enabled);}
  function switchTrack(track){
    const all=tracks(),previous=all.map(t=>!!t.enabled);applying=true;
    try{
      track.enabled=true;
      for(const other of all)if(other!==track)other.enabled=false;
      if(!track.enabled||all.some(t=>t!==track&&t.enabled))throw new Error('Track switch rejected');
      return true;
    }catch{
      for(const [i,t] of all.entries())try{t.enabled=previous[i];}catch{}
      switchRejected=true;select.disabled=true;
      status.textContent='The browser exposed these tracks but could not switch them. Use a compatible browser or a separately prepared audio-language version.';
      return false;
    }finally{applying=false;}
  }
  function preferredTrack(all){
    if(!preferred)return null;
    return all.find(t=>t.language===preferred.language&&t.label===preferred.label&&t.kind===preferred.kind)
      ||(preferred.language?all.find(t=>t.language===preferred.language&&t.kind===preferred.kind):null)
      ||(preferred.language?all.find(t=>t.language===preferred.language):null);
  }
  function rebuild(restore=false){
    let current;try{current=video.audioTracks||null;}catch{current=null;}
    if(current!==list){
      for(const event of ['addtrack','removetrack','change'])list?.removeEventListener?.(event,handle);
      list=current;
      for(const event of ['addtrack','removetrack','change'])list?.addEventListener?.(event,handle);
    }
    const all=tracks();
    if(!metadataSeen||changing){select.replaceChildren(new Option('Available after Play',''));select.disabled=true;status.textContent='Audio languages are discovered when the video loads.';return;}
    if(!list||!all.length){
      select.replaceChildren(new Option('Default audio',''));select.disabled=true;
      status.textContent=!list?'This browser does not provide embedded audio switching. The default audio will play; use a compatible browser or a separate language version.':'No selectable audio tracks are exposed for this file. The browser will use its default audio.';
      return;
    }
    const wanted=restore?preferredTrack(all):null;
    const switched=!wanted||switchTrack(wanted);
    select.replaceChildren(...all.map((track,i)=>new Option(label(track,i),key(track))));
    select.value=enabled()?key(enabled()):'';select.disabled=all.length<2||switchRejected;
    if(!switched||switchRejected)return;
    if(restore&&preferred&&!wanted)status.textContent='Your previous audio language is not exposed in this quality. The browser’s default is selected.';
    else status.textContent=all.length>1?`${all.length} audio tracks available. Switching keeps your playback position.`:'Only one audio track is exposed by this browser for this source.';
  }
  function handle(event){
    if(applying)return;
    // Adopt a native audio choice, but keep our preference through source reloads.
    if(event.type==='change'&&!changing&&(!preferred||video.webkitDisplayingFullscreen)){const track=enabled();if(track)preferred={language:track.language,label:track.label,kind:track.kind};}
    rebuild(event.type!=='change');
  }
  select.onchange=()=>{
    const track=tracks().find(t=>key(t)===select.value);if(!track)return;
    if(switchTrack(track)){
      preferred={language:track.language,label:track.label,kind:track.kind};
      status.textContent=`Audio selected: ${label(track,tracks().indexOf(track))}.`;
    }
    select.value=enabled()?key(enabled()):'';
  };
  video.addEventListener('loadedmetadata',()=>{metadataSeen=true;changing=false;rebuild(true);});
  video.addEventListener('loadeddata',()=>rebuild(true));
  rebuild();
  return {sourceChanging(){changing=true;switchRejected=false;rebuild();},refresh:()=>rebuild(true)};
}
