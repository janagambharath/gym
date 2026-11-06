import{a as u,i as d,r as p,b as f,n as c,m,d as v,e as y,s as b}from"./index-ByhK-z4i.js";const g={mount(e){let n="phone",i="",a="";const l=()=>{e.innerHTML=`
        ${u({title:"Member Login",showBack:!0})}
        <div class="scroll-view auth-scroll">
          <div class="auth-container" style="padding-top:var(--sp-md)">
            <div style="text-align:center;margin-bottom:var(--sp-xl)">
              <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--whatsapp);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${d("whatsapp",28,"white")}</div>
              <h2 style="font-size:var(--fs-2xl);margin-bottom:var(--sp-xs)">${n==="phone"?"Enter phone number":"Enter OTP"}</h2>
              <p style="color:var(--text-secondary);font-size:var(--fs-sm)">${n==="phone"?"We'll send a verification code via WhatsApp":`Code sent to ${a}`}</p>
            </div>
            <div id="otp-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">${d("alert",16)} <span id="otp-error-text"></span></div>
            ${n==="phone"?`
              <form id="phone-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
                ${p({id:"ml-phone",label:"Mobile Number",type:"tel",placeholder:"9876543210",required:!0})}
                <button type="submit" class="btn btn-whatsapp btn-lg btn-full">${d("send",18,"white")} Send OTP</button>
                <div style="text-align:center;margin-top:var(--sp-sm)">
                  <a href="/vynla" style="color:var(--brand);font-size:var(--fs-sm);text-decoration:none;font-weight:var(--fw-semibold)">Open VYNLA Member App →</a>
                </div>
              </form>
            `:`
              <form id="otp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
                ${p({id:"ml-otp",label:"Verification Code",placeholder:"123456",required:!0})}
                <button type="submit" class="btn btn-primary btn-lg btn-full">Verify & Login</button>
                <div style="display:flex;gap:var(--sp-sm)">
                  <button type="button" class="btn btn-secondary btn-full" id="otp-resend">Resend Code</button>
                  <button type="button" class="btn btn-secondary btn-full" id="otp-back">Change Number</button>
                </div>
              </form>
            `}
          </div>
        </div>`,f(e,{onBack:()=>c.pop()}),n==="phone"?e.querySelector("#phone-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector('#phone-form button[type="submit"]');if(t.disabled)return;t.disabled=!0,a=e.querySelector("#ml-phone").value.trim();const r=await m(a);t.disabled=!1,r.ok?(i=r.data.challenge||r.data.challenge_token,n="otp",l()):(e.querySelector("#otp-error-text").textContent=r.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}):(e.querySelector("#otp-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector('#otp-form button[type="submit"]');if(t.disabled)return;t.disabled=!0;const r=e.querySelector("#ml-otp").value.trim(),o=await v(a,r,i);t.disabled=!1,o.ok&&o.data?.token?(y({token:o.data.token,refreshToken:o.data.refresh_token,memberId:o.data?.member?.id,memberName:o.data?.member?.full_name}),b("Welcome!","success"),c.push("member-home")):(e.querySelector("#otp-error-text").textContent=o.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}),e.querySelector("#otp-back")?.addEventListener("click",()=>{n="phone",l()}),e.querySelector("#otp-resend")?.addEventListener("click",async s=>{const t=s.currentTarget;if(t.disabled)return;t.disabled=!0;const r=await m(a);t.disabled=!1,r.ok?(i=r.data.challenge||r.data.challenge_token,b("Code resent","success")):(e.querySelector("#otp-error-text").textContent=r.error.message,e.querySelector("#otp-error").classList.remove("hidden"))}))};l()}};export{g as default};
