/* Add once to your site; finds existing and dynamically inserted video placeholders. */
(()=>{
  const script=document.currentScript;
  if(!script)return;
  const origin=new URL(script.src).origin;
  function mount(root){
    const nodes=[...(root.matches?.('[data-watch-id], [data-telegram-url]')?[root]:[]),...(root.querySelectorAll?.('[data-watch-id], [data-telegram-url]')||[])];
    for(const node of nodes){
      const id=node.dataset.watchId,post=node.dataset.telegramUrl,key=post||id;
      if(!key||node.dataset.watchMounted===key)continue;
      if(!post&&!/^[a-zA-Z0-9_-]{1,100}$/.test(id))continue;
      const iframe=document.createElement('iframe'),url=new URL(post?'/watch':`/watch/${encodeURIComponent(id)}`,origin);
      if(post)url.searchParams.set('url',post);
      for(const key of ['title','label','avatar','poster','next'])if(node.dataset[key])url.searchParams.set(key,node.dataset[key]);
      iframe.src=url.href;iframe.title=node.dataset.title||'Video player';iframe.allow='fullscreen; picture-in-picture';iframe.allowFullscreen=true;iframe.loading='lazy';iframe.style.cssText='display:block;width:100%;height:100%;border:0;';
      node.style.aspectRatio ||= '16 / 9';node.dataset.watchMounted=key;node.replaceChildren(iframe);
    }
  }
  mount(document);
  new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')mount(r.target);else for(const node of r.addedNodes)if(node.nodeType===1)mount(node);}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-watch-id','data-telegram-url']});
})();
