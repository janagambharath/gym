import{k as d,a as m,A as v,e as y,v as b,i as p,b as f,n as g,E as $,s as u,r as c}from"./index-DcA9rnoc.js";const k={async mount(t){let l=[],a=null;async function o(){const e=await d("/api/mobile/v1/settings");l=e.ok?e.data.plans||[]:[],n()}function n(){t.innerHTML=`${m({title:"Membership Plans",showBack:!0,actions:[{icon:"add",label:"Add"}]})}
      <div class="scroll-view"><div class="scroll-content">
        ${l.length===0?v({icon:"plan",title:"No plans",text:"Create your first membership plan",actionText:"Add Plan",actionId:"add-plan"}):`<div class="card" style="margin:var(--sp-lg)">${l.map(e=>`
            <div class="list-item" data-id="${e.id}">
              <div class="list-item-content">
                <div class="list-item-title">${y(e.name)}</div>
                <div class="list-item-subtitle">${e.duration_days} days</div>
              </div>
              <div style="font-weight:var(--fw-bold)">${b(e.price)}</div>
              <button class="btn btn-sm btn-secondary" data-edit="${e.id}">${p("edit",14)}</button>
              <button class="btn btn-sm btn-secondary" data-del="${e.id}" style="color:var(--critical)">${p("delete",14)}</button>
            </div>`).join("")}</div>`}
        ${a!==null?`<div style="padding:var(--sp-lg)"><div class="card card-body">
          <h3 style="margin-bottom:var(--sp-lg)">${a.id?"Edit":"New"} Plan</h3>
          <form id="plan-form" style="display:flex;flex-direction:column;gap:var(--sp-md)">
            ${c({id:"pl-name",label:"Name",value:a.name||"",required:!0,placeholder:"e.g. Monthly"})}
            ${c({id:"pl-days",label:"Duration (days)",type:"number",value:a.duration_days||"30",required:!0})}
            ${c({id:"pl-price",label:"Price",type:"number",value:a.price||"",required:!0})}
            <div style="display:flex;gap:var(--sp-sm)">
              <button type="submit" class="btn btn-primary" style="flex:1">Save</button>
              <button type="button" class="btn btn-secondary" id="plan-cancel">Cancel</button>
            </div>
          </form></div></div>`:""}
      </div></div>`,f(t,{onBack:()=>g.pop(),actions:[{onClick:()=>{a={},n()}}]}),t.querySelector("#add-plan")?.addEventListener("click",()=>{a={},n()}),t.querySelectorAll("[data-edit]").forEach(e=>e.addEventListener("click",s=>{s.stopPropagation(),a=l.find(i=>String(i.id)===e.dataset.edit)||{},n()})),t.querySelectorAll("[data-del]").forEach(e=>e.addEventListener("click",async s=>{if(s.stopPropagation(),await $({title:"Delete Plan",message:"Remove this plan?",confirmText:"Delete",destructive:!0})){const r=await d(`/api/mobile/v1/plans/${e.dataset.del}`,{method:"DELETE"});u(r.ok?"Deleted":r.error.message,r.ok?"success":"error"),r.ok&&o()}})),t.querySelector("#plan-cancel")?.addEventListener("click",()=>{a=null,n()}),t.querySelector("#plan-form")?.addEventListener("submit",async e=>{e.preventDefault();const s={name:t.querySelector("#pl-name").value.trim(),duration_days:Number(t.querySelector("#pl-days").value),price:t.querySelector("#pl-price").value},i=a.id?await d(`/api/mobile/v1/plans/${a.id}`,{method:"PATCH",body:s}):await d("/api/mobile/v1/plans",{method:"POST",body:s});u(i.ok?"Saved!":i.error.message,i.ok?"success":"error"),i.ok&&(a=null,o())})}await o()}};export{k as default};
