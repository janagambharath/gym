import{a as w,i as S,u as E,b as k,n,g as x,v as H,s as T,w as A,x as I,k as _,y as C,f as z,z as N}from"./index-Ca8zdeLr.js";const P={async mount(a){let i=[],u=0,o=1,b=!1,d="all",c="";a.innerHTML=`
      ${w({title:"Members",showBack:!0,actions:[{icon:"add",label:"Add"},{icon:"upload",label:"Import"},{icon:"camera",label:"Scan"}]})}
      <div style="padding:var(--sp-sm) var(--sp-lg)">
        <div class="search-bar">
          <span class="search-icon">${S("search",18)}</span>
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
      <button class="fab" id="fab-add">${S("add",24,"white")}</button>`,k(a,{actions:[{onClick:()=>n.push("add-member")},{onClick:()=>n.push("member-import")},{onClick:()=>n.push("member-scan")}]}),a.querySelector("#fab-add").addEventListener("click",()=>n.push("add-member")),a.querySelector("#member-filters").addEventListener("click",e=>{const s=e.target.closest(".filter-chip");s&&(a.querySelectorAll(".filter-chip").forEach(v=>v.classList.remove("active")),s.classList.add("active"),d=s.dataset.filter,o=1,i=[],m())});const $=a.querySelector("#member-search"),q=N(e=>{c=e,o=1,i=[],m()},400);$.addEventListener("input",e=>q(e.target.value.trim()));const t=a.querySelector("#members-list");t.addEventListener("scroll",()=>{b||i.length>=u||t.scrollTop+t.clientHeight>=t.scrollHeight-200&&m(!0)});let y=0;async function m(e=!1,s=!1){if(s&&b)return;const v=++y;b=!0,!e&&!s&&(t.innerHTML=E());const p=e?o+1:o;let l=`/api/mobile/v1/members?page=${p}&page_size=20`;c&&(l+=`&q=${encodeURIComponent(c)}`),d==="expiring"?l+="&expiring_within_days=7":d==="not_enrolled"?l+="&biometric=not_enrolled":d!=="all"&&(l+=`&status=${d}`);const g=s?await Promise.all(Array.from({length:p},(r,h)=>x(l.replace(`page=${p}&`,`page=${h+1}&`)))):[await x(l)];if(v!==y)return;const f=g.find(r=>!r.ok)||g[0];if(b=!1,!f.ok){if(f.error.status===401)return H();if(e){T(f.error?.message||"Could not load more members.","error");return}s||(t.innerHTML=A(f.error.message));return}const L=g.flatMap(r=>r.data.members||[]);u=f.data.pagination?.total||0,e&&(o=p),i=e?[...i,...L]:L,i.length===0?(t.innerHTML=I({icon:"members",title:"No members found",text:c?"Try a different search term":"Add your first member to get started",actionText:c?void 0:"Add Member",actionId:"add-empty"}),t.querySelector("#add-empty")?.addEventListener("click",()=>n.push("add-member"))):(t.innerHTML=`<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${_(u)} member${u!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${i.map(r=>C(r)).join("")}</div>
        </div>`,t.querySelectorAll("[data-member-id]").forEach(r=>{r.addEventListener("click",()=>{const h=i.find(M=>String(M.id)===r.dataset.memberId);h&&n.push("member-detail",{member:JSON.stringify(h)})})}))}await m(),z(a,()=>m(!1,!0))}};export{P as default};
