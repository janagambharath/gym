import{a as E,i as v,q as h,b as S,n as d,f as x,t as q,u as M,v as $,j as k,w as H,x as w}from"./index-BuZwiNA4.js";const A={async mount(a){let t=[],o=0,c=1,f=!1,n="all",l="";a.innerHTML=`
      ${E({title:"Members",showBack:!0,actions:[{icon:"add",label:"Add"},{icon:"upload",label:"Import"}]})}
      <div style="padding:var(--sp-sm) var(--sp-lg)">
        <div class="search-bar">
          <span class="search-icon">${v("search",18)}</span>
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
      <div class="scroll-view" id="members-list">${h()}</div>
      <button class="fab" id="fab-add">${v("add",24,"white")}</button>`,S(a,{actions:[{onClick:()=>d.push("add-member")},{onClick:()=>d.push("member-import")}]}),a.querySelector("#fab-add").addEventListener("click",()=>d.push("add-member")),a.querySelector("#member-filters").addEventListener("click",i=>{const r=i.target.closest(".filter-chip");r&&(a.querySelectorAll(".filter-chip").forEach(s=>s.classList.remove("active")),r.classList.add("active"),n=r.dataset.filter,c=1,t=[],m())});const g=a.querySelector("#member-search"),y=w(i=>{l=i,c=1,t=[],m()},400);g.addEventListener("input",i=>y(i.target.value.trim()));const e=a.querySelector("#members-list");e.addEventListener("scroll",()=>{f||t.length>=o||e.scrollTop+e.clientHeight>=e.scrollHeight-200&&(c++,m(!0))});async function m(i=!1){f=!0,i||(e.innerHTML=h());let r=`/api/mobile/v1/members?page=${c}&page_size=20`;l&&(r+=`&q=${encodeURIComponent(l)}`),n==="expiring"?r+="&expiring_within_days=7":n==="not_enrolled"?r+="&biometric=not_enrolled":n!=="all"&&(r+=`&status=${n}`);const s=await x(r);if(f=!1,!s.ok){if(s.error.status===401)return q();e.innerHTML=M(s.error.message);return}const u=s.data.members||[];o=s.data.pagination?.total||0,t=i?[...t,...u]:u,t.length===0?(e.innerHTML=$({icon:"members",title:"No members found",text:l?"Try a different search term":"Add your first member to get started",actionText:l?void 0:"Add Member",actionId:"add-empty"}),e.querySelector("#add-empty")?.addEventListener("click",()=>d.push("add-member"))):(e.innerHTML=`<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${k(n==="expiring"?t.length:o)} member${o!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${t.map(b=>H(b)).join("")}</div>
        </div>`,e.querySelectorAll("[data-member-id]").forEach(b=>{b.addEventListener("click",()=>{const p=t.find(L=>String(L.id)===b.dataset.memberId);p&&d.push("member-detail",{member:JSON.stringify(p)})})}))}await m()}};export{A as default};
