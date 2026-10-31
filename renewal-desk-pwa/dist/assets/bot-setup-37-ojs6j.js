import{f as o,a as s,r as a,b as n,s as u,n as c}from"./index-j0NdRznF.js";const p={async mount(e){const t=await o("/api/mobile/v1/bot/config"),r=t.ok?t.data.config||{}:{};e.innerHTML=`${s({title:"Bot Setup",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <form id="bs-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${a({id:"bs-greet",label:"Greeting Message",type:"textarea",value:r.greeting_message||"",placeholder:"Hello! Welcome to our gym. How can I help you?"})}
      ${a({id:"bs-hours",label:"Opening Hours",value:r.opening_hours||"",placeholder:"Mon-Sat 6AM-10PM"})}
      ${a({id:"bs-map",label:"Google Maps Link",value:r.map_link||"",placeholder:"https://maps.google.com/…"})}
      ${a({id:"bs-reg",label:"Registration Link",value:r.registration_link||"",placeholder:"https://…"})}
      ${a({id:"bs-trial-price",label:"Trial Price (₹)",value:r.trial_price||"",placeholder:"0.00"})}
      ${a({id:"bs-trial-days",label:"Trial Duration (days)",value:r.trial_duration_days||"",placeholder:"1"})}
      <button type="submit" class="btn btn-primary btn-full">Save Configuration</button>
    </form>
  </div></div>`,n(e,{onBack:()=>c.pop()}),e.querySelector("#bs-form").addEventListener("submit",async i=>{i.preventDefault();const l=await o("/api/mobile/v1/bot/config",{method:"PATCH",body:{greeting_message:e.querySelector("#bs-greet").value.trim()||null,opening_hours:e.querySelector("#bs-hours").value.trim()||null,map_link:e.querySelector("#bs-map").value.trim()||null,registration_link:e.querySelector("#bs-reg").value.trim()||null,trial_price:e.querySelector("#bs-trial-price").value.trim()||null,trial_duration_days:e.querySelector("#bs-trial-days").value.trim()||null}});u(l.ok?"Saved!":l.error.message,l.ok?"success":"error")})}};export{p as default};
