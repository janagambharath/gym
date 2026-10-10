import{a as E,i as v,q as h,b as S,n as l,f as x,t as q,u as M,v as $,j as k,w as H,x as w}from"./index-CcfJRRM3.js";const A={async mount(i){let t=[],c=0,o=1,u=!1,n="all",d="";i.innerHTML=`
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
      </div>
      <div class="scroll-view" id="members-list">${h()}</div>
      <button class="fab" id="fab-add">${v("add",24,"white")}</button>`,S(i,{actions:[{onClick:()=>l.push("add-member")},{onClick:()=>l.push("member-import")}]}),i.querySelector("#fab-add").addEventListener("click",()=>l.push("add-member")),i.querySelector("#member-filters").addEventListener("click",r=>{const a=r.target.closest(".filter-chip");a&&(i.querySelectorAll(".filter-chip").forEach(s=>s.classList.remove("active")),a.classList.add("active"),n=a.dataset.filter,o=1,t=[],m())});const g=i.querySelector("#member-search"),y=w(r=>{d=r,o=1,t=[],m()},400);g.addEventListener("input",r=>y(r.target.value.trim()));const e=i.querySelector("#members-list");e.addEventListener("scroll",()=>{u||t.length>=c||e.scrollTop+e.clientHeight>=e.scrollHeight-200&&(o++,m(!0))});async function m(r=!1){u=!0,r||(e.innerHTML=h());let a=`/api/mobile/v1/members?page=${o}&page_size=20`;d&&(a+=`&q=${encodeURIComponent(d)}`),n==="expiring"?a+="&expiring_within_days=7":n!=="all"&&(a+=`&status=${n}`);const s=await x(a);if(u=!1,!s.ok){if(s.error.status===401)return q();e.innerHTML=M(s.error.message);return}const b=s.data.members||[];c=s.data.pagination?.total||0,t=r?[...t,...b]:b,t.length===0?(e.innerHTML=$({icon:"members",title:"No members found",text:d?"Try a different search term":"Add your first member to get started",actionText:d?void 0:"Add Member",actionId:"add-empty"}),e.querySelector("#add-empty")?.addEventListener("click",()=>l.push("add-member"))):(e.innerHTML=`<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${k(n==="expiring"?t.length:c)} member${c!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${t.map(p=>H(p)).join("")}</div>
        </div>`,e.querySelectorAll("[data-member-id]").forEach(p=>{p.addEventListener("click",()=>{const f=t.find(L=>String(L.id)===p.dataset.memberId);f&&l.push("member-detail",{member:JSON.stringify(f)})})}))}await m()}};export{A as default};
