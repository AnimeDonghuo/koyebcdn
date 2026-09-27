import test from 'node:test';
import assert from 'node:assert/strict';
import {setupMediaHealth,mediaFailureMessage} from '../public/media-health.js';
class Video extends EventTarget{
  paused=false;seeking=false;readyState=2;videoWidth=0;videoHeight=0;currentTime=0;error=null;src='https://player.example/media/test/480';
  pause(){this.paused=true;}
  tick(seconds=.25){this.currentTime+=seconds;this.dispatchEvent(new Event('timeupdate'));}
}
test('HTTP errors are distinguished from codec/decode errors',()=>{
  assert.match(mediaFailureMessage(4,503),/busy/);assert.match(mediaFailureMessage(4,403),/denied/);assert.match(mediaFailureMessage(4,404),/missing/);assert.match(mediaFailureMessage(4,502),/Telegram/);assert.match(mediaFailureMessage(4,200),/H.264/);assert.match(mediaFailureMessage(2),/interrupted/);
});
test('audio-only playback pauses; real picture, seeking and buffering do not trigger false warnings',()=>{
  const video=new Video(),messages=[],health=setupMediaHealth(video,{onFailure:m=>messages.push(m)});
  for(let i=0;i<15;i++)video.tick();assert.equal(video.paused,true);assert.match(messages[0],/no video picture/);
  health.reset();messages.length=0;video.paused=false;video.videoWidth=320;video.videoHeight=180;
  for(let i=0;i<30;i++)video.tick();assert.equal(messages.length,0);
  health.reset();video.videoWidth=video.videoHeight=0;video.seeking=true;video.tick(60);video.seeking=false;video.readyState=1;
  for(let i=0;i<30;i++)video.tick();assert.equal(messages.length,0);
});
test('one HEAD per failed source; reset suppresses stale results; external streams are not probed',async()=>{
  const previous=globalThis.location;globalThis.location={href:'https://player.example/watch/test',origin:'https://player.example'};
  try{
    const video=new Video(),messages=[];let probes=0,finish;
    const health=setupMediaHealth(video,{onFailure:m=>messages.push(m),fetcher:(url,options)=>{probes++;assert.equal(options.method,'HEAD');return new Promise(r=>finish=r);}});
    const first=health.report({name:'NotSupportedError'}),second=health.report({name:'NotSupportedError'});assert.equal(probes,1);
    health.reset();messages.length=0;finish({status:503});await Promise.all([first,second]);assert.equal(messages.length,0);
    video.src='https://provider.example/file.mp4';await health.report({name:'NotSupportedError'});assert.equal(probes,1);assert.match(messages.at(-1),/H.264/);
  }finally{globalThis.location=previous;}
});
test('dimensions without any delivered frames get a longer grace period; decoded black intros are allowed',()=>{
  const video=new Video(),messages=[];let frame;
  video.videoWidth=320;video.videoHeight=180;video.requestVideoFrameCallback=cb=>{frame=cb;return 1;};video.cancelVideoFrameCallback=()=>{};
  const health=setupMediaHealth(video,{onFailure:m=>messages.push(m)});health.reset();
  for(let i=0;i<20;i++)video.tick();assert.equal(messages.length,0);
  frame();for(let i=0;i<20;i++)video.tick();assert.equal(messages.length,0);
  health.reset();for(let i=0;i<35;i++)video.tick();assert.equal(messages.length,1);assert.equal(video.paused,true);
});
