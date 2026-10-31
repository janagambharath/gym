import{a as g,q as m,i as h,b,n as p,f,t as L,u as $,k as x,j as u,v as w,z as S}from"./index-pUkAnkn_.js";const E={async mount(t){let n=[],d=1,l=0,i="all",o="";t.innerHTML=`
      ${g({title:"Payments",showBack:!0,actions:[{icon:"add",label:"Record"}]})}
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
      <div class="scroll-view" id="payments-list">${m()}</div>
      <button class="fab" id="fab-pay">${h("add",24,"white")}</button>`,b(t,{actions:[{onClick:()=>p.push("record-payment")}]}),t.querySelector("#fab-pay").addEventListener("click",()=>p.push("record-payment"));let v;t.querySelector("#pay-search").addEventListener("input",e=>{clearTimeout(v),v=setTimeout(()=>{o=e.target.value,d=1,c()},400)}),t.querySelector("#pay-filters").addEventListener("click",e=>{const r=e.target.closest(".filter-chip");r&&(t.querySelectorAll(".filter-chip").forEach(s=>s.classList.remove("active")),r.classList.add("active"),i=r.dataset.filter,d=1,n=[],c())});async function c(){const e=t.querySelector("#payments-list");e.innerHTML=m();let r=`/api/mobile/v1/payments?page=${d}&page_size=20`;i!=="all"&&(r+=`&status=${i}`),o.trim()&&(r+=`&q=${encodeURIComponent(o.trim())}`);const[s,y]=await Promise.all([f(r),d===1?f("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if(!s.ok){if(s.error.status===401)return L();e.innerHTML=$(s.error.message);return}if(n=s.data.payments||[],l=s.data.pagination?.total||0,y?.ok){const a=y.data;t.querySelector("#pay-summary").innerHTML=`
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${x(a.today?.total_collected||"0")}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${a.pending?.count||0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${u(a.today?.payment_count||0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`}if(n.length===0){e.innerHTML=w({icon:"payments",title:"No payments",text:i!=="all"?`No ${i} payments found`:"Record your first payment"});return}e.innerHTML=`<div class="scroll-content">
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${u(l)} payment${l!==1?"s":""}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${n.map(a=>S(a)).join("")}</div>
      </div>`,e.querySelectorAll("[data-payment-id]").forEach(a=>{a.addEventListener("click",()=>p.push("payment-detail",{paymentId:a.dataset.paymentId}))})}await c()}};export{E as default};
