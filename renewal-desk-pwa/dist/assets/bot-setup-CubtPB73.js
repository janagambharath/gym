import{g as i,a as n,r,b as u,s as c,n as d}from"./index-ByhK-z4i.js";const p={async mount(e){const o=await i("/api/mobile/v1/bot/config"),a=o.ok?o.data.config||{}:{};e.innerHTML=`${n({title:"Bot Setup",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <form id="bs-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${r({id:"bs-greet",label:"Greeting Message",type:"textarea",value:a.greeting_message||"",placeholder:"Hello! Welcome to our gym. How can I help you?"})}
      ${r({id:"bs-hours",label:"Opening Hours",value:a.opening_hours||"",placeholder:"Mon-Sat 6AM-10PM"})}
      ${r({id:"bs-map",label:"Google Maps Link",value:a.map_link||"",placeholder:"https://maps.google.com/…"})}
      ${r({id:"bs-reg",label:"Registration Link",value:a.registration_link||"",placeholder:"https://…"})}
      ${r({id:"bs-trial-price",label:"Trial Price (₹)",value:a.trial_price||"",placeholder:"0.00"})}
      ${r({id:"bs-trial-days",label:"Trial Duration (days)",value:a.trial_duration_days||"",placeholder:"1"})}
      <button type="submit" class="btn btn-primary btn-full" id="bs-save">Save Configuration</button>
    </form>
  </div></div>`,u(e,{onBack:()=>d.pop()}),e.querySelector("#bs-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector("#bs-save");if(t.disabled)return;t.disabled=!0,t.textContent="Saving…";const l=await i("/api/mobile/v1/bot/config",{method:"PATCH",body:{greeting_message:e.querySelector("#bs-greet").value.trim()||null,opening_hours:e.querySelector("#bs-hours").value.trim()||null,map_link:e.querySelector("#bs-map").value.trim()||null,registration_link:e.querySelector("#bs-reg").value.trim()||null,trial_price:e.querySelector("#bs-trial-price").value.trim()||null,trial_duration_days:e.querySelector("#bs-trial-days").value.trim()||null}});c(l.ok?"Saved!":l.error.message,l.ok?"success":"error"),t.disabled=!1,t.textContent="Save Configuration"})}};export{p as default};
