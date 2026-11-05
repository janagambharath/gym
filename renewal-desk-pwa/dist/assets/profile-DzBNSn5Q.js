import{f as d,a as l,t as o,b as c,n as v,g as p,C as m,j as f,J as s,K as u}from"./index-CQxy6hAi.js";const $={async mount(e){await i(e),d(e,()=>i(e,!0))}};async function i(e,t=!1){t||(e.innerHTML=`${l({title:"My Profile",showBack:!0})}<div class="scroll-view" id="mpr-scroll">${o()}</div>`),t||c(e,{onBack:()=>v.pop()});const r=await p("/api/member/v1/profile");if(e.dataset.screenDisposed==="true"||t&&!r.ok)return;const n=e.querySelector("#mpr-scroll"),a=r.ok?r.data.member||r.data:{};n.innerHTML=`<div class="scroll-content">
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
