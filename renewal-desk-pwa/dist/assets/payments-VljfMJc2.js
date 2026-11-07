import{a as A,x as T,i as M,b as R,n as L,e as q,y as I,s as k,z as _,v as H,m as j,k as p,A as B,E as N,d as U,g as D}from"./index-BBUNrwaw.js";const K={async mount(r){let s=[],o=1,i=0,c="all",f=!1,v="";r.innerHTML=`
      ${A({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
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
      <div class="scroll-view" id="payments-list">${T()}</div>
      <button class="fab" id="fab-pay">${M("add",24,"white")}</button>`,R(r,{actions:[{onClick:()=>L.push("record-payment")}]}),r.querySelector("#fab-pay").addEventListener("click",()=>L.push("record-payment"));let g;r.querySelector("#pay-search").addEventListener("input",a=>{clearTimeout(g),g=setTimeout(()=>{v=a.target.value,o=1,n()},400)}),r.querySelector("#pay-filters").addEventListener("click",a=>{const t=a.target.closest(".filter-chip");t&&(r.querySelectorAll(".filter-chip").forEach($=>$.classList.remove("active")),t.classList.add("active"),c=t.dataset.filter,o=1,s=[],n())});let S=0,h=!1,b=null;function P(){const a=r.querySelector("#pay-count");a&&b&&(a.textContent=`Showing ${p(s.length)} of ${p(i)} payment${i!==1?"s":""} · last updated ${D(b)}`)}async function n(a=!1,t=!1){if(a&&f||t&&(f||s.length>=i))return;const $=++S;f=!0;const l=r.querySelector("#payments-list");!a&&!t&&(l.innerHTML=T());const y=t?o+1:o;let m=`/api/mobile/v1/payments?page=${y}&page_size=20`;c!=="all"&&(m+=`&status=${c}`),v.trim()&&(m+=`&q=${encodeURIComponent(v.trim())}`);const z=a?Array.from({length:y},(e,u)=>m.replace(`page=${y}&`,`page=${u+1}&`)):[m],[d,E]=await Promise.all([Promise.all(z.map(e=>q(e))).then(e=>{const u=e.find(w=>!w.ok)||e[0];return u.ok?{ok:!0,data:{payments:e.flatMap(w=>w.data.payments||[]),pagination:e[0].data.pagination}}:u}),o===1?q("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if($!==S)return;if(f=!1,!d.ok){if(d.error.status===401)return I();if(t){k(d.error?.message||"Could not load more payments.","error");return}if(a){h||(h=!0,k("Could not refresh the payment list — showing the last loaded payments.","error")),P();return}l.innerHTML=_(d.error.message),l.querySelector("#retry-btn")?.addEventListener("click",()=>n());return}h=!1,b=new Date;const x=d.data.payments||[];if(s=t?H([...s,...x],e=>e.id):H(x,e=>e.id),i=d.data.pagination?.total??s.length,t&&(o=y),E?.ok){const e=E.data;r.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${j(e.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${e.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${p(e.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(s.length===0){l.innerHTML=B({icon:"payments",title:"No payments",text:c!=="all"?`No ${c} payments found`:"Record your first payment"});return}const C=s.length>=i;l.innerHTML=`<div class="scroll-content">
        <div id="pay-count" style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">Showing ${p(s.length)} of ${p(i)} payment${i!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${s.map(e=>N(e)).join("")}</div>
        ${C?"":'<div style="padding:var(--sp-lg);text-align:center"><button class="btn btn-secondary" id="pay-more">Load more</button></div>'}
      </div>`,l.querySelectorAll("[data-payment-id]").forEach(e=>{e.addEventListener("click",()=>L.push("payment-detail",{paymentId:e.dataset.paymentId}))}),l.querySelector("#pay-more")?.addEventListener("click",()=>{n(!1,!0)})}r.querySelector("#payments-list").addEventListener("scroll",a=>{const t=a.currentTarget;f||s.length>=i||t.scrollTop+t.clientHeight>=t.scrollHeight-200&&n(!1,!0)}),await n(),U(r,()=>n(!0),3e4,()=>clearTimeout(g))}};export{K as default};
