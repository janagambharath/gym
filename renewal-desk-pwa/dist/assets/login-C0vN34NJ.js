import{i as p,r as c,l as g,s as v,h as b,n as y}from"./index-BQ5hDMiM.js";const x={mount(e){e.innerHTML=`
      <div class="scroll-view auth-scroll">
        <div class="auth-container">
          
          <!-- Branding -->
          <div style="text-align:center;margin-bottom:var(--sp-2xl)">
            <img src="/icons/logo.png" alt="RRR" style="width:72px;height:72px;border-radius:var(--r-xxl);margin:0 auto var(--sp-md);display:block;object-fit:contain">
            <h1 style="font-size:var(--fs-4xl);margin-bottom:var(--sp-xs)">RRR</h1><p style="color:var(--muted);font-size:var(--fs-sm);margin:0">Gym Growth System</p>
            <p style="color:var(--muted);font-size:var(--fs-sm);margin:0">Your gym management command center</p>
          </div>

          <!-- Form Card -->
          <div class="card" style="padding:var(--sp-xl)">
            <h2 style="font-size:var(--fs-2xl);margin-bottom:var(--sp-xs)">Sign in</h2>
            <p style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-lg)">Enter your credentials to continue</p>

            <div id="login-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">
              ${p("alert",16)} <span id="login-error-text"></span>
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
          <div style="text-align:center;margin-top:var(--sp-xl);display:flex;flex-direction:column;gap:var(--sp-sm)">
            <button class="btn btn-outline btn-full" id="goto-signup">
              Create a new account
            </button>
            <button style="color:var(--brand);font-size:var(--fs-sm);font-weight:var(--fw-semibold);padding:var(--sp-sm);background:none;border:none;cursor:pointer" id="goto-vynla">
              I'm a gym member → Open VYNLA
            </button>
          </div>
        </div>
      </div>`;const m=e.querySelector("#login-form"),r=e.querySelector("#login-error"),u=e.querySelector("#login-error-text"),n=e.querySelector("#login-submit"),s=e.querySelector("#login-submit-text"),o=e.querySelector("#login-submit-spinner");function i(t){u.textContent=t,r.classList.remove("hidden")}m.addEventListener("submit",async t=>{t.preventDefault();const a=e.querySelector("#login-email").value.trim(),l=e.querySelector("#login-password").value;if(!a||!l){i("Email and password are required.");return}n.disabled=!0,s.textContent="Signing in...",o.classList.remove("hidden"),r.classList.add("hidden");const d=await g(a,l);d.ok?(v("Welcome back!","success"),b()):(i(d.error.message),n.disabled=!1,s.textContent="Sign In",o.classList.add("hidden"))}),e.querySelectorAll(".form-input").forEach(t=>{t.addEventListener("input",()=>r.classList.add("hidden"))}),e.querySelector("#goto-signup")?.addEventListener("click",()=>y.push("signup")),e.querySelector("#goto-vynla")?.addEventListener("click",()=>{window.location.href="/vynla"})}};export{x as default};
