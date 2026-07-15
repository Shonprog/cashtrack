const DEFAULT_SETTINGS = {
  base: 11000, travel: 300, hours: 182, pension: 6, creditPoints: 2.25,
  creditValue: 242, breakMinutes: 30, niCeiling: 7703, niLow: 0.0427,
  niHigh: 0.1217, tax: [[7010,.1],[10060,.14],[16150,.2],[22440,.31],[46690,.35],[60130,.47],[1e9,.5]]
};
const DEFAULT_MONTH = {
  currentBalance: null,
  creditBase: null,
  fixedBase: 0,
  extra: 0,
  monthlyBudget: 1500,
  budgetBaseSpent: 0,
  carriedBalance: false,
  balanceSource: null,
  pensionOverride: null,
  manualNet: null,
  retroPension: 0
};
const K = {
  s:'ct.s', r:'ct.r', a:'ct.a', legacyFinance:'ct.f',
  months:'ct.financeMonths.v1', financePrefs:'ct.financePrefs.v1',
  creditEntries:'ct.creditEntries.v1', recurring:'ct.recurring.v1'
};
const load = (key,fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key,value) => localStorage.setItem(key,JSON.stringify(value));
const makeId = () => globalThis.crypto?.randomUUID?.() || `ct-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const money = value => {
  const amount=Number(value)||0;
  const hasAgorot=Math.abs(amount-Math.round(amount))>0.000001;
  return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:hasAgorot?2:0,maximumFractionDigits:2}).format(amount);
};
function parseDecimalInput(value){
  let text=String(value??'').trim().replace(/[₪\s\u00A0]/g,'').replace(/[’']/g,'');
  if(text==='') return null;
  const commas=(text.match(/,/g)||[]).length,dots=(text.match(/\./g)||[]).length;
  if(commas&&dots){const decimal=text.lastIndexOf(',')>text.lastIndexOf('.')?',':'.';const thousands=decimal===','?'.':',';text=text.split(thousands).join('').replace(decimal,'.');}
  else if(commas){const parts=text.split(',');text=commas===1&&parts[1].length<=2?`${parts[0]}.${parts[1]}`:parts.join('');}
  else if(dots){const parts=text.split('.');if(dots===1&&parts[1].length===3) text=parts.join('');else if(dots>1){const last=parts.at(-1);text=last.length<=2?`${parts.slice(0,-1).join('')}.${last}`:parts.join('');}}
  text=text.replace(/[^0-9.\-]/g,'');
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;
}
const inputNumber = value => value===null||value===undefined||value===''?'':String(Number(value));
const escapeHTML = value => String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const pad = n => String(n).padStart(2,'0');
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const monthKeyFromDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
const currentMonthKey = () => monthKeyFromDate(new Date());
function monthKeyOffset(monthKey,delta){
  const [year,month]=monthKey.split('-').map(Number);
  return monthKeyFromDate(new Date(year,month-1+delta,1));
}
function monthLabel(monthKey){
  const [year,month]=monthKey.split('-').map(Number);
  return new Date(year,month-1,1).toLocaleDateString('he-IL',{month:'long',year:'numeric'});
}
function daysInMonth(monthKey){
  const [year,month]=monthKey.split('-').map(Number);
  return new Date(year,month,0).getDate();
}
function defaultDateForMonth(monthKey){
  return monthKey===currentMonthKey()?dateStr(new Date()):`${monthKey}-01`;
}
function isValidMonthKey(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));}

let settings={...DEFAULT_SETTINGS,...load(K.s,{})};
let records=load(K.r,[]);
let activeShift=load(K.a,null);
let creditEntries=load(K.creditEntries,[]);
let recurringPayments=load(K.recurring,[]);
let financePrefs={monthlyBudget:1500,...load(K.financePrefs,{})};
let financeMonths=load(K.months,{});

function normalizeMonthData(raw={}){
  return {
    ...DEFAULT_MONTH,
    ...raw,
    currentBalance: raw.currentBalance===undefined?null:raw.currentBalance,
    creditBase: raw.creditBase===undefined?null:raw.creditBase,
    fixedBase: Number(raw.fixedBase??0),
    extra: Number(raw.extra??0),
    monthlyBudget: Number(raw.monthlyBudget??financePrefs.monthlyBudget??1500),
    budgetBaseSpent: Number(raw.budgetBaseSpent??0),
    carriedBalance: Boolean(raw.carriedBalance),
    balanceSource: raw.balanceSource ?? (raw.carriedBalance ? 'legacy-carry' : null),
    pensionOverride: raw.pensionOverride===null||raw.pensionOverride===undefined||raw.pensionOverride==='' ? null : Number(raw.pensionOverride),
    manualNet: raw.manualNet===null||raw.manualNet===undefined||raw.manualNet==='' ? null : Number(raw.manualNet),
    retroPension: Number(raw.retroPension??0)
  };
}
function migrateLegacyFinance(){
  if(Object.keys(financeMonths).length) return;
  const legacy=load(K.legacyFinance,null);
  if(!legacy) return;
  const month=currentMonthKey();
  const migrated={
    currentBalance: legacy.currentBalance??null,
    creditBase: legacy.creditBase??legacy.credit??null,
    fixedBase: legacy.fixedBase??legacy.fixed??0,
    extra: legacy.extra??0,
    monthlyBudget: legacy.monthlyBudget??1500,
    budgetBaseSpent: legacy.budgetBaseSpent??legacy.discretionarySpent??0,
    carriedBalance:false,
    createdAt:new Date().toISOString(),
    migratedFrom:'v10'
  };
  financeMonths[month]=normalizeMonthData(migrated);
  financePrefs.monthlyBudget=financeMonths[month].monthlyBudget;
  save(K.months,financeMonths);save(K.financePrefs,financePrefs);
}
migrateLegacyFinance();

function latestMonthBefore(monthKey){
  return Object.keys(financeMonths).filter(isValidMonthKey).filter(key=>key<monthKey).sort().at(-1)||null;
}
const roundMoney = value => Math.round((Number(value)+Number.EPSILON)*100)/100;

function expectedClosingBalance(monthKey){
  if(!monthKey||!financeMonths[monthKey]) return null;
  const finance=normalizeMonthData(financeMonths[monthKey]);
  if(finance.currentBalance===null||finance.creditBase===null) return null;
  const salary=calculateSalary(monthKey);
  const totals=financeTotals(monthKey);
  return roundMoney(
    Number(finance.currentBalance)
    + salary.netMonth
    + Number(finance.extra||0)
    - totals.totalCredit
    - totals.totalFixed
  );
}

function ensureMonthBucket(monthKey){
  if(financeMonths[monthKey]){
    const existing=normalizeMonthData(financeMonths[monthKey]);

    // A balance that was carried automatically remains an estimate.
    // Recalculate it from the previous month's expected closing balance
    // until the user confirms/edits the current month's balance manually.
    if(existing.carriedBalance){
      const previousKey=
        (isValidMonthKey(existing.carriedFrom)&&financeMonths[existing.carriedFrom])
          ? existing.carriedFrom
          : latestMonthBefore(monthKey);
      const forecast=previousKey?expectedClosingBalance(previousKey):null;
      if(forecast!==null){
        existing.currentBalance=forecast;
        existing.balanceSource='forecast';
        existing.carriedFrom=previousKey;
        existing.forecastUpdatedAt=new Date().toISOString();
      }
    }

    financeMonths[monthKey]=existing;
    save(K.months,financeMonths);
    return financeMonths[monthKey];
  }

  const previousKey=latestMonthBefore(monthKey);
  const previous=previousKey?normalizeMonthData(financeMonths[previousKey]):null;
  const forecast=previousKey?expectedClosingBalance(previousKey):null;
  const fallbackBalance=previous?.currentBalance??null;
  const openingBalance=forecast!==null?forecast:fallbackBalance;
  const hasOpeningBalance=openingBalance!==null&&openingBalance!==undefined;

  financeMonths[monthKey]=normalizeMonthData({
    currentBalance:openingBalance,
    creditBase:null,
    fixedBase:0,
    extra:0,
    monthlyBudget:previous?.monthlyBudget??financePrefs.monthlyBudget??1500,
    budgetBaseSpent:0,
    pensionOverride:null,
    manualNet:null,
    retroPension:0,
    carriedBalance:hasOpeningBalance,
    balanceSource:forecast!==null?'forecast':(hasOpeningBalance?'previous-balance':null),
    createdAt:new Date().toISOString(),
    carriedFrom:previousKey
  });
  save(K.months,financeMonths);
  return financeMonths[monthKey];
}
ensureMonthBucket(currentMonthKey());
let selectedMonthKey=currentMonthKey();
const selectedFinance = () => ensureMonthBucket(selectedMonthKey);

function parseDateTime(date,time){const[y,m,d]=date.split('-').map(Number);const[h,min]=time.split(':').map(Number);return new Date(y,m-1,d,h,min);}
function presenceHours(row){const start=parseDateTime(row.date,row.in);let end=parseDateTime(row.date,row.out);if(end<start)end=new Date(end.getTime()+86400000);return Math.max(0,(end-start)/3600000);}
function paidHours(row){return Math.max(0,presenceHours(row)-Number(row.breakMinutes??settings.breakMinutes)/60);}
function incomeTax(income,scale){let previous=0,total=0;for(const[ceiling,rate]of settings.tax){const scaled=ceiling*scale,slice=Math.min(income,scaled)-previous;if(slice>0)total+=slice*rate;previous=scaled;if(income<=scaled)break;}return Math.max(0,total-settings.creditPoints*settings.creditValue*scale);}
function nationalInsurance(income,scale){const ceiling=settings.niCeiling*scale,low=Math.min(income,ceiling),high=Math.max(0,income-ceiling);return low*settings.niLow+high*settings.niHigh;}
function monthRows(monthKey=selectedMonthKey){
  const today=dateStr(new Date());
  return records.filter(row=>String(row.date||'').slice(0,7)===monthKey&&(monthKey!==currentMonthKey()||row.date<=today)).sort((a,b)=>a.date.localeCompare(b.date));
}
function calculateSalary(monthKey=selectedMonthKey){
  const finance=ensureMonthBucket(monthKey);
  const pensionRate=finance.pensionOverride===null ? Number(settings.pension) : Number(finance.pensionOverride);
  const manualNet=finance.manualNet===null ? null : Number(finance.manualNet);
  const retroPension=Math.max(0,Number(finance.retroPension||0));

  const rows=monthRows(monthKey),hourly=settings.base/settings.hours;let regular=0,ot125=0,ot150=0,totalPaid=0,days=0;
  for(const row of rows){const presence=presenceHours(row),paid=paidHours(row),overtime=Math.max(0,presence-9);regular+=Math.min(paid,8.5);ot125+=Math.min(2,overtime);ot150+=Math.max(0,overtime-2);totalPaid+=paid;if(presence>0)days++;}
  const regularPay=Math.min(regular,settings.hours)*hourly,pay125=ot125*hourly*1.25,pay150=ot150*hourly*1.5,travel=Math.min(settings.travel,days*(settings.travel/21.67));
  const gross=regularPay+pay125+pay150+travel,progress=Math.max(Math.min(regular/settings.hours,1),0.0001);
  const net=Math.max(0,gross-incomeTax(gross,progress)-nationalInsurance(gross,progress)-(regularPay+pay125+pay150)*(pensionRate/100));
  const grossMonth=settings.base+settings.travel+pay125+pay150;
  const calculatedNetMonth=Math.max(0,grossMonth-incomeTax(grossMonth,1)-nationalInsurance(grossMonth,1)-(settings.base+pay125+pay150)*(pensionRate/100)-retroPension);
  const netMonth=manualNet===null?calculatedNetMonth:Math.max(0,manualNet);
  return{rows,regular,ot125,ot150,totalPaid,gross,net,grossMonth,netMonth,calculatedNetMonth,pensionRate,manualNet,retroPension};
}
function upsert(row){const index=records.findIndex(item=>item.date===row.date);if(index>=0)records[index]={...row,id:records[index].id||row.id};else records.push(row);save(K.r,records);}
function entryMonthKey(entry){return isValidMonthKey(entry?.billingMonth)?entry.billingMonth:String(entry?.date||'').slice(0,7);}
function creditEntriesForMonth(monthKey=selectedMonthKey){return creditEntries.filter(entry=>entryMonthKey(entry)===monthKey).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));}
function recurringApplies(item,monthKey=selectedMonthKey){
  const start=isValidMonthKey(item.startMonth)?item.startMonth:'0000-01';
  const end=isValidMonthKey(item.endMonth)?item.endMonth:null;
  if(item.active===false&&!end) return false;
  return start<=monthKey&&(!end||monthKey<=end);
}
function recurringForMonth(monthKey=selectedMonthKey){return recurringPayments.filter(item=>recurringApplies(item,monthKey));}
function financeTotals(monthKey=selectedMonthKey){
  const finance=ensureMonthBucket(monthKey);
  const entries=creditEntriesForMonth(monthKey);
  const addedCredit=entries.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const totalCredit=Number(finance.creditBase||0)+addedCredit;
  const recurringItems=recurringForMonth(monthKey);
  const recurringTotal=recurringItems.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const totalFixed=Number(finance.fixedBase||0)+recurringTotal;
  const budgetEntries=entries.filter(item=>item.countsBudget!==false).reduce((sum,item)=>sum+Number(item.amount||0),0);
  const budgetSpent=Number(finance.budgetBaseSpent||0)+budgetEntries;
  const remainingBudget=Number(finance.monthlyBudget||0)-budgetSpent;
  return{entries,addedCredit,totalCredit,recurringItems,recurringTotal,totalFixed,budgetSpent,remainingBudget};
}


const OCR_NOISE_WORDS=[
  'עסקאות','פעולות','סטטוס','הטבות','חיפוש','הגדרות','פריסה לתשלומים',
  'פלטינה','מאסטרקארד','mastercard','5g','תשלום','מתוך'
];

function normalizeOCRLine(value){
  return String(value??'')
    .replace(/[|]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function normalizeMerchant(value){
  return normalizeOCRLine(value)
    .replace(/[₪]/g,'')
    .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/g,'')
    .replace(/\b\d[\d,.]*\b/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}
function parseOCRDate(value){
  const text=normalizeOCRLine(value).replace(/[Oo]/g,'0');
  const match=text.match(/\b([0-3]?\d)[.\/-]([01]?\d)[.\/-](\d{2}|\d{4})\b/);
  if(!match) return null;
  const day=Number(match[1]),month=Number(match[2]);
  let year=Number(match[3]);
  if(year<100) year+=2000;
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}
function parseOCRAmount(value){
  const text=normalizeOCRLine(value)
    .replace(/[Oo]/g,'0')
    .replace(/[Il]/g,'1');
  if(parseOCRDate(text)) return null;
  const currencyMatch=text.match(/(?:₪|ש["״']?ח)\s*([0-9][0-9,.\s]*)|([0-9][0-9,.\s]*)\s*(?:₪|ש["״']?ח)/i);
  const genericMatch=text.match(/\b([0-9]{1,3}(?:[,][0-9]{3})*(?:[.][0-9]{1,2})|[0-9]+[.][0-9]{1,2})\b/);
  const raw=(currencyMatch?.[1]||currencyMatch?.[2]||genericMatch?.[1]||'').replace(/\s/g,'');
  if(!raw) return null;
  const amount=parseDecimalInput(raw);
  return amount!==null&&amount>0&&amount<1000000?roundMoney(amount):null;
}
function isOCRNoise(value){
  const text=normalizeOCRLine(value).toLowerCase();
  if(!text) return true;
  if(parseOCRDate(text)||parseOCRAmount(text)!==null) return true;
  if(OCR_NOISE_WORDS.some(word=>text===word||text.includes(word))) return true;
  if(!/[\u0590-\u05ffA-Za-z]/.test(text)) return true;
  return false;
}
function detectInstallmentText(lines,index){
  for(let offset=-3;offset<=3;offset++){
    const text=normalizeOCRLine(lines[index+offset]||'');
    const match=text.match(/תשלום\s*(\d+)\s*מתוך\s*(\d+)/);
    if(match) return `תשלום ${match[1]} מתוך ${match[2]}`;
  }
  return '';
}
function budgetDefaultForImported(description,installmentText=''){
  const text=String(description||'').toLowerCase();
  if(installmentText) return false;
  return !/(העברה|bit|ביט|תשלום|הורים|קורס|מלון|טיסה|טיפול|אייפון|iphone)/i.test(text);
}
function transactionFingerprint(transaction,billingMonth){
  const amount=roundMoney(Number(transaction.amount||0)).toFixed(2);
  return [
    billingMonth||transaction.billingMonth||String(transaction.date||'').slice(0,7),
    String(transaction.date||''),
    normalizeMerchant(transaction.description||''),
    amount
  ].join('|');
}
function transactionExists(transaction,billingMonth,entries=creditEntries){
  const fingerprint=transactionFingerprint(transaction,billingMonth);
  return entries.some(entry=>transactionFingerprint(entry,entryMonthKey(entry))===fingerprint);
}
function parseTransactionsFromText(rawText,monthKey){
  const lines=String(rawText||'').split(/\r?\n/).map(normalizeOCRLine).filter(Boolean);
  const candidates=[];
  for(let index=0;index<lines.length;index++){
    const amount=parseOCRAmount(lines[index]);
    if(amount===null) continue;

    let date=null,dateIndex=-1;
    for(let distance=0;distance<=4&&!date;distance++){
      for(const candidateIndex of [index-distance,index+distance]){
        if(candidateIndex<0||candidateIndex>=lines.length) continue;
        const parsed=parseOCRDate(lines[candidateIndex]);
        if(parsed){date=parsed;dateIndex=candidateIndex;break;}
      }
    }

    let description='',bestScore=-Infinity;
    const center=dateIndex>=0?dateIndex:index;
    for(let candidateIndex=Math.max(0,center-4);candidateIndex<=Math.min(lines.length-1,center+3);candidateIndex++){
      const line=lines[candidateIndex];
      if(isOCRNoise(line)) continue;
      let score=0;
      if(candidateIndex<center) score+=6-(center-candidateIndex);
      else score+=2-(candidateIndex-center);
      if(/[\u0590-\u05ff]/.test(line)) score+=2;
      if(line.length>2&&line.length<55) score+=1;
      if(score>bestScore){description=line;bestScore=score;}
    }

    if(!description) description='עסקה שזוהתה';
    const installmentText=detectInstallmentText(lines,dateIndex>=0?dateIndex:index);
    candidates.push({
      id:makeId(),
      description,
      amount,
      date:date||defaultDateForMonth(monthKey),
      originalDateDetected:Boolean(date),
      installmentText,
      countsBudget:budgetDefaultForImported(description,installmentText),
      selected:true,
      confidence:date&&description!=='עסקה שזוהתה'?'good':'review'
    });
  }

  const unique=[];
  const seen=new Set();
  for(const item of candidates){
    const key=transactionFingerprint(item,monthKey);
    if(seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
function flattenOCRLines(result){
  const direct=result?.data?.lines;
  if(Array.isArray(direct)&&direct.length){
    return direct.map(line=>({
      text:normalizeOCRLine(line.text),
      bbox:line.bbox||null
    })).filter(line=>line.text);
  }
  const output=[];
  const visit=node=>{
    if(!node) return;
    if(Array.isArray(node)){node.forEach(visit);return;}
    if(node.text&&node.bbox&&(!node.lines||!node.lines.length)){
      output.push({text:normalizeOCRLine(node.text),bbox:node.bbox});
    }
    ['blocks','paragraphs','lines'].forEach(key=>visit(node[key]));
  };
  visit(result?.data?.blocks);
  return output.filter(line=>line.text);
}
function parseTransactionsFromPositionedLines(result,monthKey,imageWidth){
  const lines=flattenOCRLines(result);
  if(!lines.length||!imageWidth) return [];
  const amountLines=lines.filter(line=>{
    const amount=parseOCRAmount(line.text);
    const x0=Number(line.bbox?.x0??imageWidth);
    return amount!==null&&x0<imageWidth*.62;
  });
  const dateLines=lines.filter(line=>parseOCRDate(line.text));
  const textLines=lines.filter(line=>!isOCRNoise(line.text));

  const parsed=[];
  for(const amountLine of amountLines){
    const amount=parseOCRAmount(amountLine.text);
    const ay=(Number(amountLine.bbox?.y0||0)+Number(amountLine.bbox?.y1||0))/2;
    const dateLine=dateLines
      .map(line=>({line,distance:Math.abs(((Number(line.bbox?.y0||0)+Number(line.bbox?.y1||0))/2)-ay)}))
      .filter(item=>item.distance<150)
      .sort((a,b)=>a.distance-b.distance)[0]?.line||null;
    const date=dateLine?parseOCRDate(dateLine.text):null;
    const dy=dateLine?((Number(dateLine.bbox?.y0||0)+Number(dateLine.bbox?.y1||0))/2):ay;
    const descriptionLine=textLines
      .map(line=>{
        const ly=(Number(line.bbox?.y0||0)+Number(line.bbox?.y1||0))/2;
        const x0=Number(line.bbox?.x0||0);
        const above=ly<=dy+18;
        const score=Math.abs(ly-dy)+(above?0:70)+(x0<imageWidth*.42?70:0);
        return {line,score};
      })
      .filter(item=>item.score<190)
      .sort((a,b)=>a.score-b.score)[0]?.line||null;
    const description=descriptionLine?.text||'עסקה שזוהתה';
    const allText=lines.map(line=>line.text);
    const dateIndex=dateLine?allText.indexOf(dateLine.text):-1;
    const installmentText=detectInstallmentText(allText,dateIndex>=0?dateIndex:0);
    parsed.push({
      id:makeId(),
      description,
      amount,
      date:date||defaultDateForMonth(monthKey),
      originalDateDetected:Boolean(date),
      installmentText,
      countsBudget:budgetDefaultForImported(description,installmentText),
      selected:true,
      confidence:date&&description!=='עסקה שזוהתה'?'good':'review'
    });
  }
  const unique=[];
  const seen=new Set();
  for(const item of parsed){
    const key=transactionFingerprint(item,monthKey);
    if(seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
function mergeParsedTransactions(primary,secondary,monthKey){
  const merged=[];
  const seen=new Set();
  for(const item of [...primary,...secondary]){
    const key=transactionFingerprint(item,monthKey);
    if(seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

window.addEventListener('DOMContentLoaded',()=>{
  const $=id=>document.getElementById(id);
  const el={
    settingsBtn:$('settingsBtn'),settingsOverlay:$('settingsOverlay'),closeSettings:$('closeSettings'),settingsForm:$('settingsForm'),setBase:$('setBase'),setTravel:$('setTravel'),setHours:$('setHours'),setPension:$('setPension'),setCreditPoints:$('setCreditPoints'),setBreak:$('setBreak'),
    prevMonthBtn:$('prevMonthBtn'),nextMonthBtn:$('nextMonthBtn'),goCurrentMonthBtn:$('goCurrentMonthBtn'),monthLabel:$('monthLabel'),monthHint:$('monthHint'),
    homeNetToday:$('homeNetToday'),homeNetMonth:$('homeNetMonth'),homeCredit:$('homeCredit'),homeExpectedBalance:$('homeExpectedBalance'),homeSpendable:$('homeSpendable'),homeBudgetText:$('homeBudgetText'),
    salaryRegularHours:$('salaryRegularHours'),salaryOt125:$('salaryOt125'),salaryOt150:$('salaryOt150'),salaryGrossToday:$('salaryGrossToday'),salaryNetToday:$('salaryNetToday'),salaryGrossMonth:$('salaryGrossMonth'),salaryNetMonth:$('salaryNetMonth'),salaryNetNote:$('salaryNetNote'),monthlySalaryForm:$('monthlySalaryForm'),monthlyPensionMode:$('monthlyPensionMode'),monthlyPensionCustomWrap:$('monthlyPensionCustomWrap'),monthlyPensionCustom:$('monthlyPensionCustom'),monthlyManualNet:$('monthlyManualNet'),monthlyRetroPension:$('monthlyRetroPension'),monthlySalaryNote:$('monthlySalaryNote'),todayDate:$('todayDate'),todayIn:$('todayIn'),todayOut:$('todayOut'),todaySummary:$('todaySummary'),clockInBtn:$('clockInBtn'),clockOutBtn:$('clockOutBtn'),
    recordsList:$('recordsList'),manualForm:$('manualForm'),manualDate:$('manualDate'),manualIn:$('manualIn'),manualOut:$('manualOut'),manualBreak:$('manualBreak'),
    financeForm:$('financeForm'),currentBalance:$('currentBalance'),creditBase:$('creditBase'),fixedBase:$('fixedBase'),extraIncome:$('extraIncome'),monthlyBudget:$('monthlyBudget'),budgetBaseSpent:$('budgetBaseSpent'),monthFinanceNote:$('monthFinanceNote'),
    screenshotFiles:$('screenshotFiles'),screenshotThumbs:$('screenshotThumbs'),analyzeScreenshotsBtn:$('analyzeScreenshotsBtn'),ocrStatus:$('ocrStatus'),ocrProgressBar:$('ocrProgressBar'),ocrStatusText:$('ocrStatusText'),importPreview:$('importPreview'),importPreviewRows:$('importPreviewRows'),addPreviewRowBtn:$('addPreviewRowBtn'),clearImportBtn:$('clearImportBtn'),confirmImportBtn:$('confirmImportBtn'),
    creditExpenseForm:$('creditExpenseForm'),creditDescription:$('creditDescription'),creditAmount:$('creditAmount'),creditDate:$('creditDate'),creditCountsBudget:$('creditCountsBudget'),creditExpensesList:$('creditExpensesList'),creditTotalBadge:$('creditTotalBadge'),
    recurringForm:$('recurringForm'),recurringName:$('recurringName'),recurringAmount:$('recurringAmount'),recurringDay:$('recurringDay'),recurringType:$('recurringType'),recurringList:$('recurringList'),recurringTotalBadge:$('recurringTotalBadge'),
    bankCreditTotal:$('bankCreditTotal'),bankFixedTotal:$('bankFixedTotal'),bankExpected:$('bankExpected'),bankSpendable:$('bankSpendable'),bankGrowth:$('bankGrowth')
  };

  function setSelectedMonth(monthKey){
    selectedMonthKey=monthKey;
    ensureMonthBucket(monthKey);
    el.manualDate.value=defaultDateForMonth(monthKey);
    el.creditDate.value=defaultDateForMonth(monthKey);
    if(typeof clearScreenshotImport==='function') clearScreenshotImport();
    render();
  }
  function renderMonthSwitcher(){
    const current=currentMonthKey(),finance=selectedFinance(),isCurrent=selectedMonthKey===current;
    el.monthLabel.textContent=monthLabel(selectedMonthKey);
    if(isCurrent&&finance.carriedBalance&&finance.balanceSource==='forecast'){el.monthHint.textContent='חודש חדש · יתרת פתיחה משוערת חושבה אוטומטית';}
    else if(isCurrent&&finance.carriedBalance){el.monthHint.textContent='חודש חדש · יתרת פתיחה הועברה אוטומטית';}
    else if(isCurrent){el.monthHint.textContent=`החודש הנוכחי · ${daysInMonth(selectedMonthKey)} ימים`;}
    else{el.monthHint.textContent='חודש שמור · לחיצה תחזיר לחודש הנוכחי';}
    el.nextMonthBtn.disabled=isCurrent;
    el.goCurrentMonthBtn.classList.toggle('past-month',!isCurrent);
    el.goCurrentMonthBtn.title=isCurrent?'החודש הנוכחי':'חזרה לחודש הנוכחי';
  }
  function renderCreditEntries(items){
    el.creditExpensesList.innerHTML=items.length?'':'<div class="empty-ledger">אין הוצאות אשראי שנוספו בחודש הזה</div>';
    for(const item of items){
      const row=document.createElement('div');row.className='ledger-row';
      const budgetLabel=item.countsBudget!==false?'<span class="mini-tag">בתקציב</span>':'<span class="mini-tag neutral">לא בתקציב</span>';
      const installmentLabel=item.installmentText?`<span class="mini-tag neutral">${escapeHTML(item.installmentText)}</span>`:'';
      const importLabel=item.importedFrom==='screenshot'?'<span class="mini-tag neutral">מצילום</span>':'';
      const billingLabel=item.billingMonth&&String(item.date||'').slice(0,7)!==item.billingMonth?`<span class="mini-tag neutral">חיוב ב${escapeHTML(monthLabel(item.billingMonth))}</span>`:'';
      row.innerHTML=`<div class="ledger-main"><strong>${escapeHTML(item.description||'הוצאה')}</strong><small>${new Date(item.date+'T12:00').toLocaleDateString('he-IL')} ${budgetLabel}${installmentLabel}${importLabel}${billingLabel}</small></div><div class="ledger-amount">${money(item.amount)}</div><button class="delete-btn" type="button" aria-label="מחיקת הוצאה">✕</button>`;
      row.querySelector('.delete-btn').addEventListener('click',()=>{if(confirm(`למחוק את ההוצאה "${item.description}"?`)){creditEntries=creditEntries.filter(x=>x.id!==item.id);save(K.creditEntries,creditEntries);render();}});
      el.creditExpensesList.appendChild(row);
    }
  }
  function renderRecurring(items){
    const typeLabels={standing:'הוראת קבע',fixed:'תשלום קבוע',other:'אחר'};
    el.recurringList.innerHTML=items.length?'':'<div class="empty-ledger">אין תשלומים קבועים שחלים בחודש הזה</div>';
    for(const item of items){
      const row=document.createElement('div');row.className='ledger-row';
      const day=item.day?` · יום ${item.day} בחודש`:'';
      row.innerHTML=`<div class="ledger-main"><strong>${escapeHTML(item.name)}</strong><small>${typeLabels[item.type]||'תשלום קבוע'}${day}</small></div><div class="ledger-amount">${money(item.amount)}</div><button class="delete-btn" type="button" aria-label="הפסקת תשלום">✕</button>`;
      row.querySelector('.delete-btn').addEventListener('click',()=>{
        const start=isValidMonthKey(item.startMonth)?item.startMonth:'0000-01';
        const label=monthLabel(selectedMonthKey);
        if(!confirm(`להפסיק את התשלום "${item.name}" החל מ${label}? החודשים הקודמים יישמרו.`)) return;
        if(start>=selectedMonthKey){recurringPayments=recurringPayments.filter(x=>x.id!==item.id);}
        else{item.endMonth=monthKeyOffset(selectedMonthKey,-1);}
        save(K.recurring,recurringPayments);render();
      });
      el.recurringList.appendChild(row);
    }
  }
  function render(){
    const finance=selectedFinance(),salary=calculateSalary(),totals=financeTotals();
    const ready=finance.currentBalance!==null&&finance.creditBase!==null;
    const expected=ready?Number(finance.currentBalance)+salary.netMonth+Number(finance.extra||0)-totals.totalCredit-totals.totalFixed:0;
    const growth=ready?expected-Number(finance.currentBalance):0;
    const now=new Date(),today=dateStr(now),todayRow=salary.rows.find(row=>row.date===today),isCurrent=selectedMonthKey===currentMonthKey();

    renderMonthSwitcher();
    el.homeNetToday.textContent=money(salary.net);el.homeNetMonth.textContent=money(salary.netMonth);el.homeCredit.textContent=finance.creditBase===null?'טרם הוזן':money(totals.totalCredit);el.homeExpectedBalance.textContent=ready?money(expected):'טרם הוזן';
    el.homeSpendable.textContent=money(totals.remainingBudget);el.homeSpendable.classList.toggle('negative-value',totals.remainingBudget<0);el.homeBudgetText.textContent=totals.remainingBudget>=0?`נוצל ${money(totals.budgetSpent)} מתוך ${money(finance.monthlyBudget)}`:`חריגה של ${money(Math.abs(totals.remainingBudget))} מהתקציב`;
    el.salaryRegularHours.textContent=salary.regular.toFixed(1);el.salaryOt125.textContent=salary.ot125.toFixed(1);el.salaryOt150.textContent=salary.ot150.toFixed(1);el.salaryGrossToday.textContent=money(salary.gross);el.salaryNetToday.textContent=money(salary.net);el.salaryGrossMonth.textContent=money(salary.grossMonth);el.salaryNetMonth.textContent=money(salary.netMonth);
    el.salaryNetNote.textContent=salary.manualNet!==null
      ? `משתמש בנטו ידני לחודש הזה. החישוב האוטומטי היה ${money(salary.calculatedNetMonth)}.`
      : `חישוב אוטומטי לפי פנסיה של ${salary.pensionRate}%${salary.retroPension>0?` וניכוי רטרו של ${money(salary.retroPension)}`:''}.`;

    const pensionOverride=finance.pensionOverride;
    if(pensionOverride===null){
      el.monthlyPensionMode.value='default';
    }else if(Number(pensionOverride)===0){
      el.monthlyPensionMode.value='zero';
    }else{
      el.monthlyPensionMode.value='custom';
    }
    el.monthlyPensionCustomWrap.hidden=el.monthlyPensionMode.value!=='custom';
    el.monthlyPensionCustom.value=pensionOverride!==null&&Number(pensionOverride)!==0?inputNumber(pensionOverride):'';
    el.monthlyManualNet.value=inputNumber(finance.manualNet);
    el.monthlyRetroPension.value=inputNumber(finance.retroPension??0);
    el.monthlySalaryNote.textContent=finance.pensionOverride===null
      ? `החודש משתמש בברירת המחדל: ${settings.pension}% פנסיה.`
      : `החודש הוגדר ידנית: ${salary.pensionRate}% פנסיה. בחודש חדש תחזור ברירת המחדל של ${settings.pension}%.`;

    el.clockInBtn.disabled=!isCurrent;el.clockOutBtn.disabled=!isCurrent;
    if(isCurrent){
      el.todayDate.textContent=now.toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});el.todayIn.textContent=todayRow?.in||activeShift?.in||'--:--';el.todayOut.textContent=todayRow?.out||'--:--';el.todaySummary.textContent=todayRow?`${presenceHours(todayRow).toFixed(1)} שעות נוכחות · ${paidHours(todayRow).toFixed(1)} שעות בתשלום`:activeShift?'משמרת פעילה':'טרם דווחה משמרת היום';
    }else{
      el.todayDate.textContent=monthLabel(selectedMonthKey);el.todayIn.textContent='--:--';el.todayOut.textContent='--:--';el.todaySummary.textContent='מצב היסטוריה: ניתן להוסיף או לתקן ימים ידנית';
    }

    el.currentBalance.value=inputNumber(finance.currentBalance);el.creditBase.value=inputNumber(finance.creditBase);el.fixedBase.value=inputNumber(finance.fixedBase??0);el.extraIncome.value=inputNumber(finance.extra??0);el.monthlyBudget.value=inputNumber(finance.monthlyBudget??1500);el.budgetBaseSpent.value=inputNumber(finance.budgetBaseSpent??0);
    if(finance.carriedBalance&&finance.balanceSource==='forecast'){
      const sourceLabel=finance.carriedFrom?monthLabel(finance.carriedFrom):'החודש הקודם';
      el.monthFinanceNote.textContent=`יתרת הפתיחה המשוערת חושבה לפי היתרה הצפויה בסוף ${sourceLabel}. לאחר בדיקה בבנק אפשר לעדכן אותה ליתרה האמיתית.`;
    }else if(finance.carriedBalance){
      el.monthFinanceNote.textContent='יתרת הפתיחה הועברה מהחודש הקודם כי לא היו מספיק נתונים לחישוב תחזית מלאה. מומלץ לעדכן אותה לפי הבנק.';
    }else{
      el.monthFinanceNote.textContent='הנתונים נשמרים בנפרד עבור החודש הנבחר. במעבר לחודש חדש האשראי, ההכנסה הנוספת והניצול מתאפסים.';
    }
    el.creditTotalBadge.textContent=money(totals.totalCredit);el.recurringTotalBadge.textContent=money(totals.recurringTotal);el.bankCreditTotal.textContent=finance.creditBase===null?'טרם הוזן':money(totals.totalCredit);el.bankFixedTotal.textContent=money(totals.totalFixed);el.bankExpected.textContent=ready?money(expected):'טרם הוזן';el.bankSpendable.textContent=money(totals.remainingBudget);el.bankSpendable.classList.toggle('negative-value',totals.remainingBudget<0);el.bankGrowth.textContent=ready?money(growth):'טרם הוזן';el.bankGrowth.classList.toggle('negative-value',ready&&growth<0);el.bankGrowth.classList.toggle('positive-value',ready&&growth>=0);
    renderCreditEntries(totals.entries);renderRecurring(totals.recurringItems);

    el.recordsList.innerHTML=salary.rows.length?'':'<div class="record"><small>אין דיווחים בחודש הזה</small></div>';
    [...salary.rows].reverse().forEach(row=>{const item=document.createElement('div');item.className='record';item.innerHTML=`<div><strong>${new Date(row.date+'T12:00').toLocaleDateString('he-IL')}</strong><br><small>${row.in}–${row.out} · ${paidHours(row).toFixed(2)} שעות בתשלום</small></div><button type="button">מחק</button>`;item.querySelector('button').addEventListener('click',()=>{records=records.filter(x=>x.id!==row.id);save(K.r,records);render();});el.recordsList.appendChild(item);});
  }


  let importPreviewRows=[];
  let screenshotObjectUrls=[];

  function revokeScreenshotUrls(){
    screenshotObjectUrls.forEach(url=>URL.revokeObjectURL(url));
    screenshotObjectUrls=[];
  }
  function selectedScreenshotFiles(){
    return Array.from(el.screenshotFiles.files||[]);
  }
  function renderScreenshotThumbs(){
    revokeScreenshotUrls();
    const files=selectedScreenshotFiles();
    el.screenshotThumbs.innerHTML='';
    files.forEach(file=>{
      const url=URL.createObjectURL(file);
      screenshotObjectUrls.push(url);
      const figure=document.createElement('figure');
      figure.innerHTML=`<img src="${url}" alt=""><figcaption>${escapeHTML(file.name)}</figcaption>`;
      el.screenshotThumbs.appendChild(figure);
    });
    el.analyzeScreenshotsBtn.disabled=!files.length;
  }
  function setOCRStatus(text,progress=null,visible=true){
    el.ocrStatus.hidden=!visible;
    el.ocrStatusText.textContent=text;
    if(progress!==null){
      const percentage=Math.max(0,Math.min(100,Math.round(progress*100)));
      el.ocrProgressBar.style.width=`${percentage}%`;
    }
  }
  function loadTesseract(){
    if(window.Tesseract) return Promise.resolve(window.Tesseract);
    if(window.__cashTrackTesseractPromise) return window.__cashTrackTesseractPromise;
    window.__cashTrackTesseractPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async=true;
      script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('ספריית הזיהוי לא נטענה.'));
      script.onerror=()=>reject(new Error('לא ניתן לטעון את מנוע הזיהוי. בדוק שיש חיבור לאינטרנט.'));
      document.head.appendChild(script);
    });
    return window.__cashTrackTesseractPromise;
  }
  function imageDimensions(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const image=new Image();
      image.onload=()=>{resolve({width:image.naturalWidth,height:image.naturalHeight});URL.revokeObjectURL(url);};
      image.onerror=()=>{reject(new Error('לא ניתן לקרוא את התמונה.'));URL.revokeObjectURL(url);};
      image.src=url;
    });
  }
  function renderImportPreview(){
    el.importPreview.hidden=false;
    el.importPreviewRows.innerHTML='';
    if(!importPreviewRows.length){
      el.importPreviewRows.innerHTML='<div class="empty-ledger">לא נמצאו עסקאות. אפשר להוסיף שורה ידנית או לנסות צילום חד וברור יותר.</div>';
    }
    importPreviewRows.forEach((item,index)=>{
      const duplicate=transactionExists(item,selectedMonthKey);
      const row=document.createElement('div');
      row.className=`import-edit-row${duplicate?' duplicate-row':''}`;
      row.innerHTML=`
        <div class="import-select-line">
          <label class="check-row compact-check"><input class="preview-selected" type="checkbox" ${item.selected&&!duplicate?'checked':''}><span>לייבא</span></label>
          <button class="delete-btn remove-preview-row" type="button" aria-label="הסרת שורה">✕</button>
        </div>
        <label class="wide-field">שם העסק
          <input class="preview-description" type="text" value="${escapeHTML(item.description)}">
        </label>
        <label>סכום
          <input class="preview-amount" type="text" inputmode="decimal" value="${escapeHTML(inputNumber(item.amount))}">
        </label>
        <label>תאריך העסקה
          <input class="preview-date" type="date" value="${escapeHTML(item.date)}">
        </label>
        <label class="check-row wide-field compact-check"><input class="preview-budget" type="checkbox" ${item.countsBudget!==false?'checked':''}><span>לחשב בתקציב הבזבוזים</span></label>
        ${item.installmentText?`<small class="import-note">${escapeHTML(item.installmentText)}</small>`:''}
        ${!item.originalDateDetected?'<small class="import-warning">התאריך לא זוהה בוודאות — בדוק אותו.</small>':''}
        ${duplicate?'<small class="duplicate-warning">העסקה כנראה כבר קיימת באפליקציה ולכן אינה מסומנת לייבוא.</small>':''}
      `;
      const sync=()=>{
        item.selected=row.querySelector('.preview-selected').checked;
        item.description=row.querySelector('.preview-description').value.trim();
        item.amount=parseDecimalInput(row.querySelector('.preview-amount').value);
        item.date=row.querySelector('.preview-date').value;
        item.countsBudget=row.querySelector('.preview-budget').checked;
      };
      row.querySelectorAll('input').forEach(input=>input.addEventListener('change',sync));
      row.querySelector('.remove-preview-row').addEventListener('click',()=>{
        importPreviewRows.splice(index,1);
        renderImportPreview();
      });
      el.importPreviewRows.appendChild(row);
    });
  }
  function addBlankPreviewRow(){
    importPreviewRows.push({
      id:makeId(),
      description:'',
      amount:null,
      date:defaultDateForMonth(selectedMonthKey),
      originalDateDetected:false,
      installmentText:'',
      countsBudget:true,
      selected:true,
      confidence:'review'
    });
    renderImportPreview();
    el.importPreviewRows.querySelector('.import-edit-row:last-child .preview-description')?.focus();
  }
  async function analyzeScreenshots(){
    const files=selectedScreenshotFiles();
    if(!files.length){alert('יש לבחור לפחות צילום מסך אחד.');return;}
    el.analyzeScreenshotsBtn.disabled=true;
    setOCRStatus('טוען את מנוע הזיהוי…',0,true);
    try{
      const Tesseract=await loadTesseract();
      const parsedAll=[];
      for(let fileIndex=0;fileIndex<files.length;fileIndex++){
        const file=files[fileIndex];
        const dimensions=await imageDimensions(file);
        const result=await Tesseract.recognize(file,'heb+eng',{
          logger:message=>{
            const ownProgress=Number(message.progress||0);
            const totalProgress=(fileIndex+ownProgress)/files.length;
            const status=message.status==='recognizing text'?'מזהה טקסט':message.status==='loading language traineddata'?'טוען עברית ואנגלית':'מעבד צילום';
            setOCRStatus(`${status} ${fileIndex+1} מתוך ${files.length}…`,totalProgress,true);
          }
        });
        const positioned=parseTransactionsFromPositionedLines(result,selectedMonthKey,dimensions.width);
        const textual=parseTransactionsFromText(result?.data?.text||'',selectedMonthKey);
        parsedAll.push(...mergeParsedTransactions(positioned,textual,selectedMonthKey));
      }
      importPreviewRows=mergeParsedTransactions(parsedAll,[],selectedMonthKey).map(item=>({
        ...item,
        selected:!transactionExists(item,selectedMonthKey)
      }));
      setOCRStatus(`הזיהוי הסתיים — נמצאו ${importPreviewRows.length} עסקאות.`,1,true);
      renderImportPreview();
    }catch(error){
      console.error(error);
      setOCRStatus(error?.message||'הזיהוי נכשל. נסה צילום ברור יותר.',0,true);
      el.importPreview.hidden=false;
      if(!importPreviewRows.length) addBlankPreviewRow();
    }finally{
      el.analyzeScreenshotsBtn.disabled=false;
    }
  }
  function clearScreenshotImport(){
    importPreviewRows=[];
    el.importPreview.hidden=true;
    el.importPreviewRows.innerHTML='';
    el.ocrStatus.hidden=true;
    el.ocrProgressBar.style.width='0%';
    el.screenshotFiles.value='';
    renderScreenshotThumbs();
  }
  function confirmScreenshotImport(){
    const rows=Array.from(el.importPreviewRows.querySelectorAll('.import-edit-row'));
    rows.forEach((row,index)=>{
      const item=importPreviewRows[index];
      item.selected=row.querySelector('.preview-selected').checked;
      item.description=row.querySelector('.preview-description').value.trim();
      item.amount=parseDecimalInput(row.querySelector('.preview-amount').value);
      item.date=row.querySelector('.preview-date').value;
      item.countsBudget=row.querySelector('.preview-budget').checked;
    });
    const selected=importPreviewRows.filter(item=>item.selected);
    if(!selected.length){alert('לא נבחרו עסקאות לייבוא.');return;}
    const invalid=selected.find(item=>!item.description||item.amount===null||item.amount<=0||!item.date);
    if(invalid){alert('יש להשלים שם עסק, סכום ותאריך בכל עסקה מסומנת.');return;}

    let added=0,skipped=0;
    for(const item of selected){
      if(transactionExists(item,selectedMonthKey)){skipped++;continue;}
      creditEntries.push({
        id:makeId(),
        description:item.description,
        amount:roundMoney(item.amount),
        date:item.date,
        billingMonth:selectedMonthKey,
        countsBudget:item.countsBudget,
        installmentText:item.installmentText||'',
        importedFrom:'screenshot',
        createdAt:new Date().toISOString()
      });
      added++;
    }
    save(K.creditEntries,creditEntries);
    clearScreenshotImport();
    render();
    alert(`${added} עסקאות נוספו${skipped?` · ${skipped} כפילויות דולגו`:''}.`);
  }

  el.screenshotFiles.addEventListener('change',renderScreenshotThumbs);
  el.analyzeScreenshotsBtn.addEventListener('click',analyzeScreenshots);
  el.addPreviewRowBtn.addEventListener('click',addBlankPreviewRow);
  el.clearImportBtn.addEventListener('click',clearScreenshotImport);
  el.confirmImportBtn.addEventListener('click',confirmScreenshotImport);

  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));button.classList.add('active');document.getElementById(button.dataset.page).classList.add('active');}));
  el.prevMonthBtn.addEventListener('click',()=>setSelectedMonth(monthKeyOffset(selectedMonthKey,-1)));
  el.nextMonthBtn.addEventListener('click',()=>{if(selectedMonthKey<currentMonthKey())setSelectedMonth(monthKeyOffset(selectedMonthKey,1));});
  el.goCurrentMonthBtn.addEventListener('click',()=>{if(selectedMonthKey!==currentMonthKey())setSelectedMonth(currentMonthKey());});

  el.clockInBtn.addEventListener('click',()=>{if(selectedMonthKey!==currentMonthKey())return;if(activeShift)return alert('כבר קיימת משמרת פעילה');const now=new Date();activeShift={date:dateStr(now),in:timeStr(now)};save(K.a,activeShift);render();});
  el.clockOutBtn.addEventListener('click',()=>{if(selectedMonthKey!==currentMonthKey())return;if(!activeShift)return alert('לא קיימת משמרת פעילה');const now=new Date();upsert({id:makeId(),date:activeShift.date,in:activeShift.in,out:timeStr(now),breakMinutes:settings.breakMinutes});activeShift=null;localStorage.removeItem(K.a);render();});
  el.manualForm.addEventListener('submit',event=>{event.preventDefault();if(String(el.manualDate.value).slice(0,7)!==selectedMonthKey){alert(`התאריך צריך להיות בתוך ${monthLabel(selectedMonthKey)}.`);return;}upsert({id:makeId(),date:el.manualDate.value,in:el.manualIn.value,out:el.manualOut.value,breakMinutes:Number(el.manualBreak.value||30)});render();});

  el.monthlyPensionMode.addEventListener('change',()=>{
    el.monthlyPensionCustomWrap.hidden=el.monthlyPensionMode.value!=='custom';
    if(el.monthlyPensionMode.value==='custom') el.monthlyPensionCustom.focus();
  });

  el.monthlySalaryForm.addEventListener('submit',event=>{
    event.preventDefault();
    const mode=el.monthlyPensionMode.value;
    let pensionOverride=null;
    if(mode==='zero') pensionOverride=0;
    if(mode==='custom'){
      pensionOverride=parseDecimalInput(el.monthlyPensionCustom.value);
      if(pensionOverride===null||pensionOverride<0||pensionOverride>100){
        alert('יש להזין אחוז פנסיה תקין בין 0 ל־100.');
        return;
      }
    }

    const manualNet=parseDecimalInput(el.monthlyManualNet.value);
    const retroPension=parseDecimalInput(el.monthlyRetroPension.value);
    if(manualNet!==null&&manualNet<0){
      alert('נטו ידני לא יכול להיות שלילי.');
      return;
    }
    if(retroPension!==null&&retroPension<0){
      alert('ניכוי רטרואקטיבי לא יכול להיות שלילי.');
      return;
    }

    financeMonths[selectedMonthKey]=normalizeMonthData({
      ...selectedFinance(),
      pensionOverride,
      manualNet,
      retroPension:retroPension??0,
      salaryUpdatedAt:new Date().toISOString()
    });
    save(K.months,financeMonths);
    render();
  });

  el.financeForm.addEventListener('submit',event=>{
    event.preventDefault();
    const current=parseDecimalInput(el.currentBalance.value),creditBase=parseDecimalInput(el.creditBase.value),fixedBase=parseDecimalInput(el.fixedBase.value),extra=parseDecimalInput(el.extraIncome.value),budget=parseDecimalInput(el.monthlyBudget.value),budgetBaseSpent=parseDecimalInput(el.budgetBaseSpent.value);
    if(current===null||creditBase===null){alert('יש למלא יתרה נוכחית וחיוב אשראי קיים. אפשר להזין 0 אם אין חיוב.');return;}
    const values=[current,creditBase,fixedBase??0,extra??0,budget??1500,budgetBaseSpent??0];if(values.some(value=>value<0)){alert('אין להזין סכומים שליליים.');return;}
    financeMonths[selectedMonthKey]=normalizeMonthData({...selectedFinance(),currentBalance:current,creditBase,fixedBase:fixedBase??0,extra:extra??0,monthlyBudget:budget??1500,budgetBaseSpent:budgetBaseSpent??0,carriedBalance:false,balanceSource:'manual',updatedAt:new Date().toISOString()});
    if(selectedMonthKey===currentMonthKey()){financePrefs.monthlyBudget=financeMonths[selectedMonthKey].monthlyBudget;save(K.financePrefs,financePrefs);}
    save(K.months,financeMonths);render();
  });
  el.creditExpenseForm.addEventListener('submit',event=>{
    event.preventDefault();const description=el.creditDescription.value.trim(),amount=parseDecimalInput(el.creditAmount.value),date=el.creditDate.value;
    if(!description||amount===null||amount<=0||!date){alert('יש למלא תיאור, סכום חיובי ותאריך.');return;}if(String(date).slice(0,7)!==selectedMonthKey){alert(`התאריך צריך להיות בתוך ${monthLabel(selectedMonthKey)}.`);return;}
    creditEntries.push({id:makeId(),description,amount,date,countsBudget:el.creditCountsBudget.checked,createdAt:new Date().toISOString()});save(K.creditEntries,creditEntries);el.creditDescription.value='';el.creditAmount.value='';el.creditDate.value=defaultDateForMonth(selectedMonthKey);el.creditCountsBudget.checked=true;render();
  });
  el.recurringForm.addEventListener('submit',event=>{
    event.preventDefault();const name=el.recurringName.value.trim(),amount=parseDecimalInput(el.recurringAmount.value),day=el.recurringDay.value?Number(el.recurringDay.value):null;
    if(!name||amount===null||amount<=0){alert('יש למלא שם וסכום חודשי חיובי.');return;}if(day!==null&&(day<1||day>31)){alert('יום החיוב צריך להיות בין 1 ל־31. בחודש קצר החיוב יוצג ביום האחרון של החודש.');return;}
    recurringPayments.push({id:makeId(),name,amount,day,type:el.recurringType.value,startMonth:selectedMonthKey,active:true,createdAt:new Date().toISOString()});save(K.recurring,recurringPayments);el.recurringName.value='';el.recurringAmount.value='';el.recurringDay.value='';el.recurringType.value='standing';render();
  });

  const openSettings=()=>{el.setBase.value=inputNumber(settings.base);el.setTravel.value=inputNumber(settings.travel);el.setHours.value=inputNumber(settings.hours);el.setPension.value=inputNumber(settings.pension);el.setCreditPoints.value=inputNumber(settings.creditPoints);el.setBreak.value=inputNumber(settings.breakMinutes);el.settingsOverlay.hidden=false;document.body.classList.add('modal-open');setTimeout(()=>el.setBase.focus(),0);};
  const closeSettingsModal=()=>{el.settingsOverlay.hidden=true;document.body.classList.remove('modal-open');};
  el.settingsBtn.addEventListener('click',openSettings);el.closeSettings.addEventListener('click',closeSettingsModal);el.settingsOverlay.addEventListener('click',event=>{if(event.target===el.settingsOverlay)closeSettingsModal();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el.settingsOverlay.hidden)closeSettingsModal();});
  el.settingsForm.addEventListener('submit',event=>{event.preventDefault();const base=parseDecimalInput(el.setBase.value),travel=parseDecimalInput(el.setTravel.value),hours=parseDecimalInput(el.setHours.value),pension=parseDecimalInput(el.setPension.value),creditPoints=parseDecimalInput(el.setCreditPoints.value),breakMinutes=parseDecimalInput(el.setBreak.value);if([base,travel,hours,pension,creditPoints,breakMinutes].some(value=>value===null)){alert('יש למלא את כל הגדרות השכר במספרים תקינים.');return;}settings={...settings,base,travel,hours,pension,creditPoints,breakMinutes};save(K.s,settings);closeSettingsModal();render();});

  let observedCalendarMonth=currentMonthKey();
  function syncCalendarMonth(){
    const latest=currentMonthKey();
    if(latest===observedCalendarMonth) return;
    const wasViewingLiveMonth=selectedMonthKey===observedCalendarMonth;
    observedCalendarMonth=latest;
    ensureMonthBucket(latest);
    if(wasViewingLiveMonth) setSelectedMonth(latest);
    else render();
  }

  el.manualDate.value=defaultDateForMonth(selectedMonthKey);el.creditDate.value=defaultDateForMonth(selectedMonthKey);renderScreenshotThumbs();render();
  window.setInterval(syncCalendarMonth,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncCalendarMonth();});
  window.addEventListener('focus',syncCalendarMonth);

  if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).finally(()=>{'caches'in window&&caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key))));});}
});
