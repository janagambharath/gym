import{a as l,i,r,b as n,c as o,s as u,h as d,n as c}from"./index-DcA9rnoc.js";const m={mount(e){e.innerHTML=`
      ${l({title:"Create Account",showBack:!0})}
      <div class="scroll-view auth-scroll">
        <div class="auth-container" style="padding-top:var(--sp-md)">
          <div id="signup-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">
            ${i("alert",16)} <span id="signup-error-text"></span>
          </div>
          <form id="signup-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
            ${r({id:"s-name",label:"Full Name",placeholder:"John Doe",required:!0})}
            ${r({id:"s-email",label:"Email",type:"email",placeholder:"you@example.com",required:!0})}
            ${r({id:"s-phone",label:"Phone",type:"tel",placeholder:"+91 98765 43210",required:!0})}
            ${r({id:"s-password",label:"Password",type:"password",placeholder:"Min 6 characters",required:!0})}
            ${r({id:"s-gym",label:"Gym Name",placeholder:"My Fitness Studio",required:!0})}
            ${r({id:"s-country",label:"Country",options:[{value:"India",label:"India"},{value:"UAE",label:"UAE"},{value:"United States",label:"United States"},{value:"United Kingdom",label:"United Kingdom"},{value:"Australia",label:"Australia"}],required:!0})}
            <button type="submit" class="btn btn-primary btn-lg btn-full" id="signup-submit">Create Account</button>
          </form>
        </div>
      </div>`,n(e,{onBack:()=>c.pop()}),e.querySelector("#signup-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector("#signup-submit");t.disabled=!0,t.textContent="Creating...";const a=await o({fullName:e.querySelector("#s-name").value.trim(),email:e.querySelector("#s-email").value.trim(),phone:e.querySelector("#s-phone").value.trim(),password:e.querySelector("#s-password").value,gymName:e.querySelector("#s-gym").value.trim(),country:e.querySelector("#s-country").value});a.ok?(u("Account created!","success"),d()):(e.querySelector("#signup-error-text").textContent=a.error.message,e.querySelector("#signup-error").classList.remove("hidden"),t.disabled=!1,t.textContent="Create Account")})}};export{m as default};
