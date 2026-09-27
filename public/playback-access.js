import {allowedSite} from '/player-config.js';

export function createPlaybackAccess(target,onExpired){
  let expiresAt=0,pending=null,active=false,timer;
  async function requestGrant(){
    if(window.parent===window)throw new Error(`Open this player inside ${allowedSite}. Direct-link playback is disabled.`);
    const requestId=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('Playback authorization timed out. The site must install the protected embed integration.'));},12000);
      function receive(event){
        if(event.source!==window.parent||event.origin!==allowedSite||event.data?.type!=='watch:grant-result'||event.data.requestId!==requestId)return;
        clearTimeout(timeout);window.removeEventListener('message',receive);
        if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.grant);
      }
      window.addEventListener('message',receive);
      window.parent.postMessage({type:'watch:grant-request',requestId,target},allowedSite);
    });
  }
  function schedule(delay){
    clearTimeout(timer);if(!active)return;
    timer=setTimeout(async()=>{
      try{await ensure(true);}catch(error){
        if(performance.now()>=expiresAt){active=false;onExpired(error);}
        else schedule(10000);
      }
    },delay??Math.max(1000,expiresAt-performance.now()-60000));
  }
  async function ensure(force=false){
    if(!force&&expiresAt>performance.now()+60000)return;
    if(pending)return pending;
    pending=(async()=>{
      const grant=await requestGrant();
      if(typeof grant?.token!=='string'||typeof grant.resource!=='string')throw new Error('The site returned an invalid playback grant.');
      const opened=await fetch('/api/playback/session',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Authorization:`Bearer ${grant.token}`},body:JSON.stringify({resource:grant.resource})});
      const result=await opened.json();if(!opened.ok)throw new Error(result.error||'Playback authorization failed.');
      // Detect browsers that block even partitioned third-party cookies instead
      // of silently falling back to a public/reusable media URL.
      const checked=await fetch(`/api/playback/session?resource=${encodeURIComponent(grant.resource)}`,{credentials:'include'});
      if(!checked.ok)throw new Error('This browser blocked the player session cookie. Allow partitioned cookies, or ask the site owner to use a same-site player domain.');
      if(!Number.isFinite(result.ttlSeconds)||result.ttlSeconds<120||result.ttlSeconds>900)throw new Error('Invalid playback session lifetime.');
      expiresAt=performance.now()+result.ttlSeconds*1000;schedule();
    })().finally(()=>pending=null);
    return pending;
  }
  window.addEventListener('pagehide',()=>{active=false;clearTimeout(timer);});
  return {ensure,setActive(value){active=value;schedule();}};
}
