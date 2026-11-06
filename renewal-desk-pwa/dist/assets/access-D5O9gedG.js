import{f as u,a as f,u as g,b as y,n as h,g as v,x as $,i as k,H as b}from"./index-D2dcDZYm.js";let s=1,m=1,i=[];const _={async mount(a){s=1,i=[],await d(a),u(a,()=>d(a,!0))}};async function d(a,n=!1){n||(a.innerHTML=`${f({title:"Attendance",showBack:!0})}<div class="scroll-view" id="ma-list">${g()}</div>`),n||y(a,{onBack:()=>h.pop()});let t;if(n){const e=await Promise.all(Array.from({length:s},(l,p)=>v(`/api/member/v1/access?page=${p+1}&per_page=20`)));t=e.find(l=>!l.ok)||e[e.length-1],t.ok&&(i=e.flatMap(l=>l.data.events||[]))}else t=await v(`/api/member/v1/access?page=${s}&per_page=20`),t.ok&&(i=[...i,...t.data.events||[]]);if(a.dataset.screenDisposed==="true"||n&&!t.ok)return;const c=a.querySelector("#ma-list"),o=t.ok?t.data.pagination?.total??null:null;m=t.ok?t.data.pagination?.total_pages??1:1;const r=i;if(!Array.isArray(r)||r.length===0){c.innerHTML=$({icon:"access",title:"No attendance records",text:"Your gym visits will appear here"});return}c.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${r.map(e=>`
    <div class="list-item">
      <div style="width:32px;height:32px;border-radius:var(--r-full);background:${e.event_type==="entry"?"var(--success-surface)":"var(--gray-100)"};display:flex;align-items:center;justify-content:center">
        ${k(e.event_type==="entry"?"forward":"back",14,e.event_type==="entry"?"var(--success)":"var(--muted)")}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${e.event_type==="entry"?"Check In":"Check Out"}</div>
        <div class="list-item-subtitle">${b(e.timestamp||e.created_at)}</div>
      </div>
    </div>`).join("")}</div>
    ${o!=null?`<div style="text-align:center;font-size:var(--fs-sm);color:var(--muted);padding:var(--sp-sm)">Showing ${r.length} of ${o} visits</div>`:""}
    ${s<m?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ma-more">Load more</button></div>':""}
  </div>`,c.querySelector("#ma-more")?.addEventListener("click",()=>{s++,d(a)})}export{_ as default};
