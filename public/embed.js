/* Include on the authorized website. Secrets belong only in its backend. */
(()=>{
  const script=document.currentScript;if(!script)return;
  const playerOrigin=new URL(script.src).origin;
  const endpoint=new URL(script.dataset.tokenEndpoint||'/api/playback-token',location.origin);
  if(endpoint.origin!==location.origin)throw new Error('The playback-token endpoint must be on your own site');
  const frames=new Map();
  const sameTarget=(a,b)=>a&&b&&a.url===b.url&&a.id===b.id;
  function mount(root){
    const nodes=[...(root.matches?.('[data-watch-id], [data-telegram-url]')?[root]:[]),...(root.querySelectorAll?.('[data-watch-id], [data-telegram-url]')||[])];
    for(const node of nodes){
      const id=node.dataset.watchId,post=node.dataset.telegramUrl,key=post||id;
      if(!key||node.dataset.watchMounted===key)continue;
      if(!post&&!/^[a-zA-Z0-9_-]{1,100}$/.test(id))continue;
      const iframe=document.createElement('iframe'),url=new URL(post?'/watch':`/watch/${encodeURIComponent(id)}`,playerOrigin);
      if(post)url.searchParams.set('url',post);
      for(const key of ['title','label','avatar','poster','next'])if(node.dataset[key])url.searchParams.set(key,node.dataset[key]);
      iframe.src=url.href;iframe.title=node.dataset.title||'Video player';iframe.allow='fullscreen; picture-in-picture';iframe.allowFullscreen=true;iframe.loading='lazy';iframe.style.cssText='display:block;width:100%;height:100%;border:0;';
      node.style.aspectRatio ||= '16 / 9';node.dataset.watchMounted=key;node.replaceChildren(iframe);
      const targets=[post?{url:post}:{id}];if(node.dataset.next)targets.push({url:node.dataset.next});
      frames.set(iframe,{targets,busy:false});
    }
    for(const iframe of frames.keys())if(!iframe.isConnected)frames.delete(iframe);
  }
  window.addEventListener('message',async event=>{
    if(event.origin!==playerOrigin||event.data?.type!=='watch:grant-request'||typeof event.data.requestId!=='string')return;
    const entry=Array.from(frames.entries()).find(([iframe])=>iframe.contentWindow===event.source);
    if(!entry)return;
    const [iframe,state]=entry,request=event.data;
    const reply=data=>iframe.contentWindow?.postMessage({type:'watch:grant-result',requestId:request.requestId,...data},playerOrigin);
    if(!state.targets.some(target=>sameTarget(target,request.target)))return reply({error:'This video is not authorized by this embed.'});
    if(state.busy)return reply({error:'Playback authorization is already in progress.'});
    state.busy=true;
    try{
      const res=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.target),signal:AbortSignal.timeout(10000)});
      const grant=await res.json();if(!res.ok)throw new Error(grant.error||'Your site did not authorize playback.');
      reply({grant});
    }catch(error){reply({error:error.message||'Playback authorization failed.'});}
    finally{state.busy=false;}
  });
  mount(document);
  new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')mount(r.target);else for(const node of r.addedNodes)if(node.nodeType===1)mount(node);}
    for(const iframe of frames.keys())if(!iframe.isConnected)frames.delete(iframe);
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-watch-id','data-telegram-url']});
})();
