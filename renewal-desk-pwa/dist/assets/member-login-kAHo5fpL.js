import{a as c,i as l,r as i,b as u,n as d,m,d as b,s as h}from"./index-DBor-WEA.js";const v={mount(e){let t="phone",p="",o="";const n=()=>{e.innerHTML=`
        ${c({title:"Member Login",showBack:!0})}
        <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
          <div style="text-align:center;margin-bottom:var(--sp-xxl)">
            <div style="width:64px;height:64px;border-radius:var(--r-full);background:var(--whatsapp);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">${l("whatsapp",32,"white")}</div>
            <h2>${t==="phone"?"Enter your phone number":"Enter OTP"}</h2>
            <p style="color:var(--text-secondary)">${t==="phone"?"We'll send a verification code via WhatsApp":`Code sent to ${o}`}</p>
          </div>
          <div id="otp-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">${l("alert",16)} <span id="otp-error-text"></span></div>
          ${t==="phone"?`
            <form id="phone-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
              ${i({id:"ml-phone",label:"Phone Number",type:"tel",placeholder:"9876543210",required:!0})}
              ${i({id:"ml-slug",label:"Gym Code",placeholder:"your-gym-slug",required:!0,hint:"Ask your gym owner for the code"})}
              <button type="submit" class="btn btn-whatsapp btn-lg btn-full">${l("send",18,"white")} Send OTP</button>
            </form>
          `:`
            <form id="otp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
              ${i({id:"ml-otp",label:"Verification Code",placeholder:"123456",required:!0})}
              <button type="submit" class="btn btn-primary btn-lg btn-full">Verify & Login</button>
              <button type="button" class="btn btn-secondary btn-full" id="otp-back">Change Number</button>
            </form>
          `}
        </div></div>`,u(e,{onBack:()=>d.pop()}),t==="phone"?e.querySelector("#phone-form").addEventListener("submit",async s=>{s.preventDefault(),o=e.querySelector("#ml-phone").value.trim();const a=e.querySelector("#ml-slug").value.trim(),r=await m(o,a);r.ok?(p=r.data.challenge_token,t="otp",n()):(e.querySelector("#otp-error-text").textContent=r.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}):(e.querySelector("#otp-form").addEventListener("submit",async s=>{s.preventDefault();const a=e.querySelector("#ml-otp").value.trim(),r=await b(o,a,p);r.ok?(h("Welcome!","success"),d.push("member-home")):(e.querySelector("#otp-error-text").textContent=r.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}),e.querySelector("#otp-back")?.addEventListener("click",()=>{t="phone",n()}))};n()}};export{v as default};
