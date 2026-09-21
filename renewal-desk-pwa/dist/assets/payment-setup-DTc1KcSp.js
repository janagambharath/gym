import{k as l,a as i,r as s,b as o,s as p,n as u}from"./index-1Q0YpctZ.js";const d={async mount(e){const r=await l("/api/mobile/v1/settings"),t=r.ok?r.data.payment_settings||{}:{};e.innerHTML=`${i({title:"Payment Setup",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="ps-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${s({id:"ps-upi",label:"UPI ID",value:t.upi_id||"",placeholder:"yourname@upi"})}
      ${s({id:"ps-label",label:"Payment Label",value:t.payment_label||"",placeholder:"Displayed to members"})}
      ${s({id:"ps-inst",label:"Instructions",type:"textarea",value:t.instructions||"",placeholder:"Payment instructions for members"})}
      <button type="submit" class="btn btn-primary btn-full">Save Settings</button>
    </form></div></div>`,o(e,{onBack:()=>u.pop()}),e.querySelector("#ps-form").addEventListener("submit",async n=>{n.preventDefault();const a=await l("/api/mobile/v1/settings/payment",{method:"PATCH",body:{upi_id:e.querySelector("#ps-upi").value.trim()||null,payment_label:e.querySelector("#ps-label").value.trim()||null,instructions:e.querySelector("#ps-inst").value.trim()||null}});p(a.ok?"Saved!":a.error.message,a.ok?"success":"error")})}};export{d as default};
