import{a as r,z as c,b as o,k as f,A as v,f as m,e as s,C as p,n as l}from"./index-BPPTfp3n.js";const y={async mount(e){e.innerHTML=`${r({title:"Staff",showBack:!0,actions:[{icon:"add",label:"Add"}]})}<div class="scroll-view" id="staff-list">${c()}</div>`,o(e,{onBack:()=>l.pop(),actions:[{onClick:()=>d()}]});const t=await f("/api/mobile/v1/staff"),i=t.ok?t.data.staff||t.data||[]:[],n=e.querySelector("#staff-list");if(!Array.isArray(i)||i.length===0){n.innerHTML=v({icon:"staff",title:"No staff",text:"Add your team members"});return}n.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${i.map(a=>`
    <div class="list-item"><div style="display:flex;align-items:center;gap:var(--sp-md);flex:1">
      ${m(a.full_name||a.name)}<div class="list-item-content">
        <div class="list-item-title">${s(a.full_name||a.name)}</div>
        <div class="list-item-subtitle">${s(a.email||"")} · ${s(a.role||"")}</div>
      </div></div>${p(a.is_active!==!1?"Active":"Inactive")}</div>`).join("")}</div></div>`;function d(){l.push("add-member")}}};export{y as default};
