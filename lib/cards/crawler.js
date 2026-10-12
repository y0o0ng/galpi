'use strict';
const { RSS_FEEDS, parseFeed } = require('../reels/collect');
const { canonicalizeUrl } = require('../news/normalize');
const { normalizePublicWebUrl } = require('../web/service');
const WEEK = 7 * 86400;
const FEEDS = [...RSS_FEEDS.map(feed=>({...feed,role:'original_news'})),
  ...[
    ['Google','https://blog.google/rss/'],
    ['Google Developers','https://developers.googleblog.com/feeds/posts/default?alt=rss'],
    ['OpenAI','https://openai.com/news/rss.xml'],
    ['Microsoft','https://blogs.microsoft.com/feed/'],
    ['GitHub','https://github.blog/feed/'],
    ['Python','https://blog.python.org/feeds/posts/default?alt=rss'],
  ].map(([source,url])=>({source,url,role:'official'})),
  ...[
    ['TechCrunch','https://techcrunch.com/feed/'],
    ['The Verge','https://www.theverge.com/rss/index.xml'],
    ['Engadget','https://www.engadget.com/rss.xml'],
    ['전자신문','https://www.etnews.com/rss/Section901.xml'],
  ].map(([source,url])=>({source,url,role:'original_news'}))];
const NAVER_QUERIES=['인공지능','로봇','반도체','소프트웨어','사이버 보안','신기술'];
async function read(url,fetchImpl,json=false,headers) {
  let current=normalizePublicWebUrl(url);
  const signal=AbortSignal.timeout(15000);
  for(let n=0;n<5;n++) {
    const response=await fetchImpl(current,{signal,redirect:'manual',...(headers?{headers}:{})});
    if(response.status>=300&&response.status<400&&response.headers?.get('location')) {
      if(headers)throw new Error('AUTH_REDIRECT_BLOCKED');
      current=normalizePublicWebUrl(new URL(response.headers.get('location'),current).href);continue;
    }
    if(!response.ok)throw new Error(`HTTP_${response.status}`);
    // Feeds and public API responses are bounded before parsing.
    let raw='';
    if(response.body?.getReader) {
      const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
      try {for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;
        if(bytes>2000000)throw new Error('RESPONSE_TOO_LARGE');raw+=decoder.decode(part.value,{stream:true});}}
      finally {await reader.cancel();}
    } else raw=(await response.text()).slice(0,2000000);
    return json?JSON.parse(raw):raw;
  }
  throw new Error('REDIRECT_LIMIT');
}
const recent=(value,now)=>Number.isFinite(Date.parse(value))&&Date.parse(value)/1000>=now-WEEK&&Date.parse(value)/1000<=now+60;
const titleKey=value=>value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function groupItems(items,now) {
  const groups=[],byUrl=new Map(),byTitle=new Map();
  for(const item of items) {
    const url=canonicalizeUrl(item.url);if(!url||!item.title)continue;
    try{normalizePublicWebUrl(item.url);}catch{continue;}
    const key=titleKey(item.title),group=byUrl.get(url)||(key.length>=20?byTitle.get(key):null)||
      {title:item.title,url:item.url,summary:item.summary||'',source:item.source,published_at:item.published_at||null,date_kind:item.date_kind||'feed',evidence:[]};
    if(!groups.includes(group))groups.push(group);
    byUrl.set(url,group);if(key.length>=20)byTitle.set(key,group);
    const evidence=item.evidence||{url:item.url,role:item.role||'original_news',outlet_group:new URL(item.url).hostname.replace(/^www\./,''),published_at:item.published_at||null,metrics:[]};
    if(!group.evidence.some(e=>canonicalizeUrl(e.url)===canonicalizeUrl(evidence.url)))group.evidence.push(evidence);
  }
  return groups.map((group,id)=>{
    const news=group.evidence.filter(e=>e.role==='original_news'),posts=group.evidence.filter(e=>e.role==='community_post');
    return {...group,id,summary:group.summary.slice(0,500),attention:{
      status:posts.length?'verified':'weak',checked_at:new Date(now*1000).toISOString(),
      counts:{news_articles:news.length,independent_outlets:null,community_posts:posts.length||null,sns_posts:null},
      observed_outlets:new Set(news.map(e=>e.outlet_group)).size,evidence:group.evidence,
      limits:'이번 수집에서 확인한 자료만 집계해요. 보도 독립성·SNS 전체 반응은 미확인이에요. 다른 제목의 같은 사건은 별도 자료로 남을 수 있어요.'
    }};
  });
}
async function collectCrawlerItems({web,config={},now=Math.floor(Date.now()/1000),fetchImpl=fetch,signal}) {
  const items=[],report=[];
  await Promise.all(FEEDS.map(async feed=>{
    try {
      const xml=await read(feed.url,fetchImpl);if(!/<(?:rss|feed)\b/i.test(xml))throw new Error('NOT_A_FEED');
      const parsed=parseFeed(xml,feed.source).filter(i=>i.title&&(!i.published_at||recent(i.published_at,now))).slice(0,24);
      items.push(...parsed.map(i=>({...i,role:feed.role,date_kind:i.published_at?'feed':'unknown'})));
      report.push({source:feed.source,url:feed.url,status:'ok',count:parsed.length});
    }catch(error){report.push({source:feed.source,url:feed.url,status:'failed',error:error.message});}
  }));
  if(config.naverClientId&&config.naverClientSecret) {
    await Promise.all(NAVER_QUERIES.map(async query=>{
      try {
        const url='https://openapi.naver.com/v1/search/news.json?'+new URLSearchParams({query,display:'50',sort:'date'});
        const result=await read(url,fetchImpl,true,{'X-Naver-Client-Id':config.naverClientId,'X-Naver-Client-Secret':config.naverClientSecret});
        if(!Array.isArray(result.items))throw new Error('INVALID_NAVER_RESPONSE');
        const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
        const parsed=result.items.filter(i=>i.title&&recent(i.pubDate,now)).map(i=>({
          title:clean(i.title).slice(0,200),url:i.originallink||i.link,summary:clean(i.description).slice(0,300),
          source:'Naver News',role:'original_news',published_at:new Date(i.pubDate).toISOString(),date_kind:'naver_provided',
        }));
        items.push(...parsed);report.push({source:'Naver News',query,status:'ok',count:parsed.length});
      }catch(error){report.push({source:'Naver News',query,status:'failed',error:error.message});}
    }));
  } else report.push({source:'Naver News',status:'skipped',reason:'credentials_missing'});
  try {
    const url='https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=100&numericFilters='+encodeURIComponent(`created_at_i>${now-WEEK},points>=10`);
    const hits=(await read(url,fetchImpl,true)).hits||[];let at=0,count=0,failed=0;
    await Promise.all(Array.from({length:6},async()=>{
      while(at<hits.length&&at<100) {
        const hit=hits[at++];if(!/^\d+$/.test(String(hit.objectID)))continue;
        try {
          const post=await read(`https://hacker-news.firebaseio.com/v0/item/${hit.objectID}.json`,fetchImpl,true);
          if(!post||post.deleted||post.dead||post.type!=='story'||!post.url||!Number.isFinite(post.time)||post.time<now-WEEK||post.time>now+60)continue;
          const metrics=[];
          for(const [name,value] of [['points',post.score],['comments',post.descendants]])if(Number.isInteger(value)&&value>=0)metrics.push({name,value});
          items.push({title:post.title,url:post.url,summary:'',source:'Hacker News',published_at:new Date(post.time*1000).toISOString(),date_kind:'submission',
            evidence:{url:`https://news.ycombinator.com/item?id=${post.id}`,role:'community_post',outlet_group:'Hacker News',published_at:new Date(post.time*1000).toISOString(),metrics}});count++;
        }catch{failed++;} // A failed item remains uncounted, never a fabricated zero.
      }
    }));
    report.push({source:'Hacker News',status:failed?(count?'partial':'failed'):'ok',count,failed});
  }catch(error){report.push({source:'Hacker News',status:'failed',error:error.message});}
  if(signal?.aborted)throw Object.assign(new Error('CARDS_ABORTED'),{code:'CARDS_ABORTED'});
  // Search supplements an unavailable feed set; it is not a per-candidate LLM stage.
  if(web?.search&&(items.length<20||report.filter(r=>r.status==='failed'&&FEEDS.some(f=>f.url===r.url)).length>FEEDS.length/2)) {
    for(const query of ['new technology apps services releases this week','이번주 기술 신제품 앱 서비스 업데이트']) {
      try{const result=await web.search(query,{timeRange:'week',topic:'news',maxResults:10,searchDepth:'basic'});
        items.push(...result.results.map(i=>({title:i.title,url:i.url,summary:i.snippet||'',source:'Tavily fallback',published_at:i.publishedDate,date_kind:'estimated',role:'unknown'})));
        report.push({source:'Tavily fallback',query,status:'ok',count:result.results.length});
      }catch(error){report.push({source:'Tavily fallback',query,status:'failed',error:error.code||error.message});}
    }
  }
  // Stable ordering prevents network completion order from changing selection IDs.
  items.sort((a,b)=>a.source.localeCompare(b.source)||a.url.localeCompare(b.url));
  const groups=groupItems(items,now);
  if(!groups.length&&report.every(r=>['failed','skipped'].includes(r.status)))throw Object.assign(new Error('CARDS_COLLECTION_FAILED'),{code:'CARDS_COLLECTION_FAILED'});
  groups.collectionReport=report;return groups;
}
module.exports={FEEDS,collectCrawlerItems,groupItems};
