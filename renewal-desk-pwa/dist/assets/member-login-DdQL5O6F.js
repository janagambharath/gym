import{a as c,i as s,r as p,b as m,n as d,m as u,d as b,s as v}from"./index-BxLO4bma.js";const f={mount(e){let t="phone",i="",o="";const n=()=>{e.innerHTML=`
        ${c({title:"Member Login",showBack:!0})}
        <div class="scroll-view auth-scroll">
          <div class="auth-container" style="padding-top:var(--sp-md)">
            <div style="text-align:center;margin-bottom:var(--sp-xl)">
              <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--whatsapp);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${s("whatsapp",28,"white")}</div>
              <h2 style="font-size:var(--fs-2xl);margin-bottom:var(--sp-xs)">${t==="phone"?"Enter phone number":"Enter OTP"}</h2>
              <p style="color:var(--text-secondary);font-size:var(--fs-sm)">${t==="phone"?"We'll send a verification code via WhatsApp":`Code sent to ${o}`}</p>
            </div>
            <div id="otp-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">${s("alert",16)} <span id="otp-error-text"></span></div>
            ${t==="phone"?`
              <form id="phone-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
                ${p({id:"ml-phone",label:"Mobile Number",type:"tel",placeholder:"9876543210",required:!0})}
                <button type="submit" class="btn btn-whatsapp btn-lg btn-full">${s("send",18,"white")} Send OTP</button>
                <div style="text-align:center;margin-top:var(--sp-sm)">
                  <a href="/vynla" style="color:var(--brand);font-size:var(--fs-sm);text-decoration:none;font-weight:var(--fw-semibold)">Open VYNLA Member App →</a>
                </div>
              </form>
            `:`
              <form id="otp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
                ${p({id:"ml-otp",label:"Verification Code",placeholder:"123456",required:!0})}
                <button type="submit" class="btn btn-primary btn-lg btn-full">Verify & Login</button>
                <button type="button" class="btn btn-secondary btn-full" id="otp-back">Change Number</button>
              </form>
            `}
          </div>
        </div>`,m(e,{onBack:()=>d.pop()}),t==="phone"?e.querySelector("#phone-form").addEventListener("submit",async a=>{a.preventDefault(),o=e.querySelector("#ml-phone").value.trim();const r=await u(o);r.ok?(i=r.data.challenge||r.data.challenge_token,t="otp",n()):(e.querySelector("#otp-error-text").textContent=r.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}):(e.querySelector("#otp-form").addEventListener("submit",async a=>{a.preventDefault();const r=e.querySelector("#ml-otp").value.trim(),l=await b(o,r,i);l.ok?(v("Welcome!","success"),d.push("member-home")):(e.querySelector("#otp-error-text").textContent=l.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}),e.querySelector("#otp-back")?.addEventListener("click",()=>{t="phone",n()}))};n()}};export{f as default};
