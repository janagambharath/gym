import{a as S,i as x,z as $,b as T,n as m,k as v,p as k,o as j,t as w,u as P,A as z,f as q,e as g,w as R,x as A,E as L,s as p}from"./index-1Q0YpctZ.js";const C={async mount(s){let y=[],c=1,f=0,o="all",u="";s.innerHTML=`
      ${S({title:"Payments",showBack:!1,actions:[{icon:"add",label:"Record"}]})}
      <div class="scroll-view" id="payments-scroll">
        <div class="scroll-content">
          <!-- Summary Cards -->
          <div id="pay-summary" style="padding:0 var(--sp-lg) var(--sp-sm)"></div>

          <!-- Search & Filters -->
          <div style="padding:0 var(--sp-lg) var(--sp-sm)">
            <div class="search-box" style="margin-bottom:var(--sp-sm)">
              ${x("search",18,"var(--muted)")}
              <input type="text" class="search-input" id="pay-search-input" placeholder="Search by member or phone...">
            </div>
            <div class="filter-chips" id="pay-status-chips" style="margin-bottom:var(--sp-xs)">
              <button class="filter-chip active" data-filter="all">All</button>
              <button class="filter-chip" data-filter="pending">Pending</button>
              <button class="filter-chip" data-filter="verified">Verified</button>
              <button class="filter-chip" data-filter="rejected">Rejected</button>
            </div>
          </div>

          <!-- Payment List Container -->
          <div id="payments-list" style="padding:0 var(--sp-lg) var(--sp-lg)">
            ${$()}
          </div>
        </div>
      </div>
      <button class="fab" id="fab-pay" aria-label="Record Payment">${x("add",24,"#ffffff")}</button>`,T(s,{onBack:()=>m.switchTab("dashboard"),actions:[{onClick:()=>m.push("record-payment")}]}),s.querySelector("#fab-pay")?.addEventListener("click",()=>m.push("record-payment")),s.querySelector("#pay-status-chips")?.addEventListener("click",t=>{const i=t.target.closest(".filter-chip");i&&(s.querySelectorAll("#pay-status-chips .filter-chip").forEach(r=>r.classList.remove("active")),i.classList.add("active"),o=i.dataset.filter,c=1,d())});let b;s.querySelector("#pay-search-input")?.addEventListener("input",t=>{clearTimeout(b),b=setTimeout(()=>{u=t.target.value.trim(),c=1,d()},300)});async function d(){const t=s.querySelector("#payments-list");if(!t)return;t.innerHTML=$();let i=`/api/mobile/v1/payments?page=${c}&page_size=20`;o!=="all"&&(i+=`&status=${o}`),u&&(i+=`&q=${encodeURIComponent(u)}`);const[r,h]=await Promise.all([v(i),c===1?v("/api/mobile/v1/payments/summary"):Promise.resolve(null)]);if(!r.ok){if(r.error.status===401)return k();t.innerHTML=j(r.error.message);return}if(y=r.data.payments||[],f=r.data.pagination?.total||0,h?.ok){const e=h.data,a=s.querySelector("#pay-summary");a&&(a.innerHTML=`
            <div class="card card-body" style="padding:var(--sp-md)">
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-sm);text-align:center">
                <div>
                  <div style="font-size:var(--fs-xl);font-weight:var(--fw-extrabold);color:var(--success)">${w(e.today?.total_collected||"0")}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
                </div>
                <div style="border-left:1px solid var(--border);border-right:1px solid var(--border)">
                  <div style="font-size:var(--fs-xl);font-weight:var(--fw-extrabold);color:var(--status-pending)">${e.pending?.count||0}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
                </div>
                <div>
                  <div style="font-size:var(--fs-xl);font-weight:var(--fw-extrabold);color:var(--brand)">${P(e.today?.payment_count||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
                </div>
              </div>
            </div>`)}if(y.length===0){t.innerHTML=z({icon:"payments",title:"No payments found",text:o!=="all"?`No ${o} payments matching current filters`:"Record your first member payment fee collection"});return}t.innerHTML=`
        <div style="padding-bottom:var(--sp-xs);font-size:var(--fs-xs);color:var(--muted)">${P(f)} payment${f!==1?"s":""}</div>
        <div class="card">
          ${y.map(e=>{const a=e.status==="pending"||e.status==="processing",n=e.channel==="online";return`
              <div class="list-item" data-payment-id="${e.id}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:var(--sp-sm);padding:var(--sp-md)">
                <div style="display:flex;align-items:center;gap:var(--sp-md)">
                  ${q(e.member_name||"M","md")}
                  <div class="list-item-content">
                    <div style="display:flex;align-items:center;gap:var(--sp-xs)">
                      <span class="list-item-title">${g(e.member_name||`Member #${e.member_id}`)}</span>
                      <span class="badge ${n?"badge-active":"badge-info"}" style="font-size:9px;padding:1px 6px">${n?"VYNLA":"Counter"}</span>
                    </div>
                    ${e.member_phone?`<div style="font-size:var(--fs-xs);color:var(--muted)">${g(e.member_phone)}</div>`:""}
                    <div class="list-item-subtitle">${g(e.method?.toUpperCase()||"PAYMENT")} · ${R(e.paid_on||e.created_at)}</div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--text)">${w(e.amount)}</div>
                    ${A(e.status)}
                  </div>
                </div>
                ${a?`
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-xs);border-top:1px solid var(--border-light);padding-top:var(--sp-sm)">
                    <button class="btn btn-outline btn-sm" data-action="reject-payment" data-id="${e.id}" style="flex:1;color:var(--critical);border-color:var(--critical-border)">Reject</button>
                    <button class="btn btn-primary btn-sm" data-action="verify-payment" data-id="${e.id}" style="flex:1">Verify Payment</button>
                  </div>
                `:""}
              </div>`}).join("")}
        </div>`,t.querySelectorAll("[data-payment-id]").forEach(e=>{e.addEventListener("click",a=>{a.target.closest("button")||m.push("payment-detail",{paymentId:e.dataset.paymentId})})}),t.querySelectorAll('[data-action="verify-payment"]').forEach(e=>{e.addEventListener("click",async a=>{a.stopPropagation();const n=e.dataset.id;if(!await L({title:"Verify Payment",message:"Verify this payment and renew the member membership?",confirmText:"Verify"}))return;const l=await v(`/api/mobile/v1/payments/${n}/verify`,{method:"POST"});l.ok?(p("Payment verified successfully!","success"),d()):p(l.error?.message||"Verification failed","error")})}),t.querySelectorAll('[data-action="reject-payment"]').forEach(e=>{e.addEventListener("click",async a=>{a.stopPropagation();const n=e.dataset.id;if(!await L({title:"Reject Payment",message:"Are you sure you want to reject this payment record?",confirmText:"Reject",destructive:!0}))return;const l=await v(`/api/mobile/v1/payments/${n}/reject`,{method:"POST"});l.ok?(p("Payment rejected","success"),d()):p(l.error?.message||"Rejection failed","error")})})}await d()}};export{C as default};
