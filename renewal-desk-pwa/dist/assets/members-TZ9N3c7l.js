import{a as M,i as L,t as E,b as w,n as m,g as S,u as H,v as k,w as A,k as T,x as I,f as _,y as C}from"./index-8vE_Qb-N.js";const R={async mount(a){let t=[],f=0,l=1,p=!1,n="all",o="";a.innerHTML=`
      ${M({title:"Members",showBack:!0,actions:[{icon:"add",label:"Add"},{icon:"upload",label:"Import"}]})}
      <div style="padding:var(--sp-sm) var(--sp-lg)">
        <div class="search-bar">
          <span class="search-icon">${L("search",18)}</span>
          <input type="text" placeholder="Search members..." id="member-search">
        </div>
      </div>
      <div class="filter-chips" id="member-filters">
        <button class="filter-chip active" data-filter="all">All</button>
        <button class="filter-chip" data-filter="active">Active</button>
        <button class="filter-chip" data-filter="expiring">Expiring</button>
        <button class="filter-chip" data-filter="expired">Expired</button>
        <button class="filter-chip" data-filter="not_enrolled">Not enrolled</button>
      </div>
      <div class="scroll-view" id="members-list">${E()}</div>
      <button class="fab" id="fab-add">${L("add",24,"white")}</button>`,w(a,{actions:[{onClick:()=>m.push("add-member")},{onClick:()=>m.push("member-import")}]}),a.querySelector("#fab-add").addEventListener("click",()=>m.push("add-member")),a.querySelector("#member-filters").addEventListener("click",i=>{const s=i.target.closest(".filter-chip");s&&(a.querySelectorAll(".filter-chip").forEach(v=>v.classList.remove("active")),s.classList.add("active"),n=s.dataset.filter,l=1,t=[],c())});const x=a.querySelector("#member-search"),$=C(i=>{o=i,l=1,t=[],c()},400);x.addEventListener("input",i=>$(i.target.value.trim()));const e=a.querySelector("#members-list");e.addEventListener("scroll",()=>{p||t.length>=f||e.scrollTop+e.clientHeight>=e.scrollHeight-200&&(l++,c(!0))});let g=0;async function c(i=!1,s=!1){if(s&&p)return;const v=++g;p=!0,!i&&!s&&(e.innerHTML=E());let d=`/api/mobile/v1/members?page=${l}&page_size=20`;o&&(d+=`&q=${encodeURIComponent(o)}`),n==="expiring"?d+="&expiring_within_days=7":n==="not_enrolled"?d+="&biometric=not_enrolled":n!=="all"&&(d+=`&status=${n}`);const h=s?await Promise.all(Array.from({length:l},(r,b)=>S(d.replace(`page=${l}&`,`page=${b+1}&`)))):[await S(d)];if(v!==g)return;const u=h.find(r=>!r.ok)||h[0];if(p=!1,!u.ok){if(u.error.status===401)return H();s||(e.innerHTML=k(u.error.message));return}const y=h.flatMap(r=>r.data.members||[]);f=u.data.pagination?.total||0,t=i?[...t,...y]:y,t.length===0?(e.innerHTML=A({icon:"members",title:"No members found",text:o?"Try a different search term":"Add your first member to get started",actionText:o?void 0:"Add Member",actionId:"add-empty"}),e.querySelector("#add-empty")?.addEventListener("click",()=>m.push("add-member"))):(e.innerHTML=`<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${T(n==="expiring"?t.length:f)} member${f!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${t.map(r=>I(r)).join("")}</div>
        </div>`,e.querySelectorAll("[data-member-id]").forEach(r=>{r.addEventListener("click",()=>{const b=t.find(q=>String(q.id)===r.dataset.memberId);b&&m.push("member-detail",{member:JSON.stringify(b)})})}))}await c(),_(a,()=>c(!1,!0))}};export{R as default};
