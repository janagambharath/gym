import{i as u,r as c,l as v,s as b,h as y,n as m}from"./index-DBor-WEA.js";const f={mount(e){e.innerHTML=`
      <div class="scroll-view">
        <div style="padding:var(--sp-4xl) var(--sp-xxl);padding-top:calc(var(--safe-top) + var(--sp-4xl));min-height:100%;display:flex;flex-direction:column;justify-content:center">
          
          <!-- Branding -->
          <div style="text-align:center;margin-bottom:var(--sp-4xl)">
            <img src="/icons/logo.png" alt="Renewal Desk" style="width:80px;height:80px;border-radius:var(--r-xxl);margin:0 auto var(--sp-lg);display:block;object-fit:contain">
            <h1 style="font-size:var(--fs-5xl);margin-bottom:var(--sp-xs)">Renewal Desk</h1>
            <p style="color:var(--muted);font-size:var(--fs-base);margin:0">Your gym management command center</p>
          </div>

          <!-- Form Card -->
          <div class="card" style="padding:var(--sp-xxl)">
            <h2 style="font-size:var(--fs-3xl);margin-bottom:var(--sp-xs)">Sign in</h2>
            <p style="color:var(--text-secondary);margin-bottom:var(--sp-xl)">Enter your credentials to continue</p>

            <div id="login-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">
              ${u("alert",16)} <span id="login-error-text"></span>
            </div>

            <form id="login-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
              ${c({id:"login-email",label:"Email",type:"email",placeholder:"you@example.com",required:!0})}
              ${c({id:"login-password",label:"Password",type:"password",placeholder:"Enter your password",required:!0})}
              
              <button type="submit" class="btn btn-primary btn-lg btn-full" id="login-submit">
                <span id="login-submit-text">Sign In</span>
                <span id="login-submit-spinner" class="spinner spinner-sm spinner-white hidden"></span>
              </button>
            </form>
          </div>

          <!-- Footer Links -->
          <div style="text-align:center;margin-top:var(--sp-xxl);display:flex;flex-direction:column;gap:var(--sp-md)">
            <button class="btn btn-outline btn-full" id="goto-signup">
              Create a new account
            </button>
            <button style="color:var(--brand);font-size:var(--fs-sm);font-weight:var(--fw-semibold);padding:var(--sp-md)" id="goto-member-login">
              I'm a gym member →
            </button>
          </div>
        </div>
      </div>`;const p=e.querySelector("#login-form"),r=e.querySelector("#login-error"),g=e.querySelector("#login-error-text"),n=e.querySelector("#login-submit"),i=e.querySelector("#login-submit-text"),s=e.querySelector("#login-submit-spinner");function o(t){g.textContent=t,r.classList.remove("hidden")}p.addEventListener("submit",async t=>{t.preventDefault();const a=e.querySelector("#login-email").value.trim(),l=e.querySelector("#login-password").value;if(!a||!l){o("Email and password are required.");return}n.disabled=!0,i.textContent="Signing in...",s.classList.remove("hidden"),r.classList.add("hidden");const d=await v(a,l);d.ok?(b("Welcome back!","success"),y()):(o(d.error.message),n.disabled=!1,i.textContent="Sign In",s.classList.add("hidden"))}),e.querySelectorAll(".form-input").forEach(t=>{t.addEventListener("input",()=>r.classList.add("hidden"))}),e.querySelector("#goto-signup")?.addEventListener("click",()=>m.push("signup")),e.querySelector("#goto-member-login")?.addEventListener("click",()=>m.push("member-login"))}};export{f as default};
