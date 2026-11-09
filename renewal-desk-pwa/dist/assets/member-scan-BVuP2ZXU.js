import{a as y,i,b as p,e as u,M as v,n as d,s as c}from"./index-Dt9-M7Kn.js";const b={mount(s){s.innerHTML=`${y({title:"Scan Document",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content" style="text-align:center">
    <div style="width:80px;height:80px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-xl)">${i("camera",36,"var(--success)")}</div>
    <h3 style="margin-bottom:var(--sp-sm)">Scan a Register Page</h3>
    <p style="color:var(--text-secondary);margin-bottom:var(--sp-xxl)">Take a photo of your physical member register. AI will extract member details automatically.</p>
    <label class="btn btn-primary btn-lg btn-full" id="ms-photo-label" style="cursor:pointer">
      ${i("camera",18,"white")} Take Photo
      <input type="file" accept="image/*" capture="environment" id="ms-file" style="display:none">
    </label>
    <div style="margin-top:var(--sp-lg)">
      <label class="btn btn-secondary btn-full" id="ms-gallery-label" style="cursor:pointer">
        ${i("upload",16)} Choose from Gallery
        <input type="file" accept="image/*" id="ms-gallery" style="display:none">
      </label>
    </div>
    <div id="ms-preview" class="hidden" style="margin-top:var(--sp-xl)"></div>
  </div></div>`,p(s,{onBack:()=>d.pop()});let l=!1;const n=e=>{for(const a of["#ms-file","#ms-gallery"]){const r=s.querySelector(a);r&&(r.disabled=!e)}for(const a of["#ms-photo-label","#ms-gallery-label"]){const r=s.querySelector(a);r&&(r.style.opacity=e?"":"0.5")}},m=e=>new Promise((a,r)=>{const t=new FileReader;t.onload=()=>a(t.result),t.onerror=()=>r(new Error("Could not read image")),t.readAsDataURL(e)}),o=async e=>{if(!e||l)return;l=!0,n(!1);const a=s.querySelector("#ms-preview");a.classList.remove("hidden"),a.innerHTML='<div class="full-loader"><div class="spinner"></div><div class="full-loader-text">Analyzing image with AI...</div></div>';try{const r=await m(e),t=await u("/api/mobile/v1/members/scan",{method:"POST",body:{images:[r]},headers:{"Idempotency-Key":v()}});if(t.ok&&t.data?.members){d.replace("member-scan-review",{members:JSON.stringify(t.data.members)});return}c(t.error?.message||"Scan failed","error"),a.classList.add("hidden")}catch{c("Could not read that image — try again","error"),a.classList.add("hidden")}finally{l=!1,n(!0)}};s.querySelector("#ms-file").addEventListener("change",e=>o(e.target.files[0])),s.querySelector("#ms-gallery").addEventListener("change",e=>o(e.target.files[0]))}};export{b as default};
