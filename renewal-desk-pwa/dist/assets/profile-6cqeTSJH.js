import{f as d,a as l,x as o,b as c,n as v,g as p,G as m,j as f,P as s,u}from"./index-B6-uktyq.js";const $={async mount(e){await t(e),d(e,()=>t(e,!0))}};async function t(e,i=!1){i||(e.innerHTML=`${l({title:"My Profile",showBack:!0})}<div class="scroll-view" id="mpr-scroll">${o()}</div>`),i||c(e,{onBack:()=>v.pop()});const r=await p("/api/member/v1/profile");if(e.dataset.screenDisposed==="true"||i&&!r.ok)return;const n=e.querySelector("#mpr-scroll"),a=r.ok?r.data.member||r.data:{};n.innerHTML=`<div class="scroll-content">
    <div style="text-align:center;padding:var(--sp-xxl);background:var(--card)">
      <div style="display:inline-flex">${m(a.full_name||"","xl")}</div>
      <h2 style="margin-top:var(--sp-md)">${f(a.full_name||"—")}</h2>
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${s("Phone",a.phone||"—")}
      ${s("Email",a.email||"—")}
      ${s("Gender",a.gender||"—")}
      ${s("Member Since",u(a.joined_on||a.created_at))}
    </div></div>
  </div>`}export{$ as default};
