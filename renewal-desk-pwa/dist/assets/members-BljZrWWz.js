import{a as L,i as v,q as h,b as E,n as o,f as S,t as q,u as M,v as $,j as k,w as H,x as T}from"./index-X8o2YUSX.js";const A={async mount(i){let e=[],m=0,u=1,p=!1,l="all",c="";i.innerHTML=`
      ${L({title:"Members",showBack:!0,actions:[{icon:"add",label:"Add"},{icon:"upload",label:"Import"}]})}
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
      <button class="fab" id="fab-add">${v("add",24,"white")}</button>`,E(i,{actions:[{onClick:()=>o.push("add-member")},{onClick:()=>o.push("member-import")}]}),i.querySelector("#fab-add").addEventListener("click",()=>o.push("add-member")),i.querySelector("#member-filters").addEventListener("click",r=>{const a=r.target.closest(".filter-chip");a&&(i.querySelectorAll(".filter-chip").forEach(s=>s.classList.remove("active")),a.classList.add("active"),l=a.dataset.filter,u=1,e=[],f())});const g=i.querySelector("#member-search"),y=T(r=>{c=r,u=1,e=[],f()},400);g.addEventListener("input",r=>y(r.target.value.trim()));const t=i.querySelector("#members-list");t.addEventListener("scroll",()=>{p||e.length>=m||t.scrollTop+t.clientHeight>=t.scrollHeight-200&&(u++,f(!0))});async function f(r=!1){p=!0,r||(t.innerHTML=h());let a=`/api/mobile/v1/members?page=${u}&page_size=20`;c&&(a+=`&q=${encodeURIComponent(c)}`),l!=="all"&&l!=="expiring"&&(a+=`&status=${l}`);const s=await S(a);if(p=!1,!s.ok){if(s.error.status===401)return q();t.innerHTML=M(s.error.message);return}const b=s.data.members||[];if(m=s.data.pagination?.total||0,l==="expiring"){const n=b.filter(d=>d.days_until_expiry!=null&&d.days_until_expiry>=0&&d.days_until_expiry<=7);e=r?[...e,...n]:n}else e=r?[...e,...b]:b;e.length===0?(t.innerHTML=$({icon:"members",title:"No members found",text:c?"Try a different search term":"Add your first member to get started",actionText:c?void 0:"Add Member",actionId:"add-empty"}),t.querySelector("#add-empty")?.addEventListener("click",()=>o.push("add-member"))):(t.innerHTML=`<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${k(l==="expiring"?e.length:m)} member${m!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${e.map(n=>H(n)).join("")}</div>
        </div>`,t.querySelectorAll("[data-member-id]").forEach(n=>{n.addEventListener("click",()=>{const d=e.find(x=>String(x.id)===n.dataset.memberId);d&&o.push("member-detail",{member:JSON.stringify(d)})})}))}await f()}};export{A as default};
