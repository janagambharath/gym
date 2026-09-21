import{a as d,z as i,b as l,k as t,f as o,e as c,I as a,J as v,n as p}from"./index-BPPTfp3n.js";const f={async mount(r){r.innerHTML=`${d({title:"My Profile",showBack:!0})}<div class="scroll-view" id="mpr-scroll">${i()}</div>`,l(r,{onBack:()=>p.pop()});const n=await t("/api/member/v1/profile"),s=r.querySelector("#mpr-scroll"),e=n.ok?n.data:{};s.innerHTML=`<div class="scroll-content">
    <div style="text-align:center;padding:var(--sp-xxl);background:var(--card)">
      <div style="display:inline-flex">${o(e.full_name||"","xl")}</div>
      <h2 style="margin-top:var(--sp-md)">${c(e.full_name||"—")}</h2>
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${a("Phone",e.phone||"—")}
      ${a("Email",e.email||"—")}
      ${a("Gender",e.gender||"—")}
      ${a("Member Since",v(e.joined_on||e.created_at))}
    </div></div>
  </div>`}};export{f as default};
