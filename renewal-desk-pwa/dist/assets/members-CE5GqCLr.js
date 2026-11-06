import{a as I,i as $,u as q,b as _,n as o,e as w,v as z,s as x,w as N,q as M,x as R,g as T,y as B,d as P,z as j,o as D}from"./index-Be_aVmFu.js";const J={async mount(a){let s=[],l=0,d=1,b=!1,c="all",m="";a.innerHTML=`
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
      <button class="fab" id="fab-add">${$("add",24,"white")}</button>`,_(a,{actions:[{onClick:()=>o.push("add-member")},{onClick:()=>o.push("member-import")},{onClick:()=>o.push("member-scan")}]}),a.querySelector("#fab-add").addEventListener("click",()=>o.push("add-member")),a.querySelector("#member-filters").addEventListener("click",e=>{const i=e.target.closest(".filter-chip");i&&(a.querySelectorAll(".filter-chip").forEach(y=>y.classList.remove("active")),i.classList.add("active"),c=i.dataset.filter,d=1,s=[],f())});const A=a.querySelector("#member-search"),H=j(e=>{m=e,d=1,s=[],f()},400);A.addEventListener("input",e=>H(e.target.value.trim()));const r=a.querySelector("#members-list");r.addEventListener("scroll",()=>{b||s.length>=l||r.scrollTop+r.clientHeight>=r.scrollHeight-200&&f(!0)});let E=0,v=!1,g=null;function k(){const e=a.querySelector("#members-count");e&&g&&(e.textContent=`${T(l)} member${l!==1?"s":""} · last updated ${D(g)}`)}async function f(e=!1,i=!1){if(i&&b)return;const y=++E;b=!0,!e&&!i&&(r.innerHTML=q());const p=e?d+1:d;let n=`/api/mobile/v1/members?page=${p}&page_size=20`;m&&(n+=`&q=${encodeURIComponent(m)}`),c==="expiring"?n+="&expiring_within_days=7":c==="not_enrolled"?n+="&biometric=not_enrolled":c!=="all"&&(n+=`&status=${c}`);const S=i?await Promise.all(Array.from({length:p},(t,h)=>w(n.replace(`page=${p}&`,`page=${h+1}&`)))):[await w(n)];if(y!==E)return;const u=S.find(t=>!t.ok)||S[0];if(b=!1,!u.ok){if(u.error.status===401)return z();if(e){x(u.error?.message||"Could not load more members.","error");return}if(i){v||(v=!0,x("Could not refresh the member list — showing the last loaded members.","error")),k();return}r.innerHTML=N(u.error.message);return}v=!1,g=new Date;const L=M(S.flatMap(t=>t.data.members||[]),t=>t.id);l=u.data.pagination?.total||0,e&&(d=p),s=e?M([...s,...L],t=>t.id):L,s.length===0?(r.innerHTML=R({icon:"members",title:"No members found",text:m?"Try a different search term":"Add your first member to get started",actionText:m?void 0:"Add Member",actionId:"add-empty"}),r.querySelector("#add-empty")?.addEventListener("click",()=>o.push("add-member"))):(r.innerHTML=`<div class="scroll-content">
          <div id="members-count" style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${T(l)} member${l!==1?"s":""}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${s.map(t=>B(t)).join("")}</div>
        </div>`,r.querySelectorAll("[data-member-id]").forEach(t=>{t.addEventListener("click",()=>{const h=s.find(C=>String(C.id)===t.dataset.memberId);h&&o.push("member-detail",{member:JSON.stringify(h)})})}))}await f(),P(a,()=>f(!1,!0))}};export{J as default};
