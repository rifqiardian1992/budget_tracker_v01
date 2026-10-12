(() => {
"use strict";
const $ = id => document.getElementById(id);
const API_URL = "https://script.google.com/macros/s/AKfycbxG86upLfMmmalCrwe9J6mhvwaGjimx08tLOKkood-szmzxET13YWTR4mrbFy9qKHPx/exec"; // Paste deployed Apps Script /exec URL here. Keep API keys on Apps Script only.
const STORAGE_KEY = "budget-tracker-v02";
let items = [], transactions = [], nextId = 1, recommendation = null, latestAiAdvice = "";
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
  return seed.map(([name,mode,pct,mandatory])=>({id:nextId++,name,mode,amount:mainBudget()*pct/100,percent:pct,mandatory}));
}
function normalize(item){
  if(item.mode==="percent") item.amount=mainBudget()*num(item.percent)/100;
  else item.percent=mainBudget()?num(item.amount)/mainBudget()*100:0;
}
function recalc(){items.forEach(normalize);}
function renderItems(){
  const body=$("budgetRows"); body.innerHTML=""; $("emptyState").hidden=items.length>0;
  items.forEach(it=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><input data-field="name" data-id="${it.id}" aria-label="Nama pos" value="${escapeHtml(it.name)}" placeholder="Nama pos"></td>
    <td><select data-field="mode" data-id="${it.id}" aria-label="Mode input"><option value="amount" ${it.mode==="amount"?"selected":""}>Nominal</option><option value="percent" ${it.mode==="percent"?"selected":""}>Persentase</option></select></td>
    <td><input data-field="amount" data-id="${it.id}" aria-label="Nominal" type="number" min="0" step="1000" value="${round(it.amount)}"></td>
    <td><input data-field="percent" data-id="${it.id}" aria-label="Persentase" type="number" min="0" step=".1" value="${round(it.percent)}"></td>
    <td class="check-cell"><input data-field="mandatory" data-id="${it.id}" aria-label="Pos wajib" type="checkbox" ${it.mandatory?"checked":""}></td>
    <td><button class="delete-btn" data-delete="${it.id}" type="button">Hapus</button></td>`;
    body.appendChild(tr);
  });
  updateSummary(); renderCategoryOptions();
}
function updateSummary(){
  const total=items.reduce((s,x)=>s+num(x.amount),0), main=mainBudget(), pct=main?total/main*100:0;
  $("mainBudgetDisplay").textContent=fmt(main); $("remainingDisplay").textContent=fmt(main-total);
  $("remainingDisplay").style.color=main-total<0?"var(--red)":"var(--text)";
  $("allocationTotal").textContent=`Total alokasi: ${fmt(total)}`; $("allocationPercent").textContent=`${round(pct)}% teralokasi`;
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
  return range ? String(date||"") >= range.start && String(date||"") < range.next : monthOf(date) === period();
}
function actualForUsagePeriod(item){
  return transactions.filter(t=>t.itemName===item.name && isDateInUsagePeriod(t.date)).reduce((s,t)=>s+(t.type==="income"?-num(t.amount):num(t.amount)),0);
}
function renderActual(){
  const month=period(), body=$("actualRows"), txBody=$("transactionsRows");
  body.innerHTML=""; txBody.innerHTML="";
  items.forEach(it=>{
    const actual=actualForUsagePeriod(it), left=num(it.amount)-actual;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(it.name)}</td><td>${fmt(it.amount)}</td><td>${fmt(actual)}</td><td class="${left<0?"negative":"positive"}">${fmt(left)}</td><td></td>`;
    body.appendChild(tr);
  });
  const monthTx=transactions.filter(t=>isDateInUsagePeriod(t.date)).sort((a,b)=>b.date.localeCompare(a.date));
  $("txEmpty").hidden=monthTx.length>0;
  monthTx.forEach(t=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(t.date)}</td><td class="${t.type==="income"?"positive":""}">${t.type==="income"?"Pemasukan":"Pengeluaran"}</td><td>${escapeHtml(t.itemName)}</td><td>${escapeHtml(t.description)}</td><td class="${t.type==="income"?"positive":""}">${t.type==="income"?"+":"−"}${fmt(t.amount)}</td><td><button class="delete-btn" data-tx-delete="${t.id}" type="button">Hapus</button></td>`;
    txBody.appendChild(tr);
  });
}
function payload(){return {period:period(),mainBudget:mainBudget(),items:items.map(({name,mode,amount,percent,mandatory})=>({name:name.trim(),mode,amount:round(amount),percent:round(percent),mandatory:Boolean(mandatory)}))};}
function localSave(){localStorage.setItem(STORAGE_KEY,JSON.stringify({current:payload(),transactions,paydayStart:$("paydayStart").value||"",paydayNext:$("paydayNext").value||""}));}
function localLoad(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
    if(saved){transactions=saved.transactions||[]; const cur=saved.current||{}; $("budgetDate").value=cur.period||monthNow(); $("mainBudget").value=cur.mainBudget||8000000; $("paydayStart").value=saved.paydayStart||""; $("paydayNext").value=saved.paydayNext||""; items=(cur.items||[]).map(x=>({...x,id:nextId++}));}
    else {$("budgetDate").value=monthNow();$("mainBudget").value=8000000;items=sample();}
  }catch(e){$("budgetDate").value=monthNow();$("mainBudget").value=8000000;items=sample();}
  recalc();renderItems();renderActual();
}
async function api(action,data={}){
  if(!API_URL) return null;
  if(action==="getBudget"||action==="getTransactions"){
    const url=new URL(API_URL);url.searchParams.set("action",action);Object.entries(data).forEach(([k,v])=>url.searchParams.set(k,v));
    const r=await fetch(url);return r.json();
  }
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,...data})});
  return r.json();
}
$("budgetRows").addEventListener("input",e=>{
  const el=e.target,id=Number(el.dataset.id),field=el.dataset.field,it=items.find(x=>x.id===id);if(!it||!field)return;
  if(field==="name"){it.name=el.value;renderCategoryOptions();return;}
  if(field==="amount"){it.amount=num(el.value);it.mode="amount";it.percent=mainBudget()?it.amount/mainBudget()*100:0;}
  if(field==="percent"){it.percent=num(el.value);it.mode="percent";it.amount=mainBudget()*it.percent/100;}
  const row=el.closest("tr");
  const amountEl=row.querySelector('[data-field="amount"]'),percentEl=row.querySelector('[data-field="percent"]'),modeEl=row.querySelector('[data-field="mode"]');
  amountEl.value=round(it.amount);percentEl.value=round(it.percent);modeEl.value=it.mode;updateSummary();
});
$("budgetRows").addEventListener("change",e=>{
  const el=e.target,it=items.find(x=>x.id===Number(el.dataset.id));if(!it)return;
  if(el.dataset.field==="mode"){it.mode=el.value;normalize(it);renderItems();}
  if(el.dataset.field==="mandatory"){it.mandatory=el.checked;}
});
$("budgetRows").addEventListener("click",e=>{const id=Number(e.target.dataset.delete);if(!id)return;items=items.filter(x=>x.id!==id);renderItems();});
$("mainBudget").addEventListener("input",()=>{recalc();renderItems();});
$("budgetDate").addEventListener("change",()=>{renderActual();recommendation=null;message("recommendationMessage","Periode berubah. Hitung kembali rekomendasi jika diperlukan.");});
$("addRowBtn").addEventListener("click",()=>{items.push({id:nextId++,name:"",mode:"amount",amount:0,percent:0,mandatory:false});renderItems();$("budgetRows").querySelectorAll('[data-field="name"]').item(items.length-1)?.focus();});
$("resetBtn").addEventListener("click",()=>{if(!confirm("Pulihkan data contoh?"))return;nextId=1;$("mainBudget").value=8000000;items=sample();recalc();renderItems();message("planMessage","Data contoh dipulihkan. Simpan jika ingin menyimpan ke backend.");});
$("saveBtn").addEventListener("click",async()=>{
  const data=payload();if(!data.period||!data.mainBudget)return message("planMessage","Pilih periode dan isi Main Budget lebih besar dari nol.","error");if(data.items.some(x=>!x.name))return message("planMessage","Semua pos harus memiliki nama.","error");
  try{const result=await api("saveAll",{...data,transactions});if(result&&!result.success)throw new Error(result.message||"Gagal menyimpan");localSave();message("planMessage",result?"Anggaran dan transaksi tersimpan ke Google Sheets.":"Tersimpan di browser. Isi API_URL untuk mengaktifkan Google Sheets.", "success");}
  catch(e){localSave();message("planMessage",`Backend gagal: ${e.message}. Data disimpan lokal.`, "error");}
});
$("addTxBtn").addEventListener("click",async()=>{
  const id=Number($("txCategory").value),it=items.find(x=>x.id===id),date=$("txDate").value,description=$("txDescription").value.trim(),amount=num($("txAmount").value);
  if(!it)return message("txMessage","Buat pos budget terlebih dahulu.","error");
  if(!date||!isDateInUsagePeriod(date))return message("txMessage",usageRange()?`Tanggal transaksi harus berada dalam siklus gajian ${usageRange().start} sampai sebelum ${usageRange().next}.`:"Tanggal transaksi harus berada dalam periode anggaran terpilih.","error");
  if(!description||amount<=0)return message("txMessage","Isi deskripsi dan nominal transaksi yang valid.","error");
  const type=$("txType").value;
  const tx={id:`tx-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,date,type,itemName:it.name,description,amount};
  transactions.push(tx);
  try{const result=await api("saveTransaction",tx);if(result&&!result.success)throw new Error(result.message||"Gagal");localSave();message("txMessage",result?(type==="income"?"Pemasukan tersimpan ke Google Sheets.":"Pengeluaran tersimpan ke Google Sheets."):(type==="income"?"Pemasukan tersimpan di browser. Hubungkan API_URL untuk sinkronisasi.":"Pengeluaran tersimpan di browser. Hubungkan API_URL untuk sinkronisasi."), "success");}
  catch(e){localSave();message("txMessage",`Backend gagal: ${e.message}. Transaksi tersimpan lokal.`, "error");}
  $("txDescription").value="";$("txAmount").value="";renderActual();
});
$("transactionsRows").addEventListener("click",async e=>{
  const id=e.target.dataset.txDelete;if(!id)return;
  transactions=transactions.filter(t=>String(t.id)!==String(id));
  try{await api("deleteTransaction",{id});}catch(err){console.warn(err);}
  localSave();renderActual();message("txMessage","Transaksi dihapus.");
});
function makeRecommendation(){
  const month=period(), prev=previousMonth(month), totalActual=transactions.filter(t=>monthOf(t.date)===prev).reduce((s,t)=>s+(t.type==="income"?-num(t.amount):num(t.amount)),0);
  const carry=items.reduce((s,it)=>s+Math.max(0,num(it.amount)-actualFor(it,prev)),0);
  const main=mainBudget(), totalFunds=main+carry;
  const mandatory=items.filter(x=>x.mandatory), flexible=items.filter(x=>!x.mandatory);
  const mandatoryTotal=mandatory.reduce((s,x)=>s+num(x.amount),0);
  const availableFlexible=Math.max(0,totalFunds-mandatoryTotal);
  const flexibleTemplate=flexible.reduce((s,x)=>s+num(x.amount),0);
  const draft=items.map(it=>{
    let recommended;
    if(it.mandatory) recommended=num(it.amount);
    else recommended=flexibleTemplate?availableFlexible*num(it.amount)/flexibleTemplate:0;
    return {name:it.name,mandatory:it.mandatory,template:num(it.amount),actualPrevious:actualFor(it,prev),carry:Math.max(0,num(it.amount)-actualFor(it,prev)),recommended:round(recommended),final:round(recommended),mode:"amount"};
  });
  const deficit=Math.max(0,mandatoryTotal-totalFunds);
  recommendation={period:month,previousPeriod:prev,mainBudget:main,carry,totalFunds,totalActual,draft,deficit};
  renderRecommendation();
}
function renderRecommendation(){
  const body=$("recommendationRows");body.innerHTML="";
  if(!recommendation){$("recommendationIntro").textContent="Pilih periode dengan anggaran sebelumnya dan transaksi aktual, lalu hitung rekomendasi.";return;}
  const r=recommendation;
  $("recommendationIntro").textContent=`Periode acuan ${r.previousPeriod}. Main Budget ${fmt(r.mainBudget)} + estimasi sisa positif ${fmt(r.carry)} = total dana perencanaan ${fmt(r.totalFunds)}. Pengeluaran tercatat periode lalu: ${fmt(r.totalActual)}. ${r.deficit>0?`Perhatian: dana tidak cukup untuk mempertahankan seluruh pos wajib; kekurangan ${fmt(r.deficit)}.`:"Pos wajib dipertahankan sesuai template."}`;
  r.draft.forEach((x,i)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(x.name)}</td><td>${x.mandatory?"Wajib":"Fleksibel"}</td><td>${fmt(x.template)}</td><td>${fmt(x.actualPrevious)}</td><td>${fmt(x.recommended)}</td><td><input type="number" min="0" step="1000" data-rec-index="${i}" value="${x.final}" aria-label="Nominal final ${escapeHtml(x.name)}"></td>`;
    body.appendChild(tr);
  });
  message("recommendationMessage",r.deficit>0?"Dana belum cukup untuk seluruh pos wajib. Pertimbangkan mengubah template atau menambah dana.":"Draft rekomendasi siap ditinjau.");
}
$("recommendationRows").addEventListener("input",e=>{const i=Number(e.target.dataset.recIndex);if(!Number.isInteger(i)||!recommendation)return;recommendation.draft[i].final=num(e.target.value);});
$("generateBtn").addEventListener("click",makeRecommendation);
$("discardRecommendationBtn").addEventListener("click",()=>{recommendation=null;renderRecommendation();message("recommendationMessage","Draft rekomendasi dibuang.");});
$("applyRecommendationBtn").addEventListener("click",()=>{
  if(!recommendation)return message("recommendationMessage","Hitung rekomendasi terlebih dahulu.","error");
  items=items.map(it=>{const r=recommendation.draft.find(x=>x.name===it.name);return r?{...it,amount:r.final,mode:"amount",percent:mainBudget()?r.final/mainBudget()*100:0}:it;});
  renderItems();message("recommendationMessage","Rekomendasi diterapkan ke editor sebagai draft. Klik Simpan anggaran untuk menyimpan.","success");
  document.querySelector('[data-tab="plan"]').click();
});
$("saveRecommendationBtn").addEventListener("click",async()=>{
  if(!recommendation)return message("recommendationMessage","Hitung rekomendasi terlebih dahulu.","error");
  items=items.map(it=>{const r=recommendation.draft.find(x=>x.name===it.name);return r?{...it,amount:r.final,mode:"amount",percent:mainBudget()?r.final/mainBudget()*100:0}:it;});
  renderItems();
  const data=payload();
  try{const result=await api("saveAll",{...data,transactions});if(result&&!result.success)throw new Error(result.message||"Gagal");localSave();message("recommendationMessage",result?"Rekomendasi disimpan ke Google Sheets.":"Rekomendasi disimpan lokal. Isi API_URL untuk sinkronisasi Google Sheets.","success");}
  catch(e){localSave();message("recommendationMessage",`Backend gagal: ${e.message}. Draft disimpan lokal.`, "error");}
});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
  document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==`tab-${btn.dataset.tab}`);
  if(btn.dataset.tab==="transactions")renderActual();
}));
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
    return {pos:it.name,budget:round(it.amount),expense,income,remaining:round(num(it.amount)-expense+income),mandatory:Boolean(it.mandatory)};
  });
  const recent=periodTransactions.sort((a,b)=>`${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`)).slice(0,12).map(t=>({date:t.date,type:t.type==="income"?"pemasukan":"pengeluaran",pos:t.itemName,description:t.description,amount:round(t.amount)}));
  return {period:month,paydayStart:start,paydayNext:next,today,daysUntilNextPayday:Math.max(0,dayDifference(today,next)),usagePeriodEndExclusive:next,mainBudget:mainBudget(),allocated:round(items.reduce((a,x)=>a+num(x.amount),0)),categories:categorySummary,recentTransactions:recent};
}
function renderAiAdvice(text){
  latestAiAdvice=String(text||"").trim();const box=$("aiAdviceResult");box.hidden=!latestAiAdvice;
  box.textContent=latestAiAdvice;$("sendAdviceBtn").disabled=!latestAiAdvice;
}
$("aiAdviceBtn").addEventListener("click",async()=>{
  if(!API_URL)return message("aiAdviceMessage","Backend belum terhubung. Isi API_URL di app.js dengan URL Apps Script /exec lalu deploy ulang.","error");
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
  if(!API_URL)return message("aiAdviceMessage","Backend belum terhubung. Isi API_URL di app.js.","error");
  const btn=$("sendAdviceBtn");btn.disabled=true;btn.textContent="Mengirim…";message("aiAdviceMessage","Mengirim saran melalui Fonnte…");
  try{
    const result=await api("sendAiAdviceWhatsapp",{target,message:latestAiAdvice,period:period()});
    if(!result||!result.success)throw new Error(result?.message||"Pengiriman WhatsApp gagal.");
    message("aiAdviceMessage",result.message||"Permintaan pengiriman diterima Fonnte.","success");
  }catch(e){message("aiAdviceMessage",`Gagal mengirim WhatsApp: ${e.message}`,"error");}
  finally{btn.disabled=false;btn.textContent="Kirim via Fonnte";}
});
$("txDate").value=localDateString();
$("paydayStart").addEventListener("change",()=>{localSave();renderActual();});
$("paydayNext").addEventListener("change",()=>{localSave();renderActual();});
localLoad();
})();%                                                                                                                                                                               
