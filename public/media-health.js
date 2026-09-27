// Client-only diagnostics: never scan or transcode a file. A failed same-origin
// stream gets at most one bounded HEAD check per source load (no media bytes).
export function mediaFailureMessage(code,status=0){
  if(status===401||status===403)return 'The server denied this video request. Reload the watch page on the allowed website.';
  if(status===404)return 'This video is missing or is no longer accessible to the Telegram bot.';
  if(status===429||status===503)return 'The video server is busy or temporarily unavailable. Wait a moment, then try again.';
  if(status>=500)return 'The server could not read this video from Telegram. Try again shortly.';
  if(status===416)return 'The server could not read the requested part of this video. Reload the page and try again.';
  if(code===2)return 'The video download was interrupted. Check your connection and try again.';
  if(code===3||code===4||status===415)return 'This browser cannot decode this video format, or the file is damaged. Try another quality/version. MP4 with H.264 video and AAC audio is widely supported; renaming a file to .mp4 does not convert it.';
  return 'This video could not be played. Try again or choose another quality/version.';
}
export function setupMediaHealth(video,{onFailure,fetcher=fetch}){
  let generation=0,probe,reported,failed=false,progressSeconds=0,lastTime=null,frameHandle,sawFrame=false;
  function watchFrame(){if(frameHandle!==undefined)video.cancelVideoFrameCallback?.(frameHandle);frameHandle=video.requestVideoFrameCallback?.(()=>{sawFrame=true;frameHandle=undefined;});}
  function reset(){generation++;probe?.abort();probe=null;reported=null;failed=false;progressSeconds=0;lastTime=null;sawFrame=false;watchFrame();}
  async function report(error){
    if(error?.name==='AbortError')return;
    if(reported)return reported;
    const token=generation,code=video.error?.code||(error?.name==='NotSupportedError'?4:0);
    failed=true;video.pause();
    // Show a useful message immediately, then refine it if the server reports a
    // concrete HTTP error. Cross-origin provider URLs are never probed.
    onFailure(mediaFailureMessage(code));
    reported=(async()=>{
      let status=0,timer;
      try{
        const url=new URL(video.currentSrc||video.src,location.href);
        if(url.origin===location.origin&&[2,4].includes(code)){
          const controller=new AbortController();probe=controller;timer=setTimeout(()=>controller.abort(),4000);
          const res=await fetcher(url.href,{method:'HEAD',credentials:'same-origin',cache:'no-store',signal:controller.signal});status=res.status;
        }
      }catch{/* A failed diagnostic request must not hide the original error. */}
      finally{clearTimeout(timer);}
      if(token===generation)onFailure(mediaFailureMessage(code,status));
    })();
    return reported;
  }
  video.addEventListener('error',()=>{if(video.error?.code!==1)void report();});
  video.addEventListener('timeupdate',()=>{
    const now=video.currentTime,delta=lastTime===null?0:now-lastTime;lastTime=now;
    if(failed||video.paused||video.seeking||video.readyState<2)return;
    const hasDimensions=video.videoWidth>0&&video.videoHeight>0;
    if(sawFrame||(hasDimensions&&(!video.requestVideoFrameCallback||video.getVideoPlaybackQuality?.().totalVideoFrames>0))){progressSeconds=0;return;}
    if(typeof document!=='undefined'&&document.visibilityState!=='visible'){progressSeconds=0;return;}
    // Count actual small playback advances, not seeking or time spent buffering.
    if(delta>0&&delta<1.5)progressSeconds+=delta;
    if(progressSeconds>=(hasDimensions?8:3)){
      failed=true;video.pause();
      onFailure('Playback is advancing but the browser has no video picture. The file may be audio-only or use an unsupported video codec. Try another quality/version, or open the original in a compatible player such as VLC.');
    }
  });
  video.addEventListener('seeking',()=>{lastTime=null;progressSeconds=0;});
  video.addEventListener('emptied',()=>{lastTime=null;progressSeconds=0;});
  return {reset,report,get failed(){return failed;}};
}
