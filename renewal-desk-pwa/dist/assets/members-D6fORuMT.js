import{a as M,i as L,u as S,b as k,n as d,g as E,v as w,w as H,x as A,k as T,y as I,f as _,z as C}from"./index-C9y_aAuQ.js";const N={async mount(r){let a=[],f=0,l=1,p=!1,o="all",c="";r.innerHTML=`
      ${M({title:"Members",showBack:!0,actions:[{icon:"add",label:"Add"},{icon:"upload",label:"Import"},{icon:"camera",label:"Scan"}]})}
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
      <div class="scroll-view" id="members-list">${S()}</div>
      <button class="fab" id="fab-add">${L("add",24,"white")}</button>`,k(r,{actions:[{onClick:()=>d.push("add-member")},{onClick:()=>d.push("member-import")},{onClick:()=>d.push("member-scan")}]}),r.querySelector("#fab-add").addEventListener("click",()=>d.push("add-member")),r.querySelector("#member-filters").addEventListener("click",i=>{const s=i.target.closest(".filter-chip");s&&(r.querySelectorAll(".filter-chip").forEach(v=>v.classList.remove("active")),s.classList.add("active"),o=s.dataset.filter,l=1,a=[],m())});const x=r.querySelector("#member-search"),$=C(i=>{c=i,l=1,a=[],m()},400);x.addEventListener("input",i=>$(i.target.value.trim()));const e=r.querySelector("#members-list");e.addEventListener("scroll",()=>{p||a.length>=f||e.scrollTop+e.clientHeight>=e.scrollHeight-200&&(l++,m(!0))});let g=0;async function m(i=!1,s=!1){if(s&&p)return;const v=++g;p=!0,!i&&!s&&(e.innerHTML=S());let n=`/api/mobile/v1/members?page=${l}&page_size=20`;c&&(n+=`&q=${encodeURIComponent(c)}`),o==="expiring"?n+="&expiring_within_days=7":o==="not_enrolled"?n+="&biometric=not_enrolled":o!=="all"&&(n+=`&status=${o}`);const h=s?await Promise.all(Array.from({length:l},(t,b)=>E(n.replace(`page=${l}&`,`page=${b+1}&`)))):[await E(n)];if(v!==g)return;const u=h.find(t=>!t.ok)||h[0];if(p=!1,!u.ok){if(u.error.status===401)return w();s||(e.innerHTML=H(u.error.message));return}const y=h.flatMap(t=>t.data.members||[]);f=u.data.pagination?.total||0,a=i?[...a,...y]:y,a.length===0?(e.innerHTML=A({icon:"members",title:"No members found",text:c?"Try a different search term":"Add your first member to get started",actionText:c?void 0:"Add Member",actionId:"add-empty"}),e.querySelector("#add-empty")?.addEventListener("click",()=>d.push("add-member"))):(e.innerHTML=`<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${T(f)} member${f!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${a.map(t=>I(t)).join("")}</div>
        </div>`,e.querySelectorAll("[data-member-id]").forEach(t=>{t.addEventListener("click",()=>{const b=a.find(q=>String(q.id)===t.dataset.memberId);b&&d.push("member-detail",{member:JSON.stringify(b)})})}))}await m(),_(r,()=>m(!1,!0))}};export{N as default};
