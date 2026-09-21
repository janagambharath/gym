import{k as o,a as i,r,b as n,s as u,n as c}from"./index-D6Fm9ZNQ.js";const b={async mount(e){const l=await o("/api/mobile/v1/bot/config"),a=l.ok?l.data:{};e.innerHTML=`${i({title:"Bot Setup",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="bs-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${r({id:"bs-greet",label:"Greeting Message",type:"textarea",value:a.greeting_message||"",placeholder:"Hello! Welcome to our gym. How can I help you?"})}
      ${r({id:"bs-hours",label:"Business Hours",value:a.business_hours||"",placeholder:"Mon-Sat 6AM-10PM"})}
      ${r({id:"bs-loc",label:"Location / Address",type:"textarea",value:a.location||"",placeholder:"Gym address"})}
      ${r({id:"bs-trial",label:"Trial Offer",value:a.trial_offer||"",placeholder:"Free 1-day trial available!"})}
      ${r({id:"bs-faq",label:"FAQ (one per line)",type:"textarea",value:a.faq||"",placeholder:"Q: What are your hours?\\nA: Mon-Sat 6AM-10PM"})}
      <button type="submit" class="btn btn-primary btn-full">Save Configuration</button>
    </form>
  </div></div>`,n(e,{onBack:()=>c.pop()}),e.querySelector("#bs-form").addEventListener("submit",async s=>{s.preventDefault();const t=await o("/api/mobile/v1/bot/config",{method:"PATCH",body:{greeting_message:e.querySelector("#bs-greet").value.trim()||null,business_hours:e.querySelector("#bs-hours").value.trim()||null,location:e.querySelector("#bs-loc").value.trim()||null,trial_offer:e.querySelector("#bs-trial").value.trim()||null,faq:e.querySelector("#bs-faq").value.trim()||null}});u(t.ok?"Saved!":t.error.message,t.ok?"success":"error")})}};export{b as default};
