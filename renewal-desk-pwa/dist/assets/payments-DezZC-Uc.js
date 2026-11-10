import{a as M,x as q,i as A,b as R,n as S,e as x,y as I,s as k,z as j,w as H,p as _,k as f,A as B,E as N,d as U,g as D}from"./index-ClFlXszA.js";const K={async mount(a){let s=[],o=1,n=0,c="all",y=!1,g="";a.innerHTML=`
      ${M({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
      <div id="pay-summary"></div>
      <div style="padding:0 var(--sp-lg) var(--sp-sm)">
        <input id="pay-search" class="search-input" type="search" placeholder="Search member, amount, reference…" autocomplete="off">
      </div>
      <div class="filter-chips" id="pay-filters">
        <button class="filter-chip active" data-filter="all">All</button>
        <button class="filter-chip" data-filter="pending">Pending</button>
        <button class="filter-chip" data-filter="verified">Verified</button>
        <button class="filter-chip" data-filter="rejected">Rejected</button>
      </div>
      <div class="scroll-view" id="payments-list">${q()}</div>
      <button class="fab" id="fab-pay">${A("add",24,"white")}</button>`,R(a,{actions:[{onClick:()=>S.push("record-payment")}]}),a.querySelector("#fab-pay").addEventListener("click",()=>S.push("record-payment"));let h;a.querySelector("#pay-search").addEventListener("input",r=>{clearTimeout(h),h=setTimeout(()=>{g=r.target.value,o=1,i()},400)}),a.querySelector("#pay-filters").addEventListener("click",r=>{const t=r.target.closest(".filter-chip");t&&(a.querySelectorAll(".filter-chip").forEach($=>$.classList.remove("active")),t.classList.add("active"),c=t.dataset.filter,o=1,s=[],i())});let E=0,b=!1,w=null;function z(){const r=a.querySelector("#pay-count");r&&w&&(r.textContent=`Showing ${f(s.length)} of ${f(n)} payment${n!==1?"s":""} · last updated ${D(w)}`)}async function i(r=!1,t=!1){if(r&&y||t&&(y||s.length>=n))return;const $=++E;y=!0;const l=a.querySelector("#payments-list");!r&&!t&&(l.innerHTML=q());const m=t?o+1:o;let u=`/api/mobile/v1/payments?page=${m}&page_size=20`;c!=="all"&&(u+=`&status=${c}`),g.trim()&&(u+=`&q=${encodeURIComponent(g.trim())}`);const P=r?Array.from({length:m},(e,v)=>u.replace(`page=${m}&`,`page=${v+1}&`)):[u],[d,p]=await Promise.all([Promise.all(P.map(e=>x(e))).then(e=>{const v=e.find(L=>!L.ok)||e[0];return v.ok?{ok:!0,data:{payments:e.flatMap(L=>L.data.payments||[]),pagination:e[0].data.pagination}}:v}),o===1?x("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if($!==E)return;if(y=!1,!d.ok){if(d.error.status===401)return I();if(t){k(d.error?.message||"Could not load more payments.","error");return}if(r){b||(b=!0,k("Could not refresh the payment list — showing the last loaded payments.","error")),z();return}l.innerHTML=j(d.error.message),l.querySelector("#retry-btn")?.addEventListener("click",()=>i());return}b=!1,w=new Date;const T=d.data.payments||[];if(s=t?H([...s,...T],e=>e.id):H(T,e=>e.id),n=d.data.pagination?.total??s.length,t&&(o=m),o===1&&p&&!p.ok&&(a.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg)"><div class="card card-body" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-md);background:var(--warning-surface,#fef3c7)">
            <span style="font-size:var(--fs-sm);color:var(--warning,#92400e)">Could not load the payment summary (${p.error?.message||"check your connection"}).</span>
            <button class="btn btn-sm btn-secondary" id="pay-summary-retry">Try again</button>
          </div></div>`,a.querySelector("#pay-summary-retry")?.addEventListener("click",()=>i())),p?.ok){const e=p.data;a.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${_(e.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${e.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${f(e.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(s.length===0){l.innerHTML=B({icon:"payments",title:"No payments",text:c!=="all"?`No ${c} payments found`:"Record your first payment"});return}const C=s.length>=n;l.innerHTML=`<div class="scroll-content">
        <div id="pay-count" style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">Showing ${f(s.length)} of ${f(n)} payment${n!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${s.map(e=>N(e)).join("")}</div>
        ${C?"":'<div style="padding:var(--sp-lg);text-align:center"><button class="btn btn-secondary" id="pay-more">Load more</button></div>'}
      </div>`,l.querySelectorAll("[data-payment-id]").forEach(e=>{e.addEventListener("click",()=>S.push("payment-detail",{paymentId:e.dataset.paymentId}))}),l.querySelector("#pay-more")?.addEventListener("click",()=>{i(!1,!0)})}a.querySelector("#payments-list").addEventListener("scroll",r=>{const t=r.currentTarget;y||s.length>=n||t.scrollTop+t.clientHeight>=t.scrollHeight-200&&i(!1,!0)}),await i(),U(a,()=>i(!0),3e4,()=>clearTimeout(h))}};export{K as default};
