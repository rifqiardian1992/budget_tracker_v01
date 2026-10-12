(() => {
"use strict";
const $ = id => document.getElementById(id);
const API_URL = String(window.BUDGET_TRACKER_API_URL || "").trim(); // Set in config.js; never put Gemini/Fonnte keys here.
const STORAGE_KEY = "budget-tracker-v02";
let items = [], transactions = [], nextId = 1, recommendation = null, latestAiAdvice = "", historyRows = [];
const fmt = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);
const num = v => Math.max(0,Number(v)||0);
const round = n => Math.round((Number(n)||0)*100)/100;
const monthNow = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const period = () => $("budgetDate").value || monthNow();
const mainBudget = () => num($("mainBudget").value);
const monthOf = date => String(date||"").slice(0,7);
const escapeHtml = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function message(id,text,kind=""){ $(id).textContent=text; $(id).className=`message ${kind}`; }
function sample(){
  const seed=[
    ["Kebutuhan Pokok","percent",35,true],
    ["Transportasi","percent",7.5,false],
    ["Tagihan & Utilitas","percent",15,true],
    ["Sosial & Apresiasi","percent",10,false],
    ["Jalan-jalan Keluarga","percent",10,false],
    ["Tabungan Anak","percent",10,true],
    ["Tabungan Umum","percent",7.5,true],
    ["Cadangan / Miscellaneous","percent",5,false]
  ];
  return seed.map(([name,mode,pct,mandatory])=>{const baseBudget=mainBudget()*pct/100;return {id:nextId++,name,mode,baseBudget,additionalBudget:0,amount:baseBudget,percent:pct,mandatory};});
}
function normalize(item){
  // Legacy browser data only had amount; interpret it as base budget, with zero carryover.
  if(!Number.isFinite(Number(item.baseBudget))) item.baseBudget=num(item.amount);
  if(!Number.isFinite(Number(item.additionalBudget))) item.additionalBudget=0;
  if(item.mode==="percent") item.baseBudget=mainBudget()*num(item.percent)/100;
  else item.percent=mainBudget()?num(item.baseBudget)/mainBudget()*100:0;
  item.amount=round(num(item.baseBudget)+Number(item.additionalBudget||0));
}
function recalc(){items.forEach(normalize);}
function renderItems(){
  const body=$("budgetRows"); body.innerHTML=""; $("emptyState").hidden=items.length>0;
  items.forEach(it=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><input data-field="name" data-id="${it.id}" aria-label="Nama pos" value="${escapeHtml(it.name)}" placeholder="Nama pos"></td>
    <td><select data-field="mode" data-id="${it.id}" aria-label="Mode input"><option value="amount" ${it.mode==="amount"?"selected":""}>Nominal</option><option value="percent" ${it.mode==="percent"?"selected":""}>Persentase</option></select></td>
    <td><input data-field="baseBudget" data-id="${it.id}" aria-label="Base Budget" type="number" min="0" step="1000" value="${round(it.baseBudget)}"></td>
    <td><input data-field="additionalBudget" data-id="${it.id}" aria-label="Additional Budget" type="number" step="1000" value="${round(it.additionalBudget)}"></td>
    <td class="total-budget-cell">${fmt(it.amount)}</td>
    <td><input data-field="percent" data-id="${it.id}" aria-label="Persentase base budget" type="number" min="0" step=".1" value="${round(it.percent)}"></td>
    <td class="check-cell"><input data-field="mandatory" data-id="${it.id}" aria-label="Pos wajib" type="checkbox" ${it.mandatory?"checked":""}></td>
    <td><button class="delete-btn" data-delete="${it.id}" type="button">Hapus</button></td>`;
    body.appendChild(tr);
  });
  updateSummary(); renderCategoryOptions();
}
function updateSummary(){
  const main=mainBudget(), baseTotal=items.reduce((s,x)=>s+num(x.baseBudget),0), additionalTotal=items.reduce((s,x)=>s+Number(x.additionalBudget||0),0), total=items.reduce((s,x)=>s+Number(x.amount||0),0), pct=main?baseTotal/main*100:0;
  $("mainBudgetDisplay").textContent=fmt(main); $("remainingDisplay").textContent=fmt(main-baseTotal);
  $("remainingDisplay").style.color=main-baseTotal<0?"var(--red)":"var(--text)";
  $("allocationTotal").textContent=`Total anggaran pos: ${fmt(total)} (base ${fmt(baseTotal)} · tambahan bersih ${additionalTotal>=0?"+":""}${fmt(additionalTotal)})`; $("allocationPercent").textContent=`${round(pct)}% base teralokasi`;
  $("allocationProgress").style.width=`${Math.min(100,Math.max(0,pct))}%`; $("allocationProgress").style.background=pct>100?"var(--red)":"var(--primary)";
}
function renderCategoryOptions(){
  const select=$("txCategory"), prior=select.value;
  select.innerHTML=items.map(x=>`<option value="${x.id}">${escapeHtml(x.name||"(Pos tanpa nama)")}</option>`).join("");
  if(items.some(x=>String(x.id)===prior)) select.value=prior;
}
function actualFor(item,month){
  // Net spending: expenses increase usage; income/reimbursements restore the category balance.
  return transactions.filter(t=>t.itemName===item.name && monthOf(t.date)===month).reduce((s,t)=>s+(t.type==="income"?-num(t.amount):num(t.amount)),0);
}
function carryFor(item,month){
  const prev=previousMonth(month);
  const priorItem=items.find(x=>x.name===item.name);
  return priorItem ? Math.max(0,num(priorItem.amount)-actualFor(priorItem,prev)) : 0;
}
function previousMonth(m){const [y,mo]=m.split("-").map(Number);const d=new Date(y,mo-2,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function usageRange(){
  const start=$("paydayStart").value, next=$("paydayNext").value;
  return start && next && start < next ? {start,next} : null;
}
function isDateInUsagePeriod(date){
  const range=usageRange();
  // The next payday is a planned date, not a hard cutoff. If salary is late,
  // keep recording transactions from the active cycle start until the user
  // explicitly starts a new cycle by updating paydayStart.
  return range ? String(date||"") >= range.start : monthOf(date) === period();
}
function actualForUsagePeriod(item){
  return transactions.filter(t=>t.itemName===item.name && isDateInUsagePeriod(t.date)).reduce((s,t)=>s+(t.type==="income"?-num(t.amount):num(t.amount)),0);
}
function renderActual(){
  const month=period(), body=$("actualRows"), txBody=$("transactionsRows");
  body.innerHTML=""; txBody.innerHTML="";
  let totalRemaining=0;
  items.forEach(it=>{
    const actual=actualForUsagePeriod(it), left=round(Number(it.amount||0)-actual);
    totalRemaining+=left;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(it.name)}</td><td>${fmt(it.amount)}</td><td>${fmt(actual)}</td><td class="${left<0?"negative":"positive"}">${fmt(left)}</td><td></td>`;
    body.appendChild(tr);
  });
  totalRemaining=round(totalRemaining);
  const totalDisplay=$("totalRemainingDisplay");
  if(totalDisplay){totalDisplay.textContent=fmt(totalRemaining);totalDisplay.classList.toggle("negative",totalRemaining<0);totalDisplay.classList.toggle("positive",totalRemaining>=0);}

  const monthTx=transactions.filter(t=>isDateInUsagePeriod(t.date)).sort((a,b)=>b.date.localeCompare(a.date));
  $("txEmpty").hidden=monthTx.length>0;
  monthTx.forEach(t=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(t.date)}</td><td class="${t.type==="income"?"positive":""}">${t.type==="income"?"Pemasukan":"Pengeluaran"}</td><td>${escapeHtml(t.itemName)}</td><td>${escapeHtml(t.description)}</td><td class="${t.type==="income"?"positive":""}">${t.type==="income"?"+":"−"}${fmt(t.amount)}</td><td><button class="delete-btn" data-tx-delete="${t.id}" type="button">Hapus</button></td>`;
    txBody.appendChild(tr);
  });
}
function payload(){return {period:period(),mainBudget:mainBudget(),items:items.map(({name,mode,baseBudget,additionalBudget,amount,percent,mandatory})=>({name:name.trim(),mode,baseBudget:round(baseBudget),additionalBudget:round(additionalBudget),amount:round(amount),percent:round(percent),mandatory:Boolean(mandatory)}))};}
function localSave(){localStorage.setItem(STORAGE_KEY,JSON.stringify({current:payload(),transactions,paydayStart:$("paydayStart").value||"",paydayNext:$("paydayNext").value||""}));}
function localLoad(){
  const today=localDateString();
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
    if(saved){transactions=saved.transactions||[]; const cur=saved.current||{}; $("budgetDate").value=cur.period||monthOf(today); $("mainBudget").value=cur.mainBudget||8000000; $("paydayStart").value=saved.paydayStart||today; $("paydayNext").value=saved.paydayNext||""; items=(cur.items||[]).map(x=>({...x,baseBudget:Number.isFinite(Number(x.baseBudget))?Number(x.baseBudget):Number(x.amount)||0,additionalBudget:Number.isFinite(Number(x.additionalBudget))?Number(x.additionalBudget):0,id:nextId++}));}
    else {$("budgetDate").value=monthOf(today);$("mainBudget").value=8000000;$("paydayStart").value=today;$("paydayNext").value="";items=sample();}
  }catch(e){$("budgetDate").value=monthOf(today);$("mainBudget").value=8000000;$("paydayStart").value=today;$("paydayNext").value="";items=sample();}
  recalc();renderItems();renderActual();
}
async function api(action,data={}){
  if(!API_URL) return null;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),18000);
  try {
    let response;
    if(action==="getBudget"||action==="getTransactions"||action==="getHistoricalPeriods"||action==="getHistoricalTransactions"||action==="health"){
      const url=new URL(API_URL);
      url.searchParams.set("action",action);
      Object.entries(data).forEach(([k,v])=>url.searchParams.set(k,String(v)));
      response=await fetch(url.toString(),{method:"GET",signal:controller.signal,cache:"no-store"});
    } else {
      response=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,...data}),signal:controller.signal,cache:"no-store"});
    }
    if(!response.ok) throw new Error(`HTTP ${response.status} dari Apps Script`);
    const raw=await response.text();
    let parsed;
    try { parsed=JSON.parse(raw); }
    catch (_) { throw new Error("Respons backend bukan JSON. Periksa URL /exec dan akses deployment Web App."); }
    return parsed;
  } catch(err) {
    if(err && err.name==="AbortError") throw new Error("Permintaan ke Apps Script melewati batas 18 detik. Periksa URL /exec, akses deployment, dan koneksi.");
    if(err instanceof TypeError) throw new Error("Browser gagal menghubungi Apps Script. Periksa URL /exec, deployment, dan koneksi jaringan.");
    throw err;
  } finally { clearTimeout(timeout); }
}
async function checkBackendConnection(){
  const badge=$("connectionStatus");
  if(!API_URL){badge.textContent="Mode lokal · backend belum diatur";badge.className="status status-demo";return;}
  badge.textContent="Memeriksa koneksi dan memuat data…";badge.className="status status-demo";
  try {
    const health=await api("health");
    if(!health || health.success!==true) throw new Error(health?.message||"Health check gagal");

    // Google Sheets is the source of truth for saved budgets and transactions.
    // Load budget for the selected month and transactions for the active payday cycle.
    const budgetResult=await api("getBudget",{period:period()});
    if(budgetResult && budgetResult.success && budgetResult.data){
      const remote=budgetResult.data;
      if(Array.isArray(remote.items) && remote.items.length){
        $("mainBudget").value=Number(remote.mainBudget)||mainBudget();
        items=remote.items.map(x=>({
          id:nextId++, name:String(x.name||""), mode:x.mode==="percent"?"percent":"amount",
          baseBudget:Number.isFinite(Number(x.baseBudget))?Number(x.baseBudget):Number(x.amount)||0,
          additionalBudget:Number.isFinite(Number(x.additionalBudget))?Number(x.additionalBudget):0,
          amount:Number(x.amount)||0, percent:Number(x.percent)||0, mandatory:Boolean(x.mandatory)
        }));
        recalc(); renderItems();
      }
    }
    let txResult;
    const range=usageRange();
    if(range) txResult=await api("getHistoricalTransactions",{startDate:range.start,nextDate:range.next});
    else txResult=await api("getTransactions",{period:period()});
    if(txResult && txResult.success && Array.isArray(txResult.data)){
      transactions=txResult.data.map((t,i)=>({id:String(t.id||`remote-${i}-${t.date||""}`),date:String(t.date||""),itemName:String(t.itemName||""),description:String(t.description||""),amount:Number(t.amount)||0,type:t.type==="income"?"income":"expense"}));
    } else if(txResult && txResult.success===false) throw new Error(txResult.message||"Gagal memuat transaksi dari Google Sheets");
    localSave(); renderActual();
    badge.textContent="Backend terhubung · data Google Sheets dimuat";badge.className="status status-connected";
  } catch(err) {
    badge.textContent="Backend terhubung bermasalah saat memuat data";badge.className="status status-error";
    console.error("Budget Tracker backend load:",err);
  }
}
$("budgetRows").addEventListener("input",e=>{
  const el=e.target,id=Number(el.dataset.id),field=el.dataset.field,it=items.find(x=>x.id===id);if(!it||!field)return;
  if(field==="name"){it.name=el.value;renderCategoryOptions();return;}
  if(field==="baseBudget"){it.baseBudget=num(el.value);it.mode="amount";it.percent=mainBudget()?it.baseBudget/mainBudget()*100:0;}
  if(field==="additionalBudget"){it.additionalBudget=Number(el.value)||0;}
  if(field==="percent"){it.percent=num(el.value);it.mode="percent";it.baseBudget=mainBudget()*it.percent/100;}
  normalize(it);
  const row=el.closest("tr");
  const baseEl=row.querySelector('[data-field="baseBudget"]'),additionalEl=row.querySelector('[data-field="additionalBudget"]'),percentEl=row.querySelector('[data-field="percent"]'),modeEl=row.querySelector('[data-field="mode"]'),totalEl=row.querySelector('.total-budget-cell');
  baseEl.value=round(it.baseBudget);additionalEl.value=round(it.additionalBudget);percentEl.value=round(it.percent);modeEl.value=it.mode;totalEl.textContent=fmt(it.amount);updateSummary();
});
$("budgetRows").addEventListener("change",e=>{
  const el=e.target,it=items.find(x=>x.id===Number(el.dataset.id));if(!it)return;
  if(el.dataset.field==="mode"){it.mode=el.value;normalize(it);renderItems();}
  if(el.dataset.field==="mandatory"){it.mandatory=el.checked;}
});
$("budgetRows").addEventListener("click",e=>{const id=Number(e.target.dataset.delete);if(!id)return;items=items.filter(x=>x.id!==id);renderItems();});
$("mainBudget").addEventListener("input",()=>{recalc();renderItems();});
$("recommendationMainBudget").addEventListener("input",()=>{recommendation=null;renderRecommendation();message("recommendationMessage","Main Budget periode baru berubah. Jika kosong, nilai periode berjalan akan digunakan. Hitung kembali rekomendasi untuk menggunakan nilai terbaru.");});
$("budgetDate").addEventListener("change",()=>{renderActual();recommendation=null;message("recommendationMessage","Periode berubah. Hitung kembali rekomendasi jika diperlukan.");localSave();});
$("addRowBtn").addEventListener("click",()=>{items.push({id:nextId++,name:"",mode:"amount",baseBudget:0,additionalBudget:0,amount:0,percent:0,mandatory:false});renderItems();$("budgetRows").querySelectorAll('[data-field="name"]').item(items.length-1)?.focus();});
$("resetBtn").addEventListener("click",()=>{if(!confirm("Pulihkan data contoh?"))return;nextId=1;$("mainBudget").value=8000000;items=sample();recalc();renderItems();message("planMessage","Data contoh dipulihkan. Simpan jika ingin menyimpan ke backend.");});
$("saveBtn").addEventListener("click",async()=>{
  const data=payload();if(!data.period||!data.mainBudget)return message("planMessage","Pilih periode dan isi Main Budget lebih besar dari nol.","error");if(data.items.some(x=>!x.name))return message("planMessage","Semua pos harus memiliki nama.","error");const range=usageRange();if(!range)return message("planMessage","Tanggal gajian awal dan berikutnya wajib diisi, dan tanggal berikutnya harus setelah tanggal awal.","error");if(data.period!==range.start.slice(0,7))return message("planMessage","Periode anggaran harus sesuai bulan tanggal gajian awal.","error");
  const btn=$("saveBtn"), original=btn.textContent;btn.disabled=true;btn.textContent="Menyimpan…";
  try{const result=await api("saveAll",{...data,paydayStart:$("paydayStart").value,paydayNext:$("paydayNext").value,transactions});if(result&&!result.success)throw new Error(result.message||"Gagal menyimpan");localSave();message("planMessage",result?"Anggaran dan transaksi tersimpan ke Google Sheets.":"Tersimpan di browser saja. Atur URL Apps Script di frontend/config.js untuk sinkronisasi Google Sheets.", "success");}
  catch(e){localSave();message("planMessage",`Sinkronisasi gagal: ${e.message}. Salinan lokal tetap disimpan di browser; periksa status backend di atas.`, "error");}
  finally{btn.disabled=false;btn.textContent=original;}
});
$("addTxBtn").addEventListener("click",async()=>{
  const id=Number($("txCategory").value),it=items.find(x=>x.id===id),date=$("txDate").value,description=$("txDescription").value.trim(),amount=num($("txAmount").value);
  if(!it)return message("txMessage","Buat pos budget terlebih dahulu.","error");
  if(!date||!isDateInUsagePeriod(date))return message("txMessage",usageRange()?`Tanggal transaksi harus sama dengan atau setelah awal siklus berjalan (${usageRange().start}).` : "Tanggal transaksi harus berada dalam periode anggaran terpilih.","error");
  if(!description||amount<=0)return message("txMessage","Isi deskripsi dan nominal transaksi yang valid.","error");
  const type=$("txType").value;
  const tx={id:`tx-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,date,type,itemName:it.name,description,amount};
  const btn=$("addTxBtn"), original=btn.textContent;btn.disabled=true;btn.textContent="Menyimpan…";
  transactions.push(tx);
  try{const result=await api("saveTransaction",tx);if(result&&!result.success)throw new Error(result.message||"Gagal");localSave();const late=usageRange()&&date>=usageRange().next;const status=result?(type==="income"?"Pemasukan tersimpan ke Google Sheets.":"Pengeluaran tersimpan ke Google Sheets."):(type==="income"?"Pemasukan tersimpan di browser saja. Atur frontend/config.js untuk sinkronisasi.":"Pengeluaran tersimpan di browser saja. Atur frontend/config.js untuk sinkronisasi.");message("txMessage",late?`${status} Tanggal transaksi melewati tanggal gajian yang direncanakan; transaksi tetap dihitung dalam siklus berjalan sampai Anda memulai siklus baru setelah gaji benar-benar masuk.`:status,"success");}
  catch(e){localSave();message("txMessage",`Sinkronisasi gagal: ${e.message}. Transaksi tetap disimpan lokal di browser.`, "error");}
  finally{btn.disabled=false;btn.textContent=original;}
  $("txDescription").value="";$("txAmount").value="";renderActual();
});
$("transactionsRows").addEventListener("click",async e=>{
  const id=e.target.dataset.txDelete;if(!id)return;
  transactions=transactions.filter(t=>String(t.id)!==String(id));
  try{await api("deleteTransaction",{id});}catch(err){console.warn(err);}
  localSave();renderActual();message("txMessage","Transaksi dihapus.");
});
function addMonthsToDate(dateString, months=1){
  const [y,m,d]=String(dateString||"").split("-").map(Number);
  if(!y||!m||!d)return "";
  const first=new Date(y,m-1+months,1);
  const lastDay=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  return `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,"0")}-${String(Math.min(d,lastDay)).padStart(2,"0")}`;
}
function syncPlanDatesToRecommendation(){
  if($("recommendationPaydayStart")) $("recommendationPaydayStart").value=$("paydayStart").value||localDateString();
  if($("recommendationPaydayNext")) $("recommendationPaydayNext").value=$("paydayNext").value||"";
}
function syncRecommendationDatesToPlan(){
  const start=$("recommendationPaydayStart").value;
  const end=$("recommendationPaydayNext").value;
  if(!start||!end){message("recommendationMessage","Tanggal awal dan tanggal akhir siklus wajib diisi sebelum menghitung rekomendasi.","error");return false;}
  if(start>=end){message("recommendationMessage","Tanggal akhir siklus harus lebih baru daripada tanggal awal.","error");return false;}
  $("paydayStart").value=start; $("paydayNext").value=end; $("budgetDate").value=start.slice(0,7);
  localSave(); renderActual();
  return true;
}
function makeRecommendation(){
  if(!syncRecommendationDatesToPlan()) return;
  const currentPeriod=period(), range=usageRange();
  if(!range){message("recommendationMessage","Isi tanggal gajian saat ini dan tanggal gajian berikutnya terlebih dahulu agar sisa per pos dihitung sesuai siklus.","error");return;}
  const requestedMainBudget=$("recommendationMainBudget").value.trim();
  const main=requestedMainBudget===""?mainBudget():num(requestedMainBudget);
  if(main<=0){message("recommendationMessage","Main Budget periode baru harus lebih besar dari nol, atau kosongkan untuk memakai Main Budget periode berjalan.","error");return;}
  const mandatory=items.filter(x=>x.mandatory), flexible=items.filter(x=>!x.mandatory);
  const mandatoryTotal=mandatory.reduce((s,x)=>s+num(x.baseBudget),0);
  const flexibleTemplate=flexible.reduce((s,x)=>s+num(x.baseBudget),0);
  const flexibleFunds=Math.max(0,main-mandatoryTotal);
  const draft=items.map(it=>{
    const actualCurrent=actualForUsagePeriod(it);
    const remaining=round(Number(it.amount||0)-actualCurrent);
    let recommendedBase;
    if(it.mandatory) recommendedBase=num(it.baseBudget);
    else recommendedBase=flexibleTemplate?flexibleFunds*num(it.baseBudget)/flexibleTemplate:0;
    return {name:it.name,mandatory:it.mandatory,template:round(it.baseBudget),actualPrevious:round(actualCurrent),additional:remaining,recommended:round(recommendedBase),final:round(recommendedBase),mode:"amount"};
  });
  const deficit=Math.max(0,mandatoryTotal-main);
  const additionalTotal=draft.reduce((s,x)=>s+x.additional,0);
  const nextPeriod=range.next.slice(0,7);
  const nextPayday=addMonthsToDate(range.next,1);
  recommendation={period:currentPeriod,nextPeriod,mainBudget:main,rangeStart:range.start,rangeNext:range.next,nextPayday,additionalTotal,draft,deficit};
  renderRecommendation();
}
function renderRecommendation(){
  const body=$("recommendationRows");body.innerHTML="";
  if(!recommendation){$("recommendationIntro").textContent="Hitung rekomendasi untuk menggunakan sisa setiap pos pada siklus berjalan sebagai Additional Budget periode berikutnya.";return;}
  const r=recommendation;
  $("recommendationIntro").textContent=`Siklus berjalan ${r.rangeStart} sampai ${r.rangeNext} (tanggal akhir tidak termasuk). Rencana baru: ${r.nextPeriod}, mulai gajian ${r.rangeNext} sampai sebelum ${r.nextPayday}. Base Budget rekomendasi dialokasikan dari Main Budget ${fmt(r.mainBudget)}; Additional Budget per pos berasal dari sisa aktual siklus berjalan, termasuk defisit negatif. Total additional bersih: ${fmt(r.additionalTotal)}. ${r.deficit>0?`Peringatan: alokasi pos wajib melebihi Main Budget sebesar ${fmt(r.deficit)}.`:""}`;
  r.draft.forEach((x,i)=>{
    const nextTotal=round(x.final+x.additional);
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(x.name)}</td><td>${x.mandatory?"Wajib":"Fleksibel"}</td><td>${fmt(x.template)}</td><td>${fmt(x.actualPrevious)}</td><td>${fmt(x.additional)}</td><td>${fmt(x.recommended)}</td><td><input type="number" min="0" step="1000" data-rec-index="${i}" value="${x.final}" aria-label="Base Budget baru ${escapeHtml(x.name)}"></td><td class="${nextTotal<0?"negative":""}">${fmt(nextTotal)}</td>`;
    body.appendChild(tr);
  });
  message("recommendationMessage",r.deficit>0?"Base pos wajib melebihi Main Budget. Koreksi alokasi sebelum menyimpan.":"Periksa Base Budget rekomendasi dan Additional Budget per pos. Simpan akan membuat anggaran untuk siklus gajian berikutnya.");
}
$("recommendationRows").addEventListener("input",e=>{const i=Number(e.target.dataset.recIndex);if(!Number.isInteger(i)||!recommendation)return;recommendation.draft[i].final=num(e.target.value);const row=e.target.closest("tr");if(row){const total=round(recommendation.draft[i].final+recommendation.draft[i].additional);row.lastElementChild.textContent=fmt(total);row.lastElementChild.classList.toggle("negative",total<0);}});
$("generateBtn").addEventListener("click",makeRecommendation);
$("discardRecommendationBtn").addEventListener("click",()=>{recommendation=null;renderRecommendation();message("recommendationMessage","Draft rekomendasi dibuang.");});
function buildNextPeriodBudget(){
  if(!recommendation)throw new Error("Hitung rekomendasi terlebih dahulu.");
  const r=recommendation;
  const nextItems=r.draft.map(x=>({name:x.name,mode:"amount",baseBudget:round(x.final),additionalBudget:round(x.additional),amount:round(x.final+x.additional),percent:r.mainBudget?round(x.final/r.mainBudget*100):0,mandatory:Boolean(x.mandatory)}));
  return {period:r.nextPeriod,mainBudget:r.mainBudget,items:nextItems.map(x=>({...x}))};
}
$("applyRecommendationBtn").addEventListener("click",()=>{
  if(!recommendation)return message("recommendationMessage","Hitung rekomendasi terlebih dahulu.","error");
  const next=buildNextPeriodBudget();
  if(next.items.some(x=>!x.name))return message("recommendationMessage","Semua pos harus memiliki nama sebelum draft diterapkan.","error");
  // Apply recommendation to the plan editor only. Persisting to Sheets requires the user to press Save Budget there.
  $("budgetDate").value=recommendation.rangeNext.slice(0,7);
  $("mainBudget").value=next.mainBudget;
  $("paydayStart").value=recommendation.rangeNext;
  $("paydayNext").value=recommendation.nextPayday;
  items=next.items.map(x=>({...x,id:nextId++}));
  recalc();renderItems();renderActual();localSave();
  message("recommendationMessage",`Draft periode ${period()} diterapkan ke Rencana Anggaran, belum disimpan ke Google Sheets. Periksa/ubah kedua tanggal gajian dan Base/Additional Budget, lalu klik Simpan anggaran.`,"success");
  document.querySelector('[data-tab="plan"]').click();
  message("planMessage","Draft rekomendasi sudah dimuat. Periksa periode dan tanggal gajian; klik Simpan anggaran untuk menyimpan ke Google Sheets.","success");
});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
  document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==`tab-${btn.dataset.tab}`);
  if(btn.dataset.tab==="transactions")renderActual();
  if(btn.dataset.tab==="history")loadHistoryPeriods();
}));
async function loadHistoryPeriods(){
  const select=$("historyPeriod");
  select.innerHTML='<option value="">Memuat periode…</option>';
  try{
    let periods=[];
    const result=await api("getHistoricalPeriods");
    if(result&&result.success&&Array.isArray(result.data)) periods=result.data;
    else if(!API_URL) periods=[];
    else throw new Error(result?.message||"Gagal memuat daftar periode dari Google Sheets.");
    // The active cycle can be selected even before its budget has been saved again.
    const active=usageRange();
    if(active&&active.start&&active.next&&!periods.some(x=>x.start===active.start&&x.next===active.next)){
      periods.push({start:active.start,next:active.next,source:"browser"});
    }
    // Older versions did not persist payday dates. Never guess a cycle from calendar months.
    periods=periods.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.start||"")&&/^\d{4}-\d{2}-\d{2}$/.test(x.next||"")&&x.next>x.start)
      .sort((a,b)=>b.start.localeCompare(a.start));
    select.innerHTML='';
    if(!periods.length){select.innerHTML='<option value="">Belum ada siklus gajian tersimpan</option>';message("historyMessage","Belum ada rentang siklus gajian yang tersimpan. Buka Rencana Anggaran, pastikan tanggal gajian awal dan berikutnya benar, lalu klik Simpan anggaran. Siklus aktif juga dapat ditampilkan selama tanggalnya tersedia di browser ini.","error");select.dataset.loaded="true";return;}
    periods.forEach(c=>{const o=document.createElement("option");o.value=`${c.start}|${c.next}`;o.textContent=cycleLabel(c.start,c.next);select.appendChild(o);});
    const activeValue=active?`${active.start}|${active.next}`:"";
    select.value=[...select.options].some(o=>o.value===activeValue)?activeValue:select.options[0].value;
    select.dataset.loaded="true";
    message("historyMessage","Pilih siklus gajian, lalu klik Tampilkan.");
  }catch(err){select.innerHTML='<option value="">Gagal memuat periode</option>';message("historyMessage",err.message||"Gagal memuat daftar periode.","error");}
}
function cycleLabel(start,next){
  const d=s=>new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${s}T12:00:00`));
  return `${d(start)} – ${d(next)} (tanggal akhir tidak termasuk)`;
}
async function showHistory(){
  const value=$("historyPeriod").value;
  if(!value||!value.includes("|"))return message("historyMessage","Pilih siklus gajian yang valid terlebih dahulu.","error");
  const [start,next]=value.split("|");
  const btn=$("showHistoryBtn");btn.disabled=true;btn.textContent="Memuat…";
  try{
    let rows=[];
    if(API_URL){
      const result=await api("getHistoricalTransactions",{startDate:start,nextDate:next});
      if(!result||!result.success)throw new Error(result?.message||"Gagal memuat transaksi historis.");
      rows=Array.isArray(result.data)?result.data:[];
    }else rows=transactions.filter(t=>String(t.date||"")>=start&&String(t.date||"")<next);
    historyRows=rows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.id||"").localeCompare(String(a.id||"")));
    renderHistory(start,next);
    message("historyMessage",historyRows.length?`Siklus ${cycleLabel(start,next)} berhasil ditampilkan (${historyRows.length} transaksi).`:`Tidak ada transaksi pada siklus ${cycleLabel(start,next)}.`,historyRows.length?"success":"error");
  }catch(err){$("historyReportContent").hidden=true;$("printHistoryBtn").disabled=true;message("historyMessage",err.message||"Gagal memuat data historis.","error");}
  finally{btn.disabled=false;btn.textContent="Tampilkan";}
}
function renderHistory(start,next){
  const income=historyRows.filter(t=>t.type==="income").reduce((a,t)=>a+Number(t.amount||0),0);
  const expense=historyRows.filter(t=>t.type!=="income").reduce((a,t)=>a+Number(t.amount||0),0);
  const net=income-expense;
  $("historyTitle").textContent=`Cashflow ${cycleLabel(start,next)}`;
  $("historyMeta").textContent=`Periode gajian: ${start} sampai sebelum ${next} · ${historyRows.length} transaksi`;
  $("historyGenerated").textContent=`Dicetak pada ${new Intl.DateTimeFormat("id-ID",{dateStyle:"long",timeStyle:"short"}).format(new Date())}`;
  $("historyIncome").textContent=fmt(income);$("historyExpense").textContent=fmt(expense);$("historyNet").textContent=fmt(net);
  $("historyNet").className=net<0?"negative":net>0?"positive":"";
  $("historyCount").textContent=new Intl.NumberFormat("id-ID").format(historyRows.length);
  const body=$("historyRows");body.innerHTML="";
  historyRows.forEach(t=>{
    const tr=document.createElement("tr");
    const isIncome=t.type==="income";
    tr.innerHTML=`<td>${escapeHtml(t.date||"—")}</td><td>${isIncome?'<span class="positive">Pemasukan</span>':'Pengeluaran'}</td><td>${escapeHtml(t.itemName||"—")}</td><td>${escapeHtml(t.description||"—")}</td><td class="${isIncome?"positive":""}">${isIncome?"+":"−"}${fmt(t.amount)}</td>`;
    body.appendChild(tr);
  });
  $("historyEmpty").hidden=historyRows.length>0;
  $("historyReportContent").hidden=false;$("printHistoryBtn").disabled=historyRows.length===0;
}
$("showHistoryBtn").addEventListener("click",showHistory);
$("printHistoryBtn").addEventListener("click",()=>{if(!historyRows.length)return;window.print();});

function localDateString(date=new Date()){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function dayDifference(fromDate,toDate){
  const a=new Date(`${fromDate}T00:00:00`),b=new Date(`${toDate}T00:00:00`);
  return Math.round((b-a)/86400000);
}
function buildAiContext(){
  const month=period(), start=$("paydayStart").value, next=$("paydayNext").value, today=localDateString();
  if(!start||!next) throw new Error("Isi tanggal gajian saat ini dan tanggal gajian berikutnya terlebih dahulu.");
  if(start>=next) throw new Error("Tanggal gajian berikutnya harus setelah tanggal gajian saat ini.");
  if(start>today) throw new Error("Tanggal gajian saat ini tidak boleh berada di masa depan.");
  if(next<=today) throw new Error("Tanggal gajian berikutnya harus setelah hari ini.");
  const inPayPeriod=t=>String(t.date||"")>=start&&String(t.date||"")<next;
  const periodTransactions=transactions.filter(inPayPeriod);
  const categorySummary=items.map(it=>{
    const catTx=periodTransactions.filter(t=>t.itemName===it.name);
    const expense=round(catTx.filter(t=>t.type!=="income").reduce((a,t)=>a+num(t.amount),0));
    const income=round(catTx.filter(t=>t.type==="income").reduce((a,t)=>a+num(t.amount),0));
    return {pos:it.name,baseBudget:round(it.baseBudget),additionalBudget:round(it.additionalBudget),budget:round(it.amount),expense,income,remaining:round(Number(it.amount)-expense+income),mandatory:Boolean(it.mandatory)};
  });
  const recent=periodTransactions.sort((a,b)=>`${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`)).slice(0,12).map(t=>({date:t.date,type:t.type==="income"?"pemasukan":"pengeluaran",pos:t.itemName,description:t.description,amount:round(t.amount)}));
  const totalRemainingBudget=round(categorySummary.reduce((sum,c)=>sum+Number(c.remaining||0),0));
  return {period:month,paydayStart:start,paydayNext:next,today,daysUntilNextPayday:Math.max(0,dayDifference(today,next)),usagePeriodEndExclusive:next,mainBudget:mainBudget(),allocated:round(items.reduce((a,x)=>Number(a)+Number(x.amount||0),0)),baseAllocated:round(items.reduce((a,x)=>a+num(x.baseBudget),0)),netAdditional:round(items.reduce((a,x)=>a+Number(x.additionalBudget||0),0)),totalRemainingBudget,categories:categorySummary,recentTransactions:recent};
}
function renderAiAdvice(text){
  latestAiAdvice=String(text||"").trim();const box=$("aiAdviceResult");box.hidden=!latestAiAdvice;
  box.textContent=latestAiAdvice;$("sendAdviceBtn").disabled=!latestAiAdvice;
}
$("aiAdviceBtn").addEventListener("click",async()=>{
  if(!API_URL)return message("aiAdviceMessage","Backend belum terhubung. Periksa frontend/config.js dan pastikan window.BUDGET_TRACKER_API_URL berisi URL Apps Script /exec.","error");
  const btn=$("aiAdviceBtn");btn.disabled=true;btn.textContent="Menganalisis…";message("aiAdviceMessage","Gemini sedang menganalisis ringkasan budget dan transaksi terbaru…");
  try{
    const context=buildAiContext();
    localSave();
    const result=await api("generateAiAdvice",{context});
    if(!result||!result.success)throw new Error(result?.message||"Gagal menghasilkan saran AI.");
    renderAiAdvice(result.advice);message("aiAdviceMessage","Saran berhasil dibuat. Periksa isinya sebelum mengirim ke WhatsApp.","success");
  }catch(e){message("aiAdviceMessage",`Saran AI gagal: ${e.message}`,"error");}
  finally{btn.disabled=false;btn.textContent="✦ Saran AI";}
});
$("sendAdviceBtn").addEventListener("click",async()=>{
  const target=$("whatsappTarget").value.trim();
  if(!latestAiAdvice)return message("aiAdviceMessage","Buat saran AI terlebih dahulu.","error");
  if(!target)return message("aiAdviceMessage","Isi nomor WhatsApp tujuan terlebih dahulu.","error");
  if(!API_URL)return message("aiAdviceMessage","Backend belum terhubung. Periksa URL Apps Script /exec di frontend/config.js.","error");
  const btn=$("sendAdviceBtn");btn.disabled=true;btn.textContent="Mengirim…";message("aiAdviceMessage","Mengirim saran melalui Fonnte…");
  try{
    const result=await api("sendAiAdviceWhatsapp",{target,message:latestAiAdvice,period:period()});
    if(!result||!result.success)throw new Error(result?.message||"Pengiriman WhatsApp gagal.");
    message("aiAdviceMessage",result.message||"Permintaan pengiriman diterima Fonnte.","success");
  }catch(e){message("aiAdviceMessage",`Gagal mengirim WhatsApp: ${e.message}`,"error");}
  finally{btn.disabled=false;btn.textContent="Kirim via Fonnte";}
});
$("txDate").value=localDateString();
$("paydayStart").addEventListener("change",()=>{if($("paydayStart").value){$("budgetDate").value=$("paydayStart").value.slice(0,7);}localSave();renderActual();});
$("paydayNext").addEventListener("change",()=>{localSave();renderActual();syncPlanDatesToRecommendation();});
$("paydayStart").addEventListener("change",syncPlanDatesToRecommendation);
$("recommendationPaydayStart").addEventListener("change",()=>{ $("paydayStart").value=$("recommendationPaydayStart").value; if($("paydayStart").value) $("budgetDate").value=$("paydayStart").value.slice(0,7); localSave(); renderActual(); recommendation=null; renderRecommendation(); });
$("recommendationPaydayNext").addEventListener("change",()=>{ $("paydayNext").value=$("recommendationPaydayNext").value; localSave(); renderActual(); recommendation=null; renderRecommendation(); });
localLoad();
syncPlanDatesToRecommendation();
// Optional recommendation income intentionally stays blank by default; blank reuses the current Main Budget.
checkBackendConnection();
})();