import{a as u,i as l,r as d,b,n as p,m as c,d as v,e as h,s as m}from"./index-C2gfj6pe.js";const f={mount(e){let r="phone",s="",n="";const i=()=>{e.innerHTML=`
        ${u({title:"Member Login",showBack:!0})}
        <div class="scroll-view auth-scroll">
          <div class="auth-container" style="padding-top:var(--sp-md)">
            <div style="text-align:center;margin-bottom:var(--sp-xl)">
              <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--whatsapp);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${l("whatsapp",28,"white")}</div>
              <h2 style="font-size:var(--fs-2xl);margin-bottom:var(--sp-xs)">${r==="phone"?"Enter phone number":"Enter OTP"}</h2>
              <p style="color:var(--text-secondary);font-size:var(--fs-sm)">${r==="phone"?"We'll send a verification code via WhatsApp":`Code sent to ${n}`}</p>
            </div>
            <div id="otp-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">${l("alert",16)} <span id="otp-error-text"></span></div>
            ${r==="phone"?`
              <form id="phone-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
                ${d({id:"ml-phone",label:"Mobile Number",type:"tel",placeholder:"9876543210",required:!0})}
                <button type="submit" class="btn btn-whatsapp btn-lg btn-full">${l("send",18,"white")} Send OTP</button>
                <div style="text-align:center;margin-top:var(--sp-sm)">
                  <a href="/vynla" style="color:var(--brand);font-size:var(--fs-sm);text-decoration:none;font-weight:var(--fw-semibold)">Open VYNLA Member App →</a>
                </div>
              </form>
            `:`
              <form id="otp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
                ${d({id:"ml-otp",label:"Verification Code",placeholder:"123456",required:!0})}
                <button type="submit" class="btn btn-primary btn-lg btn-full">Verify & Login</button>
                <div style="display:flex;gap:var(--sp-sm)">
                  <button type="button" class="btn btn-secondary btn-full" id="otp-resend">Resend Code</button>
                  <button type="button" class="btn btn-secondary btn-full" id="otp-back">Change Number</button>
                </div>
              </form>
            `}
          </div>
        </div>`,b(e,{onBack:()=>p.pop()}),r==="phone"?e.querySelector("#phone-form").addEventListener("submit",async t=>{t.preventDefault(),n=e.querySelector("#ml-phone").value.trim();const o=await c(n);o.ok?(s=o.data.challenge||o.data.challenge_token,r="otp",i()):(e.querySelector("#otp-error-text").textContent=o.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}):(e.querySelector("#otp-form").addEventListener("submit",async t=>{t.preventDefault();const o=e.querySelector("#ml-otp").value.trim(),a=await v(n,o,s);a.ok&&a.data?.token?(h({token:a.data.token,memberName:a.data?.member?.name}),m("Welcome!","success"),p.push("member-home")):(e.querySelector("#otp-error-text").textContent=a.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}),e.querySelector("#otp-back")?.addEventListener("click",()=>{r="phone",i()}),e.querySelector("#otp-resend")?.addEventListener("click",async()=>{const t=await c(n);t.ok?(s=t.data.challenge||t.data.challenge_token,m("Code resent","success")):(e.querySelector("#otp-error-text").textContent=t.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}))};i()}};export{f as default};
