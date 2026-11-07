import{e as c,a as v,x as y,y as b,f,j as g,i as p,b as $,n as h,q as E,s as m,r as u}from"./index-BQ5hDMiM.js";const S={async mount(t){let s=[],a=null,n=null;async function d(){const e=await c("/api/mobile/v1/settings");e.ok?(n=null,s=e.data.plans||[]):(n=e.error?.message||"Failed to load",s=[]),l()}function l(){t.innerHTML=`${v({title:"Membership Plans",showBack:!0,actions:[{icon:"add",label:"Add"}]})}
      <div class="scroll-view"><div class="scroll-content">
        ${n?y(n,"plans-retry"):s.length===0?b({icon:"plan",title:"No plans",text:"Create your first membership plan",actionText:"Add Plan",actionId:"add-plan"}):`<div class="card" style="margin:var(--sp-lg)">${s.map(e=>`
            <div class="list-item" data-id="${e.id}">
              <div class="list-item-content">
                <div class="list-item-title">${f(e.name)}</div>
                <div class="list-item-subtitle">${e.duration_days} days</div>
              </div>
              <div style="font-weight:var(--fw-bold)">${g(e.price)}</div>
              <button class="btn btn-sm btn-secondary" data-edit="${e.id}">${p("edit",14)}</button>
              <button class="btn btn-sm btn-secondary" data-del="${e.id}" style="color:var(--critical)">${p("delete",14)}</button>
            </div>`).join("")}</div>`}
        ${a!==null?`<div style="padding:var(--sp-lg)"><div class="card card-body">
          <h3 style="margin-bottom:var(--sp-lg)">${a.id?"Edit":"New"} Plan</h3>
          <form id="plan-form" style="display:flex;flex-direction:column;gap:var(--sp-md)">
            ${u({id:"pl-name",label:"Name",value:a.name||"",required:!0,placeholder:"e.g. Monthly"})}
            ${u({id:"pl-days",label:"Duration (days)",type:"number",value:a.duration_days||"30",required:!0})}
            ${u({id:"pl-price",label:"Price",type:"number",value:a.price||"",required:!0})}
            <div style="display:flex;gap:var(--sp-sm)">
              <button type="submit" class="btn btn-primary" style="flex:1">Save</button>
              <button type="button" class="btn btn-secondary" id="plan-cancel">Cancel</button>
            </div>
          </form></div></div>`:""}
      </div></div>`,$(t,{onBack:()=>h.pop(),actions:[{onClick:()=>{a={},l()}}]}),t.querySelector("#plans-retry")?.addEventListener("click",d),t.querySelector("#add-plan")?.addEventListener("click",()=>{a={},l()}),t.querySelectorAll("[data-edit]").forEach(e=>e.addEventListener("click",r=>{r.stopPropagation(),a=s.find(i=>String(i.id)===e.dataset.edit)||{},l()})),t.querySelectorAll("[data-del]").forEach(e=>e.addEventListener("click",async r=>{if(r.stopPropagation(),await E({title:"Delete Plan",message:"Remove this plan?",confirmText:"Delete",destructive:!0})){const o=await c(`/api/mobile/v1/plans/${e.dataset.del}`,{method:"DELETE"});m(o.ok?"Deleted":o.error.message,o.ok?"success":"error"),o.ok&&d()}})),t.querySelector("#plan-cancel")?.addEventListener("click",()=>{a=null,l()}),t.querySelector("#plan-form")?.addEventListener("submit",async e=>{e.preventDefault();const r={name:t.querySelector("#pl-name").value.trim(),duration_days:Number(t.querySelector("#pl-days").value),price:t.querySelector("#pl-price").value},i=a.id?await c(`/api/mobile/v1/plans/${a.id}`,{method:"PATCH",body:r}):await c("/api/mobile/v1/plans",{method:"POST",body:r});m(i.ok?"Saved!":i.error.message,i.ok?"success":"error"),i.ok&&(a=null,d())})}await d()}};export{S as default};
