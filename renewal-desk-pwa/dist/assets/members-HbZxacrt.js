import{a as I,i as $,x as q,b as _,n as d,e as x,y as z,s as w,z as B,v as M,A as N,k,B as R,d as P,C as j,g as D}from"./index-C7C1lUE0.js";const J={async mount(a){let s=[],l=0,c=1,b=!1,m="all",f="";a.innerHTML=`
      ${I({title:"Members",showBack:!0,actions:[{icon:"add",label:"Add"},{icon:"upload",label:"Import"},{icon:"camera",label:"Scan"}]})}
      <div style="padding:var(--sp-sm) var(--sp-lg)">
        <div class="search-bar">
          <span class="search-icon">${$("search",18)}</span>
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
      <div class="scroll-view" id="members-list">${q()}</div>
      <button class="fab" id="fab-add">${$("add",24,"white")}</button>`,_(a,{actions:[{onClick:()=>d.push("add-member")},{onClick:()=>d.push("member-import")},{onClick:()=>d.push("member-scan")}]}),a.querySelector("#fab-add").addEventListener("click",()=>d.push("add-member")),a.querySelector("#member-filters").addEventListener("click",e=>{const i=e.target.closest(".filter-chip");i&&(a.querySelectorAll(".filter-chip").forEach(y=>y.classList.remove("active")),i.classList.add("active"),m=i.dataset.filter,c=1,s=[],n())});const A=a.querySelector("#member-search"),T=j(e=>{f=e,c=1,s=[],n()},400);A.addEventListener("input",e=>T(e.target.value.trim()));const r=a.querySelector("#members-list");r.addEventListener("scroll",()=>{b||s.length>=l||r.scrollTop+r.clientHeight>=r.scrollHeight-200&&n(!0)});let E=0,v=!1,g=null;function C(){const e=a.querySelector("#members-count");e&&g&&(e.textContent=`${k(l)} member${l!==1?"s":""} · last updated ${D(g)}`)}async function n(e=!1,i=!1){if(i&&b)return;const y=++E;b=!0,!e&&!i&&(r.innerHTML=q());const p=e?c+1:c;let o=`/api/mobile/v1/members?page=${p}&page_size=20`;f&&(o+=`&q=${encodeURIComponent(f)}`),m==="expiring"?o+="&expiring_within_days=7":m==="not_enrolled"?o+="&biometric=not_enrolled":m!=="all"&&(o+=`&status=${m}`);const S=i?await Promise.all(Array.from({length:p},(t,h)=>x(o.replace(`page=${p}&`,`page=${h+1}&`)))):[await x(o)];if(y!==E)return;const u=S.find(t=>!t.ok)||S[0];if(b=!1,!u.ok){if(u.error.status===401)return z();if(e){w(u.error?.message||"Could not load more members.","error");return}if(i){v||(v=!0,w("Could not refresh the member list — showing the last loaded members.","error")),C();return}r.innerHTML=B(u.error.message),r.querySelector("#retry-btn")?.addEventListener("click",()=>n());return}v=!1,g=new Date;const L=M(S.flatMap(t=>t.data.members||[]),t=>t.id);l=u.data.pagination?.total||0,e&&(c=p),s=e?M([...s,...L],t=>t.id):L,s.length===0?(r.innerHTML=N({icon:"members",title:"No members found",text:f?"Try a different search term":"Add your first member to get started",actionText:f?void 0:"Add Member",actionId:"add-empty"}),r.querySelector("#add-empty")?.addEventListener("click",()=>d.push("add-member"))):(r.innerHTML=`<div class="scroll-content">
          <div id="members-count" style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${k(l)} member${l!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${s.map(t=>R(t)).join("")}</div>
        </div>`,r.querySelectorAll("[data-member-id]").forEach(t=>{t.addEventListener("click",()=>{const h=s.find(H=>String(H.id)===t.dataset.memberId);h&&d.push("member-detail",{member:JSON.stringify(h)})})}))}await n(),P(a,()=>n(!1,!0))}};export{J as default};
