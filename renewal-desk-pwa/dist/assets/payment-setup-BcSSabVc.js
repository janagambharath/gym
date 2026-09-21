import{k as u,a as m,r as l,b,s as a,n as p,p as y}from"./index-B7qIMgpI.js";const f={async mount(e){const r=await u("/api/mobile/v1/settings/payment"),n=r.ok&&r.data?r.data:{};e.innerHTML=`
      ${m({title:"Payment Setup",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="ps-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${l({id:"ps-upi",label:"UPI ID / VPA *",value:n.upi_id||"",placeholder:"e.g. yourgym@okhdfcbank",required:!0})}
          ${l({id:"ps-label",label:"Payment Label",value:n.payment_label||"",placeholder:"Displayed to members (e.g. Gym Name)"})}
          ${l({id:"ps-inst",label:"Instructions",type:"textarea",value:n.instructions||"",placeholder:"Payment instructions for members"})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="ps-submit">Save Settings</button>
        </form>
      </div></div>`,b(e,{onBack:()=>p.pop()}),e.querySelector("#ps-form").addEventListener("submit",async d=>{d.preventDefault();const i=e.querySelector("#ps-upi"),o=i.value.trim();if(!o){a("Please enter a UPI ID","error"),i.focus();return}if(!o.includes("@")){a("Invalid UPI ID format (must contain @, e.g. name@okaxis)","error"),i.focus();return}const t=e.querySelector("#ps-submit");t.disabled=!0,t.textContent="Saving...";const c={upi_id:o,payment_label:e.querySelector("#ps-label").value.trim()||null,instructions:e.querySelector("#ps-inst").value.trim()||null,is_active:!0};try{const s=await u("/api/mobile/v1/settings/payment",{method:"PUT",body:c});if(s.ok)a("Payment settings saved successfully!","success"),setTimeout(()=>p.pop(),500);else{if(s.error?.status===401){y();return}a(s.error?.message||"Failed to save payment settings","error"),t.disabled=!1,t.textContent="Save Settings"}}catch(s){a(s.message||"Network error","error"),t.disabled=!1,t.textContent="Save Settings"}})}};export{f as default};
